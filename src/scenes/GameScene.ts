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
import { CHARACTERS } from '@/config/animationConfig';
import { Enemy, ENEMY_CHARACTERS } from '@/entities/Enemy';
import { Player, PLAYER_CHARACTERS } from '@/entities/Player';
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

  /** debug：玩家皮膚循環索引、下一隻要 spawn 的敵人類型索引。 */
  private playerSkinIndex = 0;
  private enemyTypeIndex = 0;

  constructor() {
    super({ key: 'GameScene' });
  }

  /** 載入全部 5 隻角色所有動作的逐幀圖（資料驅動：直接跑 CHARACTERS 註冊表）。 */
  preload(): void {
    for (const charKey of Object.keys(CHARACTERS)) {
      CharacterAnimator.preload(this, charKey);
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);

    // 依設定建立全部角色的 Phaser animations（全域只需一次）。
    for (const charKey of Object.keys(CHARACTERS)) {
      CharacterAnimator.register(this, charKey);
    }

    this.input_ = new InputSystem(this);
    this.player = new Player(
      this,
      GAME_WIDTH * 0.4,
      GAME_HEIGHT * 0.5,
      PLAYER_CHARACTERS[this.playerSkinIndex],
    );
    this.spawnEnemy();

    // debug：畫攻擊判定框。
    this.debugGfx = this.add.graphics();

    this.infoText = this.add.text(16, 16, '', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
    });

    this.add
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

    // 測試用：補一隻敵人（用目前選定的敵人類型）
    if (this.input_.isRespawnJustPressed()) {
      this.spawnEnemy();
    }

    // debug：T 循環切換玩家皮膚 Human↔SunWukong
    if (this.input_.isSwitchPlayerJustPressed()) {
      this.playerSkinIndex = (this.playerSkinIndex + 1) % PLAYER_CHARACTERS.length;
      this.player.switchCharacter(PLAYER_CHARACTERS[this.playerSkinIndex]);
    }

    // debug：E 循環切換「下一隻要補的」敵人類型，並立即補一隻該類型出來看
    if (this.input_.isSwitchEnemyJustPressed()) {
      this.enemyTypeIndex = (this.enemyTypeIndex + 1) % ENEMY_CHARACTERS.length;
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
    // 隨機在右側散開一點，避免多隻疊在同一點。
    const x = GAME_WIDTH * 0.7 + Phaser.Math.Between(-120, 120);
    const y = GAME_HEIGHT * 0.5 + Phaser.Math.Between(-200, 200);
    const e = new Enemy(this, x, y, ENEMY_CHARACTERS[this.enemyTypeIndex]);
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
    const nextEnemy = ENEMY_CHARACTERS[this.enemyTypeIndex];
    this.infoText.setText(
      `玩家:${this.player.getCharacterKey()}  面向 ${facing}\n` +
        `下一隻敵人(E/R):${nextEnemy}   場上:${this.enemies.length}  ${enemyInfo}` +
        (this.player.isOnCooldown() ? '   [攻擊冷卻中]' : ''),
    );
  }
}
