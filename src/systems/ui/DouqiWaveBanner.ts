import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '@/config/gameConfig';

/** DouqiSpawnSystem 狀態機對外查詢（本 HUD 只依賴這兩個 + 狀態字串）。 */
export interface DouqiWaveInfo {
  getState(): string;
  getCurrentWave(): number;
}

/**
 * DouqiWaveBanner — 鬥氣模式波次推進宣告 HUD（實機修：用戶反映「完全沒有波次推進宣告」）。
 *
 * ★只鬥氣模式建立/更新（GameScene 依 gameMode gate、比照 DouqiExpBar）；normal 模式不建＝HUD 不變 byte 安全。
 * 顯示兩塊（v45 showWaveClear 那套）：
 *  1. 常駐左上「第 N 關」——恆顯示目前關卡。
 *  2. 過場中央宣告——開新波(spawning 新關)彈「WAVE N」、過關(進 intermission)彈「WAVE N CLEAR!」、通關彈「ALL CLEAR!」，
 *     tween 淡入放大→停留→淡出（過場感，不常駐擋畫面）。
 * 純顯示：每幀讀 DouqiSpawnSystem getState()/getCurrentWave()，偵測狀態/關卡變化觸發過場。scrollFactor 0 固定螢幕。
 */
export class DouqiWaveBanner {
  private readonly scene: Phaser.Scene;
  private readonly waveLabel: Phaser.GameObjects.Text; // 常駐「第 N 關」
  private readonly banner: Phaser.GameObjects.Text; // 過場宣告
  private bannerTween: Phaser.Tweens.Tween | null = null;

  /** 上一幀觀察到的關卡/狀態（偵測轉場）。 */
  private lastWave = 0;
  private lastState = '';

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const depth = 2000;
    this.waveLabel = scene.add
      .text(16, 16, '第 1 關', {
        fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
        fontSize: '22px',
        color: '#ffd24d',
        fontStyle: 'bold',
        stroke: '#2a2010',
        strokeThickness: 4,
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth);
    this.banner = scene.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.34, '', {
        fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
        fontSize: '56px',
        color: '#ffffff',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 6,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(depth + 1)
      .setAlpha(0);
  }

  /** 每幀更新（GameScene.update 於 douqi 呼）：常駐關卡文字 + 偵測轉場彈過場宣告。 */
  update(info: DouqiWaveInfo): void {
    const wave = info.getCurrentWave();
    const state = info.getState();
    // 常駐關卡文字。
    this.waveLabel.setText(`第 ${wave} 關`);

    if (this.lastState === '' && this.lastWave === 0) {
      // 首幀初始化：不彈過場，記錄基準（開場「WAVE 1」在下方 spawning 首見時觸發）。
      this.lastWave = wave;
      this.lastState = state;
      if (state === 'spawning') this.showBanner(`WAVE ${wave}`, 0xffd24d);
      return;
    }

    // 過關 → intermission（或 boss/event）：彈「WAVE N CLEAR!」。
    if (state !== this.lastState) {
      if (state === 'intermission') {
        this.showBanner(`WAVE ${this.lastWave} CLEAR!`, 0x8fffa0);
      } else if (state === 'won') {
        this.showBanner('ALL CLEAR!', 0xffe066);
      }
    }
    // 進新關 spawning（關卡遞增）：彈「WAVE N」。
    if (state === 'spawning' && wave > this.lastWave) {
      this.showBanner(`WAVE ${wave}`, 0xffd24d);
    }

    this.lastWave = wave;
    this.lastState = state;
  }

  /** 過場宣告：淡入放大→停留→淡出。 */
  private showBanner(text: string, color: number): void {
    this.banner.setText(text).setColor(`#${color.toString(16).padStart(6, '0')}`);
    this.bannerTween?.stop();
    this.banner.setAlpha(0).setScale(0.7);
    this.bannerTween = this.scene.tweens.add({
      targets: this.banner,
      alpha: { from: 0, to: 1 },
      scale: { from: 0.7, to: 1.1 },
      ease: 'Back.easeOut',
      duration: 260,
      yoyo: false,
      hold: 900,
      completeDelay: 0,
      onComplete: () => {
        this.scene.tweens.add({
          targets: this.banner,
          alpha: 0,
          duration: 420,
        });
      },
    });
  }

  destroy(): void {
    this.bannerTween?.stop();
    this.waveLabel.destroy();
    this.banner.destroy();
  }
}
