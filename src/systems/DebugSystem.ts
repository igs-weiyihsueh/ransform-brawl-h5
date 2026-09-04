import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import { ENEMY_CHARACTERS } from '@/entities/Enemy';
import { PLAYER_CHARACTERS } from '@/entities/Player';
import type { EnemySpawner } from '@/systems/EnemySpawner';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import type { PlayerControlSystem } from '@/systems/PlayerControlSystem';

/**
 * DebugSystem — 開發用 debug 疊層與快捷鍵。
 *
 * - 快捷鍵：T 切玩家皮膚、E 切敵人類型並補一隻、R 補同型一隻。
 * - 繪製：玩家攻擊 OBB（黃）、敵人近戰判定圓（紅）。
 * - 資訊列：玩家/面向/被誰打/iFrame、下一隻敵人類型、場上敵人狀態與 HP。
 *
 * 這是可整包移除的 debug 系統：正式版把它從 registry 拿掉即可，玩法不受影響。
 */
export class DebugSystem implements GameSystem {
  readonly name = 'DebugSystem';
  private ctx!: GameContext;
  private gfx!: Phaser.GameObjects.Graphics;
  private infoText!: Phaser.GameObjects.Text;

  private playerSkinIndex = 0;
  private enemyTypeIndex = 0;

  /** debug 需要讀這兩個系統的判定圖形。 */
  constructor(
    private readonly playerControl: PlayerControlSystem,
    private readonly spawner: EnemySpawner,
  ) {}

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.gfx = ctx.scene.add.graphics();
    this.infoText = ctx.scene.add.text(16, 16, '', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
    });
    ctx.scene.add
      .text(
        GAME_WIDTH / 2,
        32,
        'WASD/方向鍵 移動   Z/左鍵 攻擊   T 切換玩家(Human↔SunWukong)   E 切換敵人類型   R 補一隻敵人',
        {
          fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
          fontSize: '20px',
          color: '#aaaaaa',
        },
      )
      .setOrigin(0.5, 0);
  }

  update(_dt: number): void {
    const { input, player } = this.ctx;

    // R：補同型一隻
    if (input.isRespawnJustPressed()) {
      this.spawnCurrentType();
    }
    // T：循環切玩家皮膚
    if (input.isSwitchPlayerJustPressed()) {
      this.playerSkinIndex = (this.playerSkinIndex + 1) % PLAYER_CHARACTERS.length;
      player.switchCharacter(PLAYER_CHARACTERS[this.playerSkinIndex]);
    }
    // E：循環切敵人類型並立刻補一隻
    if (input.isSwitchEnemyJustPressed()) {
      this.enemyTypeIndex = (this.enemyTypeIndex + 1) % ENEMY_CHARACTERS.length;
      this.spawnCurrentType();
    }

    this.drawDebug();
    this.updateInfo();
  }

  private spawnCurrentType(): void {
    this.ctx.spawner.spawn(
      ENEMY_CHARACTERS[this.enemyTypeIndex],
      GAME_WIDTH * 0.7 + Phaser.Math.Between(-120, 120),
      GAME_HEIGHT * 0.5 + Phaser.Math.Between(-200, 200),
    );
  }

  private drawDebug(): void {
    this.gfx.clear();

    // 玩家攻擊 OBB（黃）。
    const obb = this.playerControl.getDebugOBB();
    if (obb) {
      this.gfx.lineStyle(2, 0xffeb3b, 0.9);
      this.gfx.save();
      this.gfx.translateCanvas(obb.center.x, obb.center.y);
      this.gfx.rotateCanvas(obb.rotation);
      this.gfx.strokeRect(
        -obb.halfLength,
        -obb.halfWidth,
        obb.halfLength * 2,
        obb.halfWidth * 2,
      );
      this.gfx.restore();
    }

    // 敵人近戰判定圓（紅）。
    const c = this.spawner.getDebugMeleeCircle();
    if (c) {
      this.gfx.lineStyle(2, 0xff5252, 0.9);
      this.gfx.strokeCircle(c.center.x, c.center.y, c.radius);
    }
  }

  private updateInfo(): void {
    const { player } = this.ctx;
    const enemies = this.ctx.getEnemies();
    const enemyInfo = enemies
      .map(
        (e) =>
          `${e.getCharacterKey().replace('Enemy_', '')}[${e.getState()}]HP${e.getHp()}/${e.getMaxHp()}`,
      )
      .join('  ');
    const facing = player.getFacing() >= 0 ? '→' : '←';
    const nextEnemy = ENEMY_CHARACTERS[this.enemyTypeIndex];
    const hitInfo = player.getLastHitBy() ? `最近被 ${player.getLastHitBy()} 打` : '未被打';
    const iframe = player.isInvincible() ? ' [iFrame無敵中]' : '';
    this.infoText.setText(
      `玩家:${player.getCharacterKey()}  面向 ${facing}   ${hitInfo}${iframe}\n` +
        `下一隻敵人(E補新/R補同型):${nextEnemy}   場上:${enemies.length}  ${enemyInfo}` +
        (player.isOnCooldown() ? '   [玩家攻擊冷卻中]' : ''),
    );
  }
}
