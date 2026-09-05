import Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import { HUD_COLORS, HUD_FONT_FAMILY, PANEL_DEPTH } from '@/config/uiConfig';
import {
  PROGRESS_BAR,
  guardTimeRatio,
  levelProgressRatio,
} from '@/systems/progressBars';

/**
 * ProgressBarSystem — 頂部進度條 HUD（#7，純視覺讀取）：
 *  1. 關卡進度條：已完成節點 / 總節點（WaveSystem.getNodeIndex/getNodeCount）。
 *  2. 守護波倒數條：remaining / timeLimit（GuardEvent），守護波才顯示、結束隱藏。
 * 只讀 WaveSystem/GuardEvent 狀態，不回寫；graphics 每幀重畫。獨立 HUD 條，不衝界騎 per-player 面板。
 */
export class ProgressBarSystem implements GameSystem {
  readonly name = 'ProgressBarSystem';
  private ctx!: GameContext;
  private gfx!: Phaser.GameObjects.Graphics;
  private levelLabel!: Phaser.GameObjects.Text;
  private guardLabel!: Phaser.GameObjects.Text;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const scene = ctx.scene;
    this.gfx = scene.add.graphics().setScrollFactor(0).setDepth(PANEL_DEPTH);
    this.levelLabel = scene.add
      .text(PROGRESS_BAR.level.x, PROGRESS_BAR.level.y - 20, '關卡進度', {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: '16px',
        color: HUD_COLORS.text,
      })
      .setScrollFactor(0)
      .setDepth(PANEL_DEPTH);
    this.guardLabel = scene.add
      .text(PROGRESS_BAR.guard.x, PROGRESS_BAR.guard.y - 18, '守護倒數', {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: '15px',
        color: '#ffe64d',
      })
      .setScrollFactor(0)
      .setDepth(PANEL_DEPTH)
      .setVisible(false);
  }

  update(_dt: number): void {
    const wave = this.ctx.wave;
    this.gfx.clear();

    // 1) 關卡進度條（頂部橫條）。
    const ratio = levelProgressRatio(wave.getNodeIndex(), wave.getNodeCount());
    this.drawBar(PROGRESS_BAR.level, ratio, 0x4fc3f7);

    // 2) 守護波倒數條（守護波進行中才顯示）。
    const guard = wave.getGuardEvent();
    if (guard && !guard.isFinished()) {
      const g = guardTimeRatio(guard.getRemaining(), guard.getTimeLimit());
      this.drawBar(PROGRESS_BAR.guard, g, 0xffca28);
      this.guardLabel.setVisible(true);
    } else {
      this.guardLabel.setVisible(false);
    }
  }

  /** 畫一條進度條（底槽 + 填充）。 */
  private drawBar(
    b: { x: number; y: number; width: number; height: number },
    ratio: number,
    fillColor: number,
  ): void {
    const r = 6;
    // 底槽。
    this.gfx.fillStyle(0x000000, 0.55);
    this.gfx.fillRoundedRect(b.x, b.y, b.width, b.height, r);
    // 填充。
    if (ratio > 0) {
      this.gfx.fillStyle(fillColor, 1);
      this.gfx.fillRoundedRect(b.x, b.y, Math.max(r * 2, b.width * ratio), b.height, r);
    }
    // 外框。
    this.gfx.lineStyle(2, 0xffffff, 0.8);
    this.gfx.strokeRoundedRect(b.x, b.y, b.width, b.height, r);
  }

  destroy(): void {
    this.gfx?.destroy();
    this.levelLabel?.destroy();
    this.guardLabel?.destroy();
  }
}
