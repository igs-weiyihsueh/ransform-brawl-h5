import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '@/config/gameConfig';

/** DouqiSpawnSystem 狀態機對外查詢（本 HUD 依賴這些）。 */
export interface DouqiWaveInfo {
  getState(): string;
  getCurrentWave(): number;
  /** 事件種類（'tower'|'guard'|'capture'|'none'）——決定事件 HUD 顯示。 */
  getEventKind?(): string;
  /** 塔事件血條 ratio（0~1；非 tower 回 -1）。 */
  getTowerHpRatio?(): number;
  /** 守護事件 NPC 血條 ratio（0~1；非 guard 回 -1）。 */
  getGuardHpRatio?(): number;
  /** 佔領事件進度 ratio（0~1；非 capture 回 -1）。 */
  getCaptureRatio?(): number;
  /** guard/capture 剩餘秒（倒數；無回 -1）。 */
  getEventRemainSec?(): number;
  /** BOSS 血條 ratio（0~1；非 boss 回 -1）。 */
  getBossHpRatio?(): number;
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
  /** ★事件 HUD：塔血條（tower 事件時顯示；佔領/守護 commit2 擴充）。 */
  private readonly eventBar: Phaser.GameObjects.Graphics;
  private readonly eventLabel: Phaser.GameObjects.Text;

  /** 上一幀觀察到的關卡/狀態（偵測轉場）。 */
  private lastWave = 0;
  private lastState = '';
  private lastEventKind = 'none';

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
    // ★事件 HUD：塔血條（下方置中，tower 事件才顯示）+ 標籤。
    this.eventBar = scene.add.graphics().setScrollFactor(0).setDepth(depth).setVisible(false);
    this.eventLabel = scene.add
      .text(GAME_WIDTH / 2, 56, '', {
        fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
        fontSize: '18px',
        color: '#ff8888',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(depth + 1)
      .setVisible(false);
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
      } else if (state === 'boss') {
        this.showBanner('最終 BOSS 出現!', 0xff4466); // 仿 BOSS 紅字
      } else if (state === 'won') {
        this.showBanner('通關! 擊倒最終 BOSS', 0xffe066);
      }
    }
    // 進新關 spawning（關卡遞增）：彈「WAVE N」。
    if (state === 'spawning' && wave > this.lastWave) {
      this.showBanner(`WAVE ${wave}`, 0xffd24d);
    }

    // ★事件 HUD（塔/守護/佔領血條進度 + 登場提示）。
    const eventKind = info.getEventKind?.() ?? 'none';
    if (eventKind !== this.lastEventKind) {
      if (eventKind === 'tower') this.showBanner('魔尖塔 出現!', 0xffcc33);
      else if (eventKind === 'guard') this.showBanner('守護目標!', 0x66ccff);
      else if (eventKind === 'capture') this.showBanner('佔領據點!', 0x66ff88);
      this.lastEventKind = eventKind;
    }
    this.updateEventBar(info);

    this.lastWave = wave;
    this.lastState = state;
  }

  /** 事件血條/進度條（塔 HP / 守護 NPC HP / 佔領進度 + 倒數）。非事件→隱藏。 */
  private updateEventBar(info: DouqiWaveInfo): void {
    const kind = info.getEventKind?.() ?? 'none';
    let ratio = -1;
    let label = '';
    let barColor = 0xff4444;
    if (kind === 'tower') {
      ratio = info.getTowerHpRatio?.() ?? -1;
      label = '魔尖塔 HP';
      barColor = 0xff4444;
    } else if (kind === 'guard') {
      ratio = info.getGuardHpRatio?.() ?? -1;
      const sec = info.getEventRemainSec?.() ?? -1;
      label = `守護 NPC HP${sec >= 0 ? `  ⏱ ${Math.ceil(sec)}s` : ''}`;
      barColor = 0x66ccff;
    } else if (kind === 'capture') {
      ratio = info.getCaptureRatio?.() ?? -1;
      const sec = info.getEventRemainSec?.() ?? -1;
      label = `佔領進度 ${Math.round((ratio < 0 ? 0 : ratio) * 100)}%${sec >= 0 ? `  ⏱ ${Math.ceil(sec)}s` : ''}`;
      barColor = 0x66ff88;
    } else {
      // BOSS 戰（state='boss'，eventKind='none'）：讀 BOSS 血條。
      const bossR = info.getBossHpRatio?.() ?? -1;
      if (bossR >= 0) {
        ratio = bossR;
        label = '最終 BOSS HP';
        barColor = 0xff2244;
      }
    }
    const show = ratio >= 0;
    this.eventBar.setVisible(show);
    this.eventLabel.setVisible(show);
    if (!show) return;
    const w = 360;
    const h = 14;
    const x = GAME_WIDTH / 2 - w / 2;
    const y = 80;
    this.eventLabel.setText(label);
    this.eventBar.clear();
    this.eventBar.fillStyle(0x101010, 0.85).fillRect(x, y, w, h);
    this.eventBar.fillStyle(barColor, 1).fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), h);
    this.eventBar.lineStyle(2, 0xffffff, 0.6).strokeRect(x, y, w, h);
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
    this.eventBar.destroy();
    this.eventLabel.destroy();
  }
}
