import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import { ENEMY_CHARACTERS } from '@/entities/Enemy';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/**
 * EnemySystem — 敵人執行時系統。
 *
 * 每幀驅動 EnemySpawner（敵人 AI / 射彈 / 命中玩家 / 清除）。
 * 初始生一隻敵人維持原本行為（垂直切片預設場上有一隻）。
 * 之後波次系統會改用 context.spawner.spawn(...) 決定生怪節奏，不需改這裡。
 */
export class EnemySystem implements GameSystem {
  readonly name = 'EnemySystem';
  private ctx!: GameContext;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    // 維持原行為：開場先補一隻預設類型敵人。
    this.ctx.spawner.spawn(
      ENEMY_CHARACTERS[0],
      GAME_WIDTH * 0.7 + Phaser.Math.Between(-120, 120),
      GAME_HEIGHT * 0.5 + Phaser.Math.Between(-200, 200),
    );
  }

  update(dt: number): void {
    this.ctx.spawner.update(dt);
  }
}
