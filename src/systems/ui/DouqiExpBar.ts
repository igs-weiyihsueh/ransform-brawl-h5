import Phaser from 'phaser';
import { GAME_WIDTH } from '@/config/gameConfig';

/**
 * DouqiExpBar — 鬥氣模式 teamLevel + 經驗條 HUD（階段 3 commit4，用戶要 (B) 顯示）。
 *
 * ★只鬥氣模式建立/更新（GameScene 依 gameMode gate）；normal 模式不建＝HUD 不變、byte 安全。
 * 純顯示：頂部中央「Lv N」文字 + 經驗條（當前等級內進度 exp/expToNext）。scrollFactor 0 固定螢幕。combo 仍不顯示（用戶）。
 */
export class DouqiExpBar {
  private readonly barBg: Phaser.GameObjects.Rectangle;
  private readonly barFill: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private readonly barWidth = 320;
  private readonly barHeight = 14;
  private readonly x: number;
  private readonly y = 18;

  constructor(scene: Phaser.Scene) {
    this.x = GAME_WIDTH / 2;
    const depth = 2000; // HUD 最上層
    this.barBg = scene.add
      .rectangle(this.x, this.y, this.barWidth, this.barHeight, 0x2a2010, 0.85) // 暖色深底（金框內）
      .setStrokeStyle(2, 0xffd24d) // ★金色框（原藍框 0x8fd3ff→金，用戶要金色）
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(depth);
    this.barFill = scene.add
      .rectangle(this.x - this.barWidth / 2, this.y, 0, this.barHeight, 0xffd24d, 1) // 金色填充
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth + 1);
    this.label = scene.add
      .text(this.x, this.y + this.barHeight + 4, 'Lv 1', {
        fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
        fontSize: '20px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(depth + 1);
  }

  /**
   * 每幀更新（GameScene.update 於 douqi 呼）。
   * @param level 當前 teamLevel。
   * @param exp 當前等級內累積經驗。
   * @param expToNext 升下一級所需（0＝滿級）。
   */
  update(level: number, exp: number, expToNext: number): void {
    const ratio = expToNext > 0 ? Math.min(1, Math.max(0, exp / expToNext)) : 1; // 滿級填滿
    this.barFill.width = this.barWidth * ratio;
    this.label.setText(expToNext > 0 ? `Lv ${level}` : `Lv ${level} MAX`);
  }

  destroy(): void {
    this.barBg.destroy();
    this.barFill.destroy();
    this.label.destroy();
  }
}
