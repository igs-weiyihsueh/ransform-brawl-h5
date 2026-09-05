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

  /** 每玩家本次攻擊意圖（按鍵當下決定，hitDelay 到期據此結算）。 */
  private pendingIntent = new Map<number, AttackIntent | null>();

  /** 每玩家本次衝刺是否已扣過 Credit（一次衝刺最多扣 1）。 */
  private dashConsumedCredit = new Map<number, boolean>();

  /** debug 繪製用：最近判定形狀（P1）。 */
  private lastOBB: OBB | null = null;
  private lastCircle: AttackCircle | null = null;
  private lastFan: AttackFan | null = null;
  private shapeFlash = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  update(dt: number): void {
    // buff 倍率/護盾每幀套（目前只影響 P1 玩家實體；per-player buff 之後 S5 再細分）。
    this.applyBuffState();
    // S4：對每個 player（P1 人類 + P2-P4 AI）各自跑操控結算。
    for (const player of this.ctx.players) {
      this.updatePlayer(player, dt);
    }
    if (this.shapeFlash > 0) this.shapeFlash -= dt;
  }

  /** 單一 player 的操控主迴圈（人類/AI 皆同，只差 InputSource）。 */
  private updatePlayer(player: GameContext['player'], dt: number): void {
    const { energy, credit } = this.ctx;
    const src = player.inputSource;
    if (!src) return; // 無 InputSource → 不操控

    const pid = player.playerId;

    // 衝刺觸發（edge；需可攻擊、非衝刺中）。
    if (src.justPressedDash() && !player.isDashing() && credit.canAttack(pid)) {
      player.startDash(src.getMoveVector());
      this.dashConsumedCredit.set(pid, false);
    }

    if (player.isDashing()) {
      player.updateDash(dt);
      this.resolveDashHits(player);
    } else {
      if (credit.canAct(pid)) {
        player.move(src.getMoveVector(), dt);
      }
      if (src.justPressedAttack() && credit.canAttack(pid)) {
        const intent = energy.resolveAttackIntent(pid);
        if (player.tryStartAttack(intent.attack.hitDelay, PLAYER_CONFIG.attackCooldown)) {
          this.pendingIntent.set(pid, intent);
        }
      }
    }

    // 計時器；hitDelay 到期做命中判定（衝刺中仍讓在途攻擊結算）。
    const pending = this.pendingIntent.get(pid) ?? null;
    if (player.updateTimers(dt) && pending) {
      this.resolveAttack(player, pending);
      this.pendingIntent.set(pid, null);
    }
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
  private resolveDashHits(player: GameContext['player']): void {
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
      const attackerId = player.playerId;
      // 衝刺傷害貢獻（per-player，additive）；衝刺命中不充能（不呼叫 energy.reportHit）。
      this.ctx.jp.recordDamage(attackerId, DASH_CONFIG.damage);
      // Credit 扣 + COMBO + JP 共享池：一次衝刺最多一次。
      if (!this.dashConsumedCredit.get(attackerId)) {
        this.dashConsumedCredit.set(attackerId, true);
        this.ctx.credit.consumeOnHit(attackerId);
        this.ctx.combo.onHit(attackerId);
        this.ctx.jp.notifyCreditSpent(1);
      }
    }
  }

  /** 依 intent 的 AttackData 形狀建立判定、查命中、套傷害；回報 EnergySystem 充能。 */
  private resolveAttack(player: GameContext['player'], intent: AttackIntent): void {
    const { effects, energy } = this.ctx;
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

    const attackerId = player.playerId;
    let dealt = 0;
    for (const e of hits) {
      e.takeHit(dmg, attack.knockback, pos); // takeHit 契約不變
      dealt += dmg;
    }
    const hitAny = hits.length > 0;

    // 頭盔命中效果：Lightning(麻痺+連鎖) / Freeze(凍結)。
    this.applyOnHitBuffs(hits);

    this.shapeFlash = 0.12;
    // 依當前 AttackData 的 vfxKey 播對應特效（資料驅動；未設則不播）。
    if (attack.vfxKey) {
      effects.play(attack.vfxKey, effectCenter.x, effectCenter.y, facing);
    }

    // 充能回報：普攻打到人才 +1（招式命中不充）。
    energy.reportHit(attackerId, intent.isSkill, hitAny);
    if (hitAny) {
      this.ctx.credit.consumeOnHit(attackerId);
      this.ctx.combo.onHit(attackerId);
      this.ctx.jp.notifyCreditSpent(1); // ← 共享池，不加 playerId
      this.ctx.jp.recordDamage(attackerId, dealt); // ← per-player 貢獻（傷害總和）
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
