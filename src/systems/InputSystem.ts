import Phaser from 'phaser';

/**
 * InputSystem — 把 Phaser 原始鍵盤/滑鼠輸入抽象成「遊戲意圖」。
 *
 * 場景與實體只讀這裡的意圖（moveVector、attackPressed），
 * 不直接碰 Phaser 的鍵盤 API，方便日後換輸入來源（觸控、手把）或測試。
 */
export class InputSystem {
  private readonly keyW: Phaser.Input.Keyboard.Key;
  private readonly keyA: Phaser.Input.Keyboard.Key;
  private readonly keyS: Phaser.Input.Keyboard.Key;
  private readonly keyD: Phaser.Input.Keyboard.Key;
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly keyAttack: Phaser.Input.Keyboard.Key;
  private readonly keyRespawn: Phaser.Input.Keyboard.Key;
  private readonly keySwitchPlayer: Phaser.Input.Keyboard.Key;
  private readonly keySwitchEnemy: Phaser.Input.Keyboard.Key;

  private pointerAttack = false;
  private readonly scene: Phaser.Scene;
  private readonly onPointerDown: (p: Phaser.Input.Pointer) => void;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const kb = scene.input.keyboard;
    if (!kb) {
      throw new Error('Keyboard input plugin is not available.');
    }
    const KC = Phaser.Input.Keyboard.KeyCodes;
    this.keyW = kb.addKey(KC.W);
    this.keyA = kb.addKey(KC.A);
    this.keyS = kb.addKey(KC.S);
    this.keyD = kb.addKey(KC.D);
    this.cursors = kb.createCursorKeys();
    this.keyAttack = kb.addKey(KC.Z);
    this.keyRespawn = kb.addKey(KC.R);
    this.keySwitchPlayer = kb.addKey(KC.T);
    this.keySwitchEnemy = kb.addKey(KC.E);

    // 滑鼠左鍵也可攻擊；用 justDown 的概念以事件緩存。
    this.onPointerDown = (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) {
        this.pointerAttack = true;
      }
    };
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
  }

  /** 場景關閉時解除自己註冊的輸入監聽（避免殘留）。 */
  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
  }

  /** 取得正規化後的移動向量（-1..1，斜向已正規化）。 */
  getMoveVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.keyA.isDown || this.cursors.left.isDown) x -= 1;
    if (this.keyD.isDown || this.cursors.right.isDown) x += 1;
    if (this.keyW.isDown || this.cursors.up.isDown) y -= 1;
    if (this.keyS.isDown || this.cursors.down.isDown) y += 1;

    if (x !== 0 || y !== 0) {
      const len = Math.sqrt(x * x + y * y);
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  /** 這一幀是否「剛按下」攻擊（Z 或滑鼠左鍵）。呼叫後消耗滑鼠旗標。 */
  isAttackJustPressed(): boolean {
    const keyDown = Phaser.Input.Keyboard.JustDown(this.keyAttack);
    const pointer = this.pointerAttack;
    this.pointerAttack = false;
    return keyDown || pointer;
  }

  /** 這一幀是否剛按下重生鍵（R），方便測試補一隻敵人。 */
  isRespawnJustPressed(): boolean {
    return Phaser.Input.Keyboard.JustDown(this.keyRespawn);
  }

  /** debug：這一幀是否剛按下切換玩家皮膚鍵（T）。 */
  isSwitchPlayerJustPressed(): boolean {
    return Phaser.Input.Keyboard.JustDown(this.keySwitchPlayer);
  }

  /** debug：這一幀是否剛按下切換敵人類型鍵（E）。 */
  isSwitchEnemyJustPressed(): boolean {
    return Phaser.Input.Keyboard.JustDown(this.keySwitchEnemy);
  }
}
