import { GLOBAL_CHARACTER_SCALE, PLAYER_BASIC_ATTACK, PLAYER_CONFIG } from '@/config/combatConfig';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import { buildAttackOBB, queryHits, type OBB } from '@/systems/hitDetection';

/**
 * PlayerControlSystem — 玩家操控主迴圈。
 *
 * 輸入 → 移動 → 攻擊前搖 → hitDelay 到期做命中判定（對敵人套傷害/擊退）+ 播斬擊特效。
 * 只透過 context 取共用服務（input/player/effects/enemies），不碰 GameScene 內部。
 */
export class PlayerControlSystem implements GameSystem {
  readonly name = 'PlayerControlSystem';
  private ctx!: GameContext;

  /** 最近一次攻擊 OBB（供 debug 繪製）。 */
  private lastOBB: OBB | null = null;
  private obbFlash = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  update(dt: number): void {
    const { input, player } = this.ctx;

    // 輸入 → 移動
    player.move(input.getMoveVector(), dt);

    // 攻擊輸入 → 前搖
    if (input.isAttackJustPressed()) {
      player.tryStartAttack(PLAYER_BASIC_ATTACK.hitDelay, PLAYER_CONFIG.attackCooldown);
    }

    // 計時器；hitDelay 到期做命中判定
    if (player.updateTimers(dt)) {
      this.resolveAttack();
    }

    if (this.obbFlash > 0) this.obbFlash -= dt;
  }

  private resolveAttack(): void {
    const { player, effects } = this.ctx;
    const obb = buildAttackOBB(
      PLAYER_BASIC_ATTACK,
      player.getPosition(),
      player.getFacing(),
      GLOBAL_CHARACTER_SCALE,
    );
    const from = player.getPosition();
    for (const e of queryHits(obb, this.ctx.getEnemies())) {
      e.takeHit(PLAYER_BASIC_ATTACK.damage, PLAYER_BASIC_ATTACK.knockback, from);
    }
    this.lastOBB = obb;
    this.obbFlash = 0.12;
    effects.play('attack_03', obb.center.x, obb.center.y, player.getFacing());
  }

  /** 給 debug 用：最近攻擊 OBB（閃現中才回傳）。 */
  getDebugOBB(): OBB | null {
    return this.obbFlash > 0 ? this.lastOBB : null;
  }
}
