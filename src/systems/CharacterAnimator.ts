import Phaser from 'phaser';
import {
  ALL_ANIM_STATES,
  CHARACTERS,
  FRAME_SIZE,
  getPerCharScale,
  type AnimState,
  type CharacterDef,
} from '@/config/animationConfig';

const BASE_PATH = 'assets/images/characters';

/** 產生單張幀圖的 texture key，例如 "Human/idle/03"。 */
function frameKey(charKey: string, state: AnimState, index: number): string {
  return `${charKey}/${state}/${String(index).padStart(2, '0')}`;
}

/** 產生 Phaser animation 的 key，例如 "Human__idle"。 */
function animKey(charKey: string, state: AnimState): string {
  return `${charKey}__${state}`;
}

/**
 * CharacterAnimator — 可重用的角色逐幀動畫系統。
 *
 * 用法（資料驅動，之後其他角色照套）：
 *  1. 場景 preload()：CharacterAnimator.preload(this, 'Human')
 *  2. 場景 create()：CharacterAnimator.register(this, 'Human')（建立 Phaser anims，全域只需一次）
 *  3. 建立實體時：const anim = new CharacterAnimator(scene, 'Human', x, y)
 *  4. 驅動狀態：anim.play('move')；anim.play('attack', { onComplete })；anim.setFacing(-1)
 *
 * 幀圖以「一張一 texture」載入（非 spritesheet），用統一畫布(256×256)＝統一 anchor，
 * 切動作不跳位；origin 設 (0.5,0.5) 對齊畫布中心。
 */
export class CharacterAnimator {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly charKey: string;
  private currentState: AnimState | null = null;

  constructor(scene: Phaser.Scene, charKey: string, x: number, y: number) {
    this.charKey = charKey;
    // 用該角色第一張 idle 幀當初始貼圖。
    const firstKey = frameKey(charKey, 'idle', 0);
    this.sprite = scene.add.sprite(x, y, firstKey);
    this.sprite.setOrigin(0.5, 0.5); // 統一 anchor＝畫布中心
    this.play('idle');
  }

  /**
   * preload 該角色所有動作的所有幀。放在場景 preload() 呼叫。
   */
  static preload(scene: Phaser.Scene, charKey: string): void {
    const def = CHARACTERS[charKey];
    if (!def) {
      throw new Error(`Unknown character key: ${charKey}`);
    }
    for (const state of ALL_ANIM_STATES) {
      const action = def[state];
      for (let i = 0; i < action.frames; i++) {
        const key = frameKey(charKey, state, i);
        const idx = String(i).padStart(2, '0');
        scene.load.image(key, `${BASE_PATH}/${charKey}/${state}/frame_${idx}.png`);
      }
    }
  }

  /**
   * 依設定建立該角色的所有 Phaser animation。放在場景 create()、preload 完成後呼叫。
   * 全域 anim key 唯一，重複註冊會跳過。
   */
  static register(scene: Phaser.Scene, charKey: string): void {
    const def: CharacterDef | undefined = CHARACTERS[charKey];
    if (!def) {
      throw new Error(`Unknown character key: ${charKey}`);
    }
    for (const state of ALL_ANIM_STATES) {
      const key = animKey(charKey, state);
      if (scene.anims.exists(key)) continue;
      const action = def[state];
      const frames: Phaser.Types.Animations.AnimationFrame[] = [];
      for (let i = 0; i < action.frames; i++) {
        frames.push({ key: frameKey(charKey, state, i) });
      }
      scene.anims.create({
        key,
        frames,
        frameRate: action.fps,
        repeat: action.loop ? -1 : 0,
      });
    }
  }

  /**
   * 播放某狀態動畫。
   * @param state 目標狀態。
   * @param opts.onComplete 一次性動畫播完的 callback（循環動畫不會觸發）。
   * @param opts.force 是否強制重播（預設同狀態不重播；attack 等可傳 true）。
   */
  play(
    state: AnimState,
    opts?: { onComplete?: () => void; force?: boolean },
  ): void {
    const force = opts?.force ?? false;
    if (this.currentState === state && !force) {
      // 已在此狀態且非強制 → 不打斷（避免循環動畫每幀重置）。
      if (opts?.onComplete) this.attachOnce(opts.onComplete);
      return;
    }
    this.currentState = state;
    this.sprite.play(animKey(this.charKey, state), true);
    if (opts?.onComplete) {
      this.attachOnce(opts.onComplete);
    }
  }

  /** 綁一次性的「動畫完成」callback（下一次 ANIMATION_COMPLETE 觸發後自動移除）。 */
  private attachOnce(cb: () => void): void {
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, cb);
  }

  /** 目前狀態。 */
  getState(): AnimState | null {
    return this.currentState;
  }

  /**
   * 面向翻轉：+1 面右、-1 面左。
   * 註：SPUM 烘出來的 sprite 預設朝向與直覺相反，故此處 flipX 反轉，
   * 讓「面右不翻、面左翻」對應到正確視覺（按右→面右、按左→面左）。
   * 5 隻角色同套 SPUM 同方式烘、預設朝向一致，統一在這裡處理即可。
   */
  setFacing(facing: number): void {
    this.sprite.setFlipX(facing > 0);
  }

  /**
   * 設定整體縮放（相對 256×256 畫布）。
   * 會自動乘上該角色的 perCharScale 補償（見 animationConfig.PER_CHAR_SCALE），
   * 所以呼叫端只要傳共用的 SPRITE_SCALE，個別角色大小校正集中在 config。
   */
  setScale(scale: number): void {
    this.sprite.setScale(scale * getPerCharScale(this.charKey));
  }

  setPosition(x: number, y: number): void {
    this.sprite.setPosition(x, y);
  }

  destroy(): void {
    this.sprite.destroy();
  }
}

export { FRAME_SIZE };
