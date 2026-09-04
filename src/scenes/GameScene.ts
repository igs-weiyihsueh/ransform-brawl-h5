import Phaser from 'phaser';
import {
  GLOBAL_CHARACTER_SCALE,
  PLAYER_BASIC_ATTACK,
  PLAYER_CONFIG,
} from '@/config/combatConfig';
import {
  BACKGROUND_COLOR,
  GAME_HEIGHT,
  GAME_WIDTH,
} from '@/config/gameConfig';
import { Enemy } from '@/entities/Enemy';
import { Player } from '@/entities/Player';
import { CharacterAnimator } from '@/systems/CharacterAnimator';
import { buildAttackOBB, queryHits } from '@/systems/hitDetection';
import { InputSystem } from '@/systems/InputSystem';

/**
 * GameScene — 垂直切片主場景。
 *
 * 只負責「組裝」：建立玩家/敵人/輸入系統，並在 update() 串起主迴圈：
 *   輸入 → 移動 → 攻擊(前搖→命中判定) → 敵人 AI → 受擊/死亡。
 * 判定與行為邏輯分別在 systems/ 與 entities/，這裡不放具體演算法。
 */
export class GameScene extends Phaser.Scene {
  private input_!: InputSystem;
  private player!: Player;
  private enemies: Enemy[] = [];

  private debugGfx!: Phaser.GameObjects.Graphics;
  private infoText!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'GameScene' });
  }

  /** 載入 Human（玩家）與 Enemy_Rush（敵人）所有動作的逐幀圖。 */
  preload(): void {
    CharacterAnimator.preload(this, 'Human');
    CharacterAnimator.preload(this, 'Enemy_Rush');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);

    // 依設定建立 Phaser animations（全域只需一次）。
    CharacterAnimator.register(this, 'Human');
    CharacterAnimator.register(this, 'Enemy_Rush');

    this.input_ = new InputSystem(this);
    this.player = new Player(this, GAME_WIDTH * 0.4, GAME_HEIGHT * 0.5);
    this.spawnEnemy();

    // debug：畫攻擊判定框。
    this.debugGfx = this.add.graphics();

    this.infoText = this.add.text(16, 16, '', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
    });

    this.add
      .text(GAME_WIDTH / 2, 32, 'WASD/方向鍵移動  Z/左鍵攻擊  R 補一隻敵人', {
        fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
        fontSize: '22px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5, 0);
  }

  update(_time: number, deltaMs: number): void {
    const dt = deltaMs / 1000;

    // 1) 輸入 → 移動
    const move = this.input_.getMoveVector();
    this.player.move(move, dt);

    // 2) 攻擊輸入 → 開始前搖
    if (this.input_.isAttackJustPressed()) {
      this.player.tryStartAttack(
        PLAYER_BASIC_ATTACK.hitDelay,
        PLAYER_CONFIG.attackCooldown,
      );
    }

    // 3) 計時器；hitDelay 到期則做命中判定
    const shouldHit = this.player.updateTimers(dt);
    if (shouldHit) {
      this.resolveAttack();
    }

    // 4) 敵人 AI（追擊/停止/擊退/閃白）
    const playerPos = this.player.getPosition();
    for (const e of this.enemies) {
      e.update(playerPos, dt);
    }

    // 5) 清掉死亡敵人
    this.enemies = this.enemies.filter((e) => !e.isDead());

    // debug 繪製 + 資訊
    this.drawAttackDebug();
    this.updateInfo();

    // 測試用：補一隻敵人
    if (this.input_.isRespawnJustPressed()) {
      this.spawnEnemy();
    }
  }

  /** 執行一次攻擊命中判定：建立 OBB → 查詢命中 → 對命中目標套傷害/擊退。 */
  private resolveAttack(): void {
    const obb = buildAttackOBB(
      PLAYER_BASIC_ATTACK,
      this.player.getPosition(),
      this.player.getFacing(),
      GLOBAL_CHARACTER_SCALE,
    );
    const hits = queryHits(obb, this.enemies);
    const from = this.player.getPosition();
    for (const e of hits) {
      e.takeHit(PLAYER_BASIC_ATTACK.damage, PLAYER_BASIC_ATTACK.knockback, from);
    }
    // 攻擊命中框閃現一下（0.12s）方便觀察。
    this.flashAttackBox(obb);
  }

  private spawnEnemy(): void {
    const e = new Enemy(this, GAME_WIDTH * 0.7, GAME_HEIGHT * 0.5);
    this.enemies.push(e);
  }

  private attackFlashRemaining = 0;
  private lastOBB: ReturnType<typeof buildAttackOBB> | null = null;

  private flashAttackBox(obb: ReturnType<typeof buildAttackOBB>): void {
    this.attackFlashRemaining = 0.12;
    this.lastOBB = obb;
  }

  private drawAttackDebug(): void {
    this.debugGfx.clear();
    if (this.attackFlashRemaining <= 0 || !this.lastOBB) return;

    this.attackFlashRemaining -= this.game.loop.delta / 1000;
    const obb = this.lastOBB;
    this.debugGfx.lineStyle(2, 0xffeb3b, 0.9);
    this.debugGfx.save();
    this.debugGfx.translateCanvas(obb.center.x, obb.center.y);
    this.debugGfx.rotateCanvas(obb.rotation);
    this.debugGfx.strokeRect(
      -obb.halfLength,
      -obb.halfWidth,
      obb.halfLength * 2,
      obb.halfWidth * 2,
    );
    this.debugGfx.restore();
  }

  private updateInfo(): void {
    const enemyInfo = this.enemies
      .map((e) => `HP ${e.getHp()}/${e.getMaxHp()}`)
      .join('  ');
    const facing = this.player.getFacing() >= 0 ? '→' : '←';
    this.infoText.setText(
      `面向 ${facing}   敵人:${this.enemies.length}  ${enemyInfo}` +
        (this.player.isOnCooldown() ? '   [攻擊冷卻中]' : ''),
    );
  }
}
