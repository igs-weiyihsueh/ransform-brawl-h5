import Phaser from 'phaser';
import {
  COMBO_LAYOUT,
  HUD_COLORS,
  HUD_DEPTH,
  HUD_FONT_FAMILY,
} from '@/config/uiConfig';

/**
 * ComboCounter — COMBO 連擊數字 UI 元件。
 *
 * 對照 Unity：連續命中累加 COMBO 數。本元件為純顯示層：
 * 只提供 setCombo(n) 由 UISystem 依資料來源刷新（COMBO 系統尚未實作 → 目前接 stub 回 0）。
 *
 * 版面：右上角，大數字兒童向；combo=0 時整組隱藏（hideWhenZero）。
 * 固定螢幕座標不隨相機移動。
 */
export class ComboCounter {
  private readonly numberText: Phaser.GameObjects.Text;
  private readonly labelText: Phaser.GameObjects.Text;
  private shownValue = -1;

  constructor(scene: Phaser.Scene) {
    const cfg = COMBO_LAYOUT;

    this.labelText = scene.add
      .text(cfg.x, cfg.y, cfg.label, {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: cfg.labelFontSize,
        color: HUD_COLORS.comboText,
        fontStyle: 'bold',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH);

    this.numberText = scene.add
      .text(cfg.x, cfg.y + this.labelText.height, '0', {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: cfg.numberFontSize,
        color: HUD_COLORS.comboText,
        fontStyle: 'bold',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH);

    this.setCombo(0);
  }

  /**
   * 設定目前 COMBO 數。由 UISystem 每幀以資料來源呼叫。
   * @param value COMBO 連擊數（>=0）。
   */
  setCombo(value: number): void {
    const cfg = COMBO_LAYOUT;
    const n = Math.max(0, Math.floor(value));
    if (n === this.shownValue) return;
    this.shownValue = n;

    const visible = !(cfg.hideWhenZero && n === 0);
    this.labelText.setVisible(visible);
    this.numberText.setVisible(visible);
    if (visible) {
      this.numberText.setText(`${n}`);
    }
  }

  destroy(): void {
    this.numberText.destroy();
    this.labelText.destroy();
  }
}
