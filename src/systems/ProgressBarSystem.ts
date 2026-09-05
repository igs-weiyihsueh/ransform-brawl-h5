import Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import { HUD_COLORS, HUD_FONT_FAMILY, PANEL_DEPTH } from '@/config/uiConfig';
import {
  PROGRESS_BAR,
  guardTimeRatio,
  levelProgressRatio,
  nodeMarkerState,
  nodeMarkerX,
} from '@/systems/progressBars';

/**
 * ProgressBarSystem — 頂部進度條 HUD（#7；#2 加節點 marker + 位置下移）：
 *  1. 關卡進度條 + **節點序列 marker**：沿條畫各節點圓點（已過=實心亮/當前=高亮放大/未到=空心暗），
 *     守護波(Event)節點用金色菱形標記。填充到「當前節點」位置。
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
      .text(PROGRESS_BAR.level.x, PROGRESS_BAR.level.y - 22, '關卡進度', {
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

    // 1) 關卡進度條 + 節點 marker。
    const nodeIndex = wave.getNodeIndex();
    const total = wave.getNodeCount();
    const ratio = levelProgressRatio(nodeIndex, total);
    this.drawBar(PROGRESS_BAR.level, ratio, 0x4fc3f7);
    this.drawNodeMarkers(nodeIndex, total, wave.getNodeTypes());

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

  /** 沿關卡進度條畫節點序列 marker（過去/當前/未來 + 守護波節點特別標記）。 */
  private drawNodeMarkers(nodeIndex: number, total: number, types: readonly string[]): void {
    if (total <= 0) return;
    const b = PROGRESS_BAR.level;
    const cy = b.y + b.height / 2;
    for (let i = 0; i < total; i += 1) {
      const cx = nodeMarkerX(i, total, b.x, b.width);
      const state = nodeMarkerState(i, nodeIndex);
      const isGuard = types[i] === 'Event';
      const isReward = types[i] === 'Reward';

      // 顏色/大小：已過=實心亮、當前=高亮放大、未到=空心暗。
      let fill = 0x8899aa; // 未到（暗）
      let alpha = 0.5;
      let radius: number = PROGRESS_BAR.markerRadius;
      if (state === 'past') {
        fill = 0x4fc3f7;
        alpha = 1;
      } else if (state === 'current') {
        fill = 0xffffff;
        alpha = 1;
        radius = PROGRESS_BAR.markerRadiusCurrent;
      }
      // 守護波(Event)節點用金色、Reward 用綠色點出（覆蓋 base 色，仍保留過去/當前亮度）。
      if (isGuard && state !== 'current') fill = 0xffca28;
      else if (isReward && state !== 'current') fill = 0x66bb6a;

      // 外圈（白描邊，當前更粗）。
      this.gfx.lineStyle(state === 'current' ? 3 : 2, 0xffffff, 0.9);
      if (isGuard) {
        // 守護波節點：菱形（盾/星意象的簡化）。
        this.drawDiamond(cx, cy, radius, fill, alpha, state === 'past' || state === 'current');
      } else {
        this.gfx.fillStyle(fill, alpha);
        // 未到=空心（只描邊）、已過/當前=實心。
        if (state === 'future') this.gfx.strokeCircle(cx, cy, radius);
        else {
          this.gfx.fillCircle(cx, cy, radius);
          this.gfx.strokeCircle(cx, cy, radius);
        }
      }
    }
  }

  /** 畫菱形 marker（守護波節點）；filled 決定實心或空心。 */
  private drawDiamond(
    cx: number,
    cy: number,
    r: number,
    fill: number,
    alpha: number,
    filled: boolean,
  ): void {
    const pts = [cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy];
    if (filled) {
      this.gfx.fillStyle(fill, alpha);
      this.gfx.fillPoints(
        [
          new Phaser.Geom.Point(pts[0], pts[1]),
          new Phaser.Geom.Point(pts[2], pts[3]),
          new Phaser.Geom.Point(pts[4], pts[5]),
          new Phaser.Geom.Point(pts[6], pts[7]),
        ],
        true,
      );
    }
    this.gfx.strokePoints(
      [
        new Phaser.Geom.Point(pts[0], pts[1]),
        new Phaser.Geom.Point(pts[2], pts[3]),
        new Phaser.Geom.Point(pts[4], pts[5]),
        new Phaser.Geom.Point(pts[6], pts[7]),
      ],
      true,
    );
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
