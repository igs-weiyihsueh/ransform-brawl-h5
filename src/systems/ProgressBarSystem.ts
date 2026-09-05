import Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import { PANEL_DEPTH, UI_ICONS } from '@/config/uiConfig';
import {
  NODE_COLORS,
  PROGRESS_BAR,
  barLeftX,
  barWidth,
  guardTimeRatio,
  nodeIconKind,
  nodeMarkerState,
  nodeMarkerX,
  segmentFill,
  shouldPulse,
} from '@/systems/progressBars';

/** 節點類型 → 已載入的 icon key（graceful：沒載到則不放 icon）。 */
const NODE_ICON_KEY: Record<'spawn' | 'reward' | 'event', string> = {
  spawn: UI_ICONS.nodeSpawn.key,
  reward: UI_ICONS.nodeReward.key,
  event: UI_ICONS.nodeEvent.key,
};

/**
 * ProgressBarSystem — 關卡進度條（#2 對照 Unity LevelProgressUI「珠子串繩節點條」）：
 *  - N 個節點圓沿 bar 均分（perNodeWidth=160），圓底 + 中心類型 icon（spawn/reward/event）。
 *  - N-1 段填充繩：填在節點 i 右緣~i+1 左緣的空隙（珠子間的繩），表現節點間推進。
 *  - 三態染色：已過=亮青、當前=亮黃+脈動、未到=暗灰。
 *  - 守護波中 / 關卡結束 / 無節點 → 整條往上滑走（不擋畫面，解決「太上面」）。
 *  - 守護波倒數金條保留，畫在條下方（錯開）。
 * 只讀 WaveSystem/GuardEvent 狀態，不回寫；container scrollFactor0 獨立 HUD。
 */
export class ProgressBarSystem implements GameSystem {
  readonly name = 'ProgressBarSystem';
  private ctx!: GameContext;
  private root!: Phaser.GameObjects.Container; // 整條，滑動用
  private gfx!: Phaser.GameObjects.Graphics; // bar 底槽 + 段填充繩 + 節點圓底
  private guardGfx!: Phaser.GameObjects.Graphics; // 守護波倒數金條
  private nodeIcons: Phaser.GameObjects.Image[] = [];
  private builtCount = -1; // 已建 icon 對應的節點數（重建判斷）
  private pulseT = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const scene = ctx.scene;
    this.root = scene.add.container(0, PROGRESS_BAR.shownY).setScrollFactor(0).setDepth(PANEL_DEPTH);
    this.gfx = scene.add.graphics();
    this.guardGfx = scene.add.graphics();
    this.root.add(this.gfx);
    this.root.add(this.guardGfx);
  }

  update(dt: number): void {
    const wave = this.ctx.wave;
    const total = wave.getNodeCount();
    const nodeIndex = wave.getNodeIndex();
    const types = wave.getNodeTypes();
    const guard = wave.getGuardEvent();
    const guardActive = !!guard && !guard.isFinished();

    // 隱藏條件：守護波中 / 無節點 / 關卡跑完（nodeIndex >= total）→ 往上滑走。
    const hidden = guardActive || total <= 0 || nodeIndex >= total;
    const targetY = hidden ? PROGRESS_BAR.shownY - PROGRESS_BAR.slideHideOffsetY : PROGRESS_BAR.shownY;
    // 指數趨近（slideSpeed）。
    const k = 1 - Math.exp(-PROGRESS_BAR.slideSpeed * dt);
    this.root.y += (targetY - this.root.y) * k;

    this.pulseT += dt;

    // 重建 icon（節點數變了才重建，省開銷）。
    if (this.builtCount !== total) this.rebuildIcons(total, types);

    this.gfx.clear();
    if (total > 0) this.drawBeadBar(total, nodeIndex, types);

    // 守護波倒數金條（守護波才顯示；畫在條下方）。
    this.guardGfx.clear();
    if (guardActive && guard) {
      const g = guardTimeRatio(guard.getRemaining(), guard.getTimeLimit());
      const gw = PROGRESS_BAR.guard.width;
      const gx = PROGRESS_BAR.centerX - gw / 2;
      const gy = PROGRESS_BAR.guard.offsetY;
      this.guardGfx.fillStyle(0x000000, 0.55);
      this.guardGfx.fillRoundedRect(gx, gy, gw, PROGRESS_BAR.guard.height, 6);
      if (g > 0) {
        this.guardGfx.fillStyle(0xffca28, 1);
        this.guardGfx.fillRoundedRect(gx, gy, Math.max(12, gw * g), PROGRESS_BAR.guard.height, 6);
      }
      this.guardGfx.lineStyle(2, 0xffffff, 0.8);
      this.guardGfx.strokeRoundedRect(gx, gy, gw, PROGRESS_BAR.guard.height, 6);
    }
  }

  /** 依節點數/類型重建節點 icon（container 相對座標；沒載到 icon 則略過該 icon）。 */
  private rebuildIcons(total: number, types: readonly string[]): void {
    for (const img of this.nodeIcons) img.destroy();
    this.nodeIcons = [];
    const scene = this.ctx.scene;
    for (let i = 0; i < total; i += 1) {
      const kind = nodeIconKind(types[i]);
      const key = NODE_ICON_KEY[kind];
      if (!scene.textures.exists(key)) continue; // graceful：只畫圓底
      const cx = nodeMarkerX(i, total);
      const img = scene.add
        .image(cx, 0, key)
        .setDisplaySize(PROGRESS_BAR.iconSize, PROGRESS_BAR.iconSize);
      this.nodeIcons.push(img);
      this.root.add(img);
    }
    this.builtCount = total;
  }

  /** 畫珠子串繩：底繩 + N-1 段填充 + N 個節點圓（三態染色）+ 更新 icon 位置/色/脈動。 */
  private drawBeadBar(total: number, nodeIndex: number, types: readonly string[]): void {
    const left = barLeftX(total);
    const w = barWidth(total);
    const cy = 0; // container 內相對 Y（root.y 已是螢幕 Y）
    const h = PROGRESS_BAR.barHeight;
    const nodeR = PROGRESS_BAR.nodeRadius;

    // 底繩（整條暗槽）。
    this.gfx.fillStyle(0x000000, 0.5);
    this.gfx.fillRoundedRect(left, cy - h / 2, w, h, h / 2);

    // N-1 段填充繩：節點 i 右緣 → i+1 左緣。
    const segRatio = this.currentSegmentRatio();
    const segH = h * 0.9;
    for (let i = 0; i < total - 1; i += 1) {
      const xi = nodeMarkerX(i, total) + nodeR; // 節點 i 右緣
      const xj = nodeMarkerX(i + 1, total) - nodeR; // 節點 i+1 左緣
      const segW = Math.max(0, xj - xi);
      if (segW <= 0) continue;
      const fill = segmentFill(i, nodeIndex, segRatio);
      if (fill <= 0) continue;
      this.gfx.fillStyle(NODE_COLORS.past, 1);
      this.gfx.fillRect(xi, cy - segH / 2, segW * fill, segH);
    }

    // N 個節點圓（三態）+ icon 位置/染色/脈動。
    let iconIdx = 0;
    for (let i = 0; i < total; i += 1) {
      const cx = nodeMarkerX(i, total);
      const state = nodeMarkerState(i, nodeIndex);
      const color =
        state === 'past' ? NODE_COLORS.past : state === 'current' ? NODE_COLORS.current : NODE_COLORS.future;
      // 變黃≠放大：當前節點平常維持一般大小（只變黃），只有「快完成」(shouldPulse) 才放大脈動。
      let r = nodeR;
      let scale = 1;
      if (shouldPulse(i, nodeIndex, segRatio)) {
        scale = 1 + Math.sin(this.pulseT * PROGRESS_BAR.pulseSpeed) * PROGRESS_BAR.pulseAmount;
        r = PROGRESS_BAR.nodeRadiusCurrent * scale;
      }
      // 深灰圓底 + 狀態色外圈。
      this.gfx.fillStyle(0x1a1a2a, state === 'future' ? 0.8 : 1);
      this.gfx.fillCircle(cx, cy, r);
      this.gfx.lineStyle(state === 'current' ? 4 : 3, color, 1);
      this.gfx.strokeCircle(cx, cy, r);

      // icon（若有）：染狀態色 + 跟隨當前脈動縮放。
      const kind = nodeIconKind(types[i]);
      if (this.ctx.scene.textures.exists(NODE_ICON_KEY[kind]) && iconIdx < this.nodeIcons.length) {
        const img = this.nodeIcons[iconIdx];
        iconIdx += 1;
        img.setPosition(cx, cy);
        img.setTint(color);
        img.setDisplaySize(PROGRESS_BAR.iconSize * scale, PROGRESS_BAR.iconSize * scale);
      }
    }
  }

  /**
   * 當前節點內的推進比例（0..1）：讀 WaveSystem.getNodeProgress（Spawn=kills/quota、
   * Event=時間比例、其他=0）。開場 kills=0 → 0（修正「開場就有進度」）；隨擊殺/時間往前填（修「不前進」）。
   */
  private currentSegmentRatio(): number {
    return this.ctx.wave.getNodeProgress?.() ?? 0;
  }

  destroy(): void {
    for (const img of this.nodeIcons) img.destroy();
    this.nodeIcons = [];
    this.gfx?.destroy();
    this.guardGfx?.destroy();
    this.root?.destroy();
  }
}
