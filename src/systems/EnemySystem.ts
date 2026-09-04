import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/**
 * EnemySystem — 敵人執行時系統。
 *
 * 每幀驅動 EnemySpawner（敵人 AI / 射彈 / 命中玩家 / 清除）。
 * 生怪節奏由 WaveSystem 透過 ctx.spawner 主導；本系統不再開場自己生怪
 * （避免與波次重複）。開場最初幾百毫秒場上可能無敵人，待波次滴流第一隻，可接受。
 */
export class EnemySystem implements GameSystem {
  readonly name = 'EnemySystem';
  private ctx!: GameContext;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  update(dt: number): void {
    this.ctx.spawner.update(dt);
  }
}
