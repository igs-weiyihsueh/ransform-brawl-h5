import Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import { computeJustPressed } from '@/systems/inputEdge';

/** 可做 edge 偵測（justPressed）的動作名。用動作層命名，與現有 WASD/attack 抽象一致。 */
export type InputAction = 'attack' | 'respawn' | 'switchPlayer' | 'switchEnemy' | 'spawnItem';

// 轉出純函式，讓既有 import 點（若有）仍可從此取得；實作在 inputEdge.ts（零依賴、可測）。
export { computeJustPressed } from '@/systems/inputEdge';

/**
 * InputSystem — 輸入抽象，同時是 registry 的 GameSystem（排最前）與 ctx.input 服務。
 *
 * 一物件兩角色：
 *  - GameSystem：生命週期走 registry；每幀 update() 先做一次 snapshot（downNow / justPressed）。
 *    因為排在 registry 最前，snapshot 算完後、該幀後面所有系統讀到的 justPressed 是同一個
 *    存下的 boolean（一致）；下一幀又最先跑、用這幀存的 prev 比對。單一時點自洽。
 *  - 服務：各系統透過 ctx.input 讀 held（getMoveVector）與 edge（justPressed/justPressedAttack）。
 *
 * edge 偵測：justPressed = downNow && !prev，算完立刻存 prev = downNow。
 * 存 prev 本身就是 clear（下一幀自動重算），不需要獨立 clear 步驟。
 *
 * held / axis（getMoveVector）不走 snapshot、直接讀 .isDown（level 語意），移動行為不變。
 */
export class InputSystem implements GameSystem {
  readonly name = 'InputSystem';

  private readonly keyW: Phaser.Input.Keyboard.Key;
  private readonly keyA: Phaser.Input.Keyboard.Key;
  private readonly keyS: Phaser.Input.Keyboard.Key;
  private readonly keyD: Phaser.Input.Keyboard.Key;
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;

  /** 各動作對應的實體按鍵。 */
  private readonly actionKeys: Record<InputAction, Phaser.Input.Keyboard.Key>;

  /** 滑鼠左鍵本幀是否按下（由 pointerdown 事件設，snapshot 後清）。 */
  private pointerDownRaw = false;

  /** 每幀 snapshot：本幀是否按下 / 是否剛按下（edge）。 */
  private downNow: Record<InputAction, boolean> = {
    attack: false,
    respawn: false,
    switchPlayer: false,
    switchEnemy: false,
    spawnItem: false,
  };
  private justPressedNow: Record<InputAction, boolean> = {
    attack: false,
    respawn: false,
    switchPlayer: false,
    switchEnemy: false,
    spawnItem: false,
  };
  private prevDown: Record<InputAction, boolean> = {
    attack: false,
    respawn: false,
    switchPlayer: false,
    switchEnemy: false,
    spawnItem: false,
  };

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

    this.actionKeys = {
      attack: kb.addKey(KC.Z),
      respawn: kb.addKey(KC.R),
      switchPlayer: kb.addKey(KC.T),
      switchEnemy: kb.addKey(KC.E),
      spawnItem: kb.addKey(KC.G),
    };

    // 滑鼠左鍵也算 attack 按下：事件只設 raw 旗標，實際 edge 在 update() snapshot 統一算。
    this.onPointerDown = (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) {
        this.pointerDownRaw = true;
      }
    };
    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
  }

  // --- GameSystem 生命週期 ---

  init(_ctx: GameContext): void {
    // 無需額外初始化；按鍵在 constructor 已建立。
  }

  /**
   * 每幀最先跑：snapshot 本幀 downNow、算 justPressed（跨幀 edge），並存 prev。
   */
  update(_dt: number): void {
    for (const action of Object.keys(this.actionKeys) as InputAction[]) {
      let down = this.actionKeys[action].isDown;
      // attack 動作：鍵盤 Z 或滑鼠左鍵任一按下都算。
      if (action === 'attack' && this.pointerDownRaw) {
        down = true;
      }
      // edge：本幀按下且上一幀沒按下 → justPressed。
      this.justPressedNow[action] = computeJustPressed(down, this.prevDown[action]);
      this.downNow[action] = down;
      // 算完立刻存 prev（＝clear，下一幀自動重算）。
      this.prevDown[action] = down;
    }
    // 消耗滑鼠 raw 旗標（事件式，僅在按下當幀為 true）。
    this.pointerDownRaw = false;
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
  }

  // --- 服務 API（各系統讀） ---

  /** 取得正規化後的移動向量（held/level 語意，直接讀 isDown；不走 snapshot）。 */
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

  /** 某動作本幀是否剛按下（edge，來自本幀 snapshot；同幀多次讀值一致）。 */
  justPressed(action: InputAction): boolean {
    return this.justPressedNow[action];
  }

  /** 攻擊「動作」的 edge（Z 或滑鼠左鍵）。給放招/COMBO 用。 */
  justPressedAttack(): boolean {
    return this.justPressedNow.attack;
  }

  // --- 相容既有呼叫端（改讀 snapshot，語意不變） ---

  /** 這一幀是否剛按下攻擊。 */
  isAttackJustPressed(): boolean {
    return this.justPressedNow.attack;
  }

  /** 這一幀是否剛按下重生鍵（R）。 */
  isRespawnJustPressed(): boolean {
    return this.justPressedNow.respawn;
  }

  /** debug：這一幀是否剛按下切換玩家皮膚鍵（T）。 */
  isSwitchPlayerJustPressed(): boolean {
    return this.justPressedNow.switchPlayer;
  }

  /** debug：這一幀是否剛按下切換敵人類型鍵（E）。 */
  isSwitchEnemyJustPressed(): boolean {
    return this.justPressedNow.switchEnemy;
  }

  /** debug：這一幀是否剛按下生成變身道具鍵（G）。 */
  isSpawnItemJustPressed(): boolean {
    return this.justPressedNow.spawnItem;
  }
}
