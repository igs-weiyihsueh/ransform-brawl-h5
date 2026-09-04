import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import {
  ENERGY_BAR_LAYOUT,
  HUD_COLORS,
  HUD_DEPTH,
  HUD_FONT_FAMILY,
} from '@/config/uiConfig';

/**
 * EnergyBar — 能量條 UI 元件（4 格視覺框架）。
 *
 * 對照 Unity：普攻命中亮一格能量、4 格滿可放招。
 * 本元件是「純顯示層」：只提供 setEnergy(n) 由 UISystem 依資料來源刷新，
 * 自身不知道能量怎麼來（能量系統尚未實作，UISystem 目前接 stub 回 0）。
 *
 * 版面：置於畫面下方中央，固定螢幕座標（setScrollFactor 0）不隨相機移動。
 */
export class EnergyBar {
  private readonly cells: Phaser.GameObjects.Graphics[] = [];
  private readonly label: Phaser.GameObjects.Text;
  /** 目前充能格數。 */
  private value = 0;
  /** 是否處於「滿格閃爍」狀態。 */
  private full = false;
  /** 閃爍相位計時（秒），只在 full 時累加。 */
  private flashTime = 0;

  constructor(scene: Phaser.Scene) {
    const cfg = ENERGY_BAR_LAYOUT;
    const totalWidth =
      cfg.cellCount * cfg.cellWidth + (cfg.cellCount - 1) * cfg.cellGap;
    const startX = (GAME_WIDTH - totalWidth) / 2;
    const y = GAME_HEIGHT - cfg.bottomOffset - cfg.cellHeight;

    // 標籤（少字兒童向）。
    this.label = scene.add
      .text(GAME_WIDTH / 2, y - cfg.labelGap, cfg.label, {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: cfg.labelFontSize,
        color: HUD_COLORS.text,
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH);

    for (let i = 0; i < cfg.cellCount; i++) {
      const gfx = scene.add.graphics();
      gfx.setScrollFactor(0).setDepth(HUD_DEPTH);
      gfx.setPosition(startX + i * (cfg.cellWidth + cfg.cellGap), y);
      this.cells.push(gfx);
    }

    this.redraw();
  }

  /**
   * 設定目前充能格數（0..cellCount）。由 UISystem 每幀以資料來源呼叫。
   * @param value 充能格數；會被夾到 [0, cellCount]。
   */
  setEnergy(value: number): void {
    const cfg = ENERGY_BAR_LAYOUT;
    const clamped = Phaser.Math.Clamp(Math.floor(value), 0, cfg.cellCount);
    if (clamped === this.value) return;
    this.value = clamped;

    const nowFull = clamped >= cfg.cellCount;
    if (nowFull && !this.full) {
      // 剛達滿格：重置閃爍相位，讓提示從頭開始。
      this.flashTime = 0;
    }
    this.full = nowFull;
    this.redraw();
  }

  /**
   * 每幀更新：滿格時推進閃爍相位並重畫（對照 Unity ShowReady 的來回閃爍）。
   * 未滿格時不做事（靜態，避免無謂重畫）。由 UISystem.update 傳 dt 呼叫。
   */
  update(dt: number): void {
    if (!this.full) return;
    this.flashTime += dt;
    this.redraw();
  }

  /** 依目前 value / full / flashTime 重畫所有格子。 */
  private redraw(): void {
    const cfg = ENERGY_BAR_LAYOUT;
    // 滿格閃爍色：白↔亮綠，用三角波在 [0,1] 來回。
    let fullColor = 0;
    if (this.full) {
      const f = cfg.readyFlash;
      const phase = (this.flashTime % f.periodSec) / f.periodSec; // 0..1
      const t = 1 - Math.abs(phase * 2 - 1); // 三角波：0→1→0
      fullColor = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.IntegerToColor(f.colorA),
        Phaser.Display.Color.IntegerToColor(f.colorB),
        100,
        Math.round(t * 100),
      ).color;
    }

    for (let i = 0; i < this.cells.length; i++) {
      const gfx = this.cells[i];
      const on = i < this.value;
      gfx.clear();
      // 滿格→整條同步閃爍；否則已充能亮金、未充能暗色。
      const fill = this.full
        ? fullColor
        : on
          ? HUD_COLORS.energyOn
          : HUD_COLORS.energyOff;
      gfx.fillStyle(fill, 1);
      gfx.fillRoundedRect(0, 0, cfg.cellWidth, cfg.cellHeight, cfg.cornerRadius);
      gfx.lineStyle(3, HUD_COLORS.energyStroke, 0.85);
      gfx.strokeRoundedRect(0, 0, cfg.cellWidth, cfg.cellHeight, cfg.cornerRadius);
    }
  }

  destroy(): void {
    for (const gfx of this.cells) gfx.destroy();
    this.label.destroy();
  }
}
