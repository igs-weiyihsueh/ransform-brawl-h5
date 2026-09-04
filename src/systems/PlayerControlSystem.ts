import { DASH_CONFIG, PLAYER_CONFIG } from '@/config/combatConfig';
import {
  FREEZE_SEC,
  LIGHTNING_CHAIN_COUNT,
  LIGHTNING_CHAIN_DAMAGE,
  LIGHTNING_CHAIN_RANGE,
  LIGHTNING_PARALYZE_SEC,
  MOUNT_DASH_EXTRA_HITS,
} from '@/config/buffConfig';
import { PPU } from '@/config/gameConfig';
import type { AttackData } from '@/systems/AttackData';
import { lateralKnockbackDir } from '@/systems/dashMath';
import { EnergySystem, type AttackIntent } from '@/systems/EnergySystem';
import type { Enemy } from '@/entities/Enemy';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import {
  buildAttackCircle,
  buildAttackFan,
  buildAttackOBB,
  queryHits,
  queryHitsCircle,
  queryHitsFan,
  type AttackCircle,
  type AttackFan,
  type OBB,
} from '@/systems/hitDetection';

/**
 * PlayerControlSystem — 玩家操控主迴圈。
 *
 * 輸入 → 移動 → 攻擊前搖 → hitDelay 到期做命中判定（對敵人套傷害/擊退）+ 播斬擊特效。
 * 攻擊用哪組 AttackData（普攻/招式）由 EnergySystem 決定（能量招式系統）：
 *  - 攻擊鍵按下 → ctx.energy.resolveAttackIntent() 取這次的 AttackData/倍率/isSkill。
 *  - 命中結算後 → ctx.energy.reportHit(isSkill, hitAny)（普攻打到人才充能）。
 * 支援 rectangle / circle / fan 三種判定形狀（走同一套 hitDetection）。
 * 只透過 context 取共用服務（input/player/effects/enemies/energy），不碰 GameScene 內部。
 */
export class PlayerControlSystem implements GameSystem {
  readonly name = 'PlayerControlSystem';
  private ctx!: GameContext;

  /** 本次攻擊的意圖（按鍵當下決定，hitDelay 到期時據此結算）。 */
  private pendingIntent: AttackIntent | null = null;

  /** 本次衝刺是否已扣過 Credit（一次衝刺最多扣 1）。 */
  private dashConsumedCredit = false;

  /** debug 繪製用：最近判定形狀。 */
  private lastOBB: OBB | null = null;
  private lastCircle: AttackCircle | null = null;
  private lastFan: AttackFan | null = null;
  private shapeFlash = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  update(dt: number): void {
    const { input, player, energy, credit } = this.ctx;

    // 依 buff 狀態每幀設定玩家倍率/護盾（頭盔/寶盒）。
    this.applyBuffState();

    // 衝刺觸發（X，edge；需可攻擊(credit>0且非耗盡)、非衝刺中）。
    if (input.justPressedDash() && !player.isDashing() && credit.canAttack()) {
      const move = input.getMoveVector();
      player.startDash(move); // 有移動往移動方向；否則 startDash 內用面向
      this.dashConsumedCredit = false; // 新衝刺：重置「本次衝刺是否已扣 credit」
    }

    if (player.isDashing()) {
      // 衝刺中：走衝刺位移 + 每幀命中判定（穿過敵人、不做一般移動）。
      player.updateDash(dt);
      this.resolveDashHits();
    } else {
      // 一般移動（耗盡狀態不能移動）。
      if (credit.canAct()) {
        player.move(input.getMoveVector(), dt);
      }

      // 攻擊輸入 → 決定普攻或放招 → 用該 AttackData 的 hitDelay 起前搖（需 CanAttack 閘門）
      if (input.justPressedAttack() && credit.canAttack()) {
        const intent = energy.resolveAttackIntent();
        if (player.tryStartAttack(intent.attack.hitDelay, PLAYER_CONFIG.attackCooldown)) {
          this.pendingIntent = intent;
        }
      }
    }

    // 計時器；hitDelay 到期做命中判定（衝刺中仍讓在途攻擊結算）
    if (player.updateTimers(dt) && this.pendingIntent) {
      this.resolveAttack(this.pendingIntent);
      this.pendingIntent = null;
    }

    if (this.shapeFlash > 0) this.shapeFlash -= dt;
  }

  /** 依 BuffSystem 聚合倍率設定玩家 stat 倍率/護盾（同 stat 多來源已相乘+clamp）。 */
  private applyBuffState(): void {
    const { buff, player } = this.ctx;
    // 移速 / 衝刺速度：用聚合倍率（單點 getStatMultiplier，含 clamp）。
    player.setSpeedMultiplier(buff.getStatMultiplier('moveSpeed'));
    player.setDashSpeedMultiplier(buff.getStatMultiplier('dashSpeed'));
    // 護盾：頭盔 Shield（純狀態，非 stat 倍率）。
    player.setShielded(buff.isActive('Shield'));
  }

  /** 命中敵人後的 buff 附加效果：Lightning(麻痺+連鎖) / Freeze(凍結)。 */
  private applyOnHitBuffs(hitEnemies: { getHitCenter(): { x: number; y: number }; applyStun(s: number): void }[]): void {
    const { buff } = this.ctx;
    if (hitEnemies.length === 0) return;

    if (buff.isActive('Freeze')) {
      for (const e of hitEnemies) e.applyStun(FREEZE_SEC);
    }
    if (buff.isActive('Lightning')) {
      // 主目標麻痺 + 連鎖最近 N 隻（範圍內）各傷 + 麻痺。
      const main = hitEnemies[0];
      main.applyStun(LIGHTNING_PARALYZE_SEC);
      const center = main.getHitCenter();
      const rangePx = LIGHTNING_CHAIN_RANGE * PPU;
      const others = this.ctx
        .getEnemies()
        .filter((e) => !hitEnemies.includes(e as never))
        .map((e) => ({ e, d: this.dist2(center, e.getHitCenter()) }))
        .filter((o) => o.d <= rangePx * rangePx)
        .sort((a, b) => a.d - b.d)
        .slice(0, LIGHTNING_CHAIN_COUNT);
      const from = this.ctx.player.getPosition();
      for (const o of others) {
        o.e.takeHit(LIGHTNING_CHAIN_DAMAGE, DASH_CONFIG.knockback, from);
        o.e.applyStun(LIGHTNING_PARALYZE_SEC);
      }
    }
  }

  private dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  /**
   * 衝刺命中：每幀以半徑 dashRadius 的圓抓範圍內敵人，每隻本次衝刺只打一次（去重），
   * 造成 dashDamage + 側向擊退（垂直於衝刺方向、依敵人在哪側決定左右）。不充能。
   */
  private resolveDashHits(): void {
    const { player } = this.ctx;
    const pos = player.getPosition();
    const dir = player.getDashDir();
    // 坐騎：範圍放大（命中數 3→5 近似）＝半徑 × (1 + extraHits/基準)。
    const mountMult = this.ctx.buff.isActive('mount')
      ? 1 + MOUNT_DASH_EXTRA_HITS / 3
      : 1;
    const radiusPx = DASH_CONFIG.radius * PPU * mountMult;

    for (const e of this.ctx.getEnemies()) {
      const c = e.getHitCenter();
      const dx = c.x - pos.x;
      const dy = c.y - pos.y;
      // 圓範圍：把敵人碰撞半徑納入。
      const reach = radiusPx + e.getHitRadius();
      if (dx * dx + dy * dy > reach * reach) continue;
      if (!player.tryDashHit(e)) continue; // 一隻一次

      // 側向擊退：垂直於衝刺方向，依敵人在衝刺線哪側決定左右（純函式 lateralKnockbackDir）。
      const lat = lateralKnockbackDir(dir, { x: dx, y: dy });
      // Enemy.takeHit 以 (enemy - fromPos) 為擊退方向：令 fromPos = enemy - lat → 沿 lat 推。
      const fromPos = { x: c.x - lat.x, y: c.y - lat.y };
      e.takeHit(DASH_CONFIG.damage, DASH_CONFIG.knockback, fromPos);
      // 衝刺命中不充能（不呼叫 energy.reportHit）；但 Credit 扣 + COMBO + JP 累積，一次衝刺最多一次。
      if (!this.dashConsumedCredit) {
        this.dashConsumedCredit = true;
        this.ctx.credit.consumeOnHit();
        this.ctx.combo.onHit();
        this.ctx.jp.notifyCreditSpent(1);
      }
    }
  }

  /** 依 intent 的 AttackData 形狀建立判定、查命中、套傷害；回報 EnergySystem 充能。 */
  private resolveAttack(intent: AttackIntent): void {
    const { player, effects, energy } = this.ctx;
    const attack: AttackData = intent.attack;
    const pos = player.getPosition();
    const facing = player.getFacing();
    const scale = energy.getAttackScale();
    // 傷害 = 基礎 × 能量倍率 × damage stat 聚合倍率（二段變身等，含 clamp）。
    const buffDmgMult = this.ctx.buff.getStatMultiplier('damage');
    const dmg = EnergySystem.applyMultiplier(attack.damage, intent.multiplier * buffDmgMult);

    const hits: Enemy[] = [];
    let effectCenter = pos;

    if (attack.shapeType === 'circle') {
      const circle = buildAttackCircle(attack, pos, facing, scale);
      hits.push(...queryHitsCircle(circle, this.ctx.getEnemies()));
      this.lastCircle = circle;
      this.lastOBB = null;
      this.lastFan = null;
      effectCenter = circle.center;
    } else if (attack.shapeType === 'fan') {
      const fan = buildAttackFan(attack, pos, facing, scale);
      hits.push(...queryHitsFan(fan, this.ctx.getEnemies()));
      this.lastFan = fan;
      this.lastOBB = null;
      this.lastCircle = null;
      effectCenter = fan.center;
    } else {
      const obb = buildAttackOBB(attack, pos, facing, scale);
      hits.push(...queryHits(obb, this.ctx.getEnemies()));
      this.lastOBB = obb;
      this.lastCircle = null;
      this.lastFan = null;
      effectCenter = obb.center;
    }

    for (const e of hits) e.takeHit(dmg, attack.knockback, pos);
    const hitAny = hits.length > 0;

    // 頭盔命中效果：Lightning(麻痺+連鎖) / Freeze(凍結)。
    this.applyOnHitBuffs(hits);

    this.shapeFlash = 0.12;
    // 依當前 AttackData 的 vfxKey 播對應特效（資料驅動；未設則不播）。
    if (attack.vfxKey) {
      effects.play(attack.vfxKey, effectCenter.x, effectCenter.y, facing);
    }

    // 充能回報：普攻打到人才 +1（招式命中不充）。
    energy.reportHit(intent.isSkill, hitAny);
    // Credit：所有命中都扣 1（普攻/招式一次命中扣一次）；COMBO 累積；JP 累積倍數。
    if (hitAny) {
      this.ctx.credit.consumeOnHit();
      this.ctx.combo.onHit();
      this.ctx.jp.notifyCreditSpent(1);
    }
  }

  // --- debug 繪製取用 ---
  getDebugOBB(): OBB | null {
    return this.shapeFlash > 0 ? this.lastOBB : null;
  }

  getDebugCircle(): AttackCircle | null {
    return this.shapeFlash > 0 ? this.lastCircle : null;
  }

  getDebugFan(): AttackFan | null {
    return this.shapeFlash > 0 ? this.lastFan : null;
  }
}
