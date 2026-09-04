import { PLAYER_CONFIG } from '@/config/combatConfig';
import type { AttackData } from '@/systems/AttackData';
import { EnergySystem, type AttackIntent } from '@/systems/EnergySystem';
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

  /** debug 繪製用：最近判定形狀。 */
  private lastOBB: OBB | null = null;
  private lastCircle: AttackCircle | null = null;
  private lastFan: AttackFan | null = null;
  private shapeFlash = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  update(dt: number): void {
    const { input, player, energy } = this.ctx;

    // 輸入 → 移動
    player.move(input.getMoveVector(), dt);

    // 攻擊輸入 → 決定普攻或放招 → 用該 AttackData 的 hitDelay 起前搖
    if (input.justPressedAttack()) {
      const intent = energy.resolveAttackIntent();
      if (player.tryStartAttack(intent.attack.hitDelay, PLAYER_CONFIG.attackCooldown)) {
        this.pendingIntent = intent;
      }
    }

    // 計時器；hitDelay 到期做命中判定
    if (player.updateTimers(dt) && this.pendingIntent) {
      this.resolveAttack(this.pendingIntent);
      this.pendingIntent = null;
    }

    if (this.shapeFlash > 0) this.shapeFlash -= dt;
  }

  /** 依 intent 的 AttackData 形狀建立判定、查命中、套傷害；回報 EnergySystem 充能。 */
  private resolveAttack(intent: AttackIntent): void {
    const { player, effects, energy } = this.ctx;
    const attack: AttackData = intent.attack;
    const pos = player.getPosition();
    const facing = player.getFacing();
    const scale = energy.getAttackScale();
    const dmg = EnergySystem.applyMultiplier(attack.damage, intent.multiplier);

    let hitAny = false;
    let effectCenter = pos;

    if (attack.shapeType === 'circle') {
      const circle = buildAttackCircle(attack, pos, facing, scale);
      for (const e of queryHitsCircle(circle, this.ctx.getEnemies())) {
        e.takeHit(dmg, attack.knockback, pos);
        hitAny = true;
      }
      this.lastCircle = circle;
      this.lastOBB = null;
      this.lastFan = null;
      effectCenter = circle.center;
    } else if (attack.shapeType === 'fan') {
      const fan = buildAttackFan(attack, pos, facing, scale);
      for (const e of queryHitsFan(fan, this.ctx.getEnemies())) {
        e.takeHit(dmg, attack.knockback, pos);
        hitAny = true;
      }
      this.lastFan = fan;
      this.lastOBB = null;
      this.lastCircle = null;
      effectCenter = fan.center;
    } else {
      const obb = buildAttackOBB(attack, pos, facing, scale);
      for (const e of queryHits(obb, this.ctx.getEnemies())) {
        e.takeHit(dmg, attack.knockback, pos);
        hitAny = true;
      }
      this.lastOBB = obb;
      this.lastCircle = null;
      this.lastFan = null;
      effectCenter = obb.center;
    }

    this.shapeFlash = 0.12;
    effects.play('attack_03', effectCenter.x, effectCenter.y, facing);

    // 充能回報：普攻打到人才 +1（招式命中不充）。
    energy.reportHit(intent.isSkill, hitAny);
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
