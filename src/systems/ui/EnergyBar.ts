import Phaser from 'phaser';
import { ENERGY_BAR_LAYOUT, HUD_COLORS } from '@/config/uiConfig';

/**
 * EnergyBar — 能量 4 格 UI 元件（對照 Unity SkillGauge Slot0~3）。
 *
 * 純顯示層：只提供 setEnergy(n) 與 update(dt)（滿格閃爍），
 * 自身不知道能量怎麼來（能量系統尚未實作，UISystem 目前接 stub）。
 *
 * 設計為「可嵌入容器」：格子以 local 座標 add 進傳入的 parent 容器，
 * 這樣能量條可隨角色頭上 UI 容器一起跟隨玩家移動（世界座標）。
 * 對照 Unity：普攻命中亮一格、4 格滿 → 白↔亮綠來回閃爍當可放招提示。
 */
export class EnergyBar {
  private readonly cells: Phaser.GameObjects.Graphics[] = [];
  /** 目前充能格數。 */
  private value = 0;
  /** 是否滿格閃爍中。 */
  private full = false;
  /** 閃爍相位計時（秒）。 */
  private flashTime = 0;

  /**
   * @param scene 場景。
   * @param parent 要嵌入的容器（頭上 UI 容器）。
   * @param originX 第一格左緣的 local x（相對容器）。
   * @param originY 格子頂緣的 local y（相對容器）。
   */
  constructor(
    scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    originX: number,
    originY: number,
  ) {
    const cfg = ENERGY_BAR_LAYOUT;
    for (let i = 0; i < cfg.cellCount; i++) {
      const gfx = scene.add.graphics();
      gfx.setPosition(originX + i * (cfg.cellWidth + cfg.cellGap), originY);
      parent.add(gfx);
      this.cells.push(gfx);
    }
    this.redraw();
  }

  /**
   * 設定目前充能格數（0..cellCount）。由 UISystem 每幀以資料來源呼叫。
   * @param value 充能格數；夾到 [0, cellCount]。
   */
  setEnergy(value: number): void {
    const cfg = ENERGY_BAR_LAYOUT;
    const clamped = Phaser.Math.Clamp(Math.floor(value), 0, cfg.cellCount);
    if (clamped === this.value) return;
    this.value = clamped;

    const nowFull = clamped >= cfg.cellCount;
    if (nowFull && !this.full) this.flashTime = 0; // 剛滿：重置閃爍相位
    this.full = nowFull;
    this.redraw();
  }

  /**
   * 每幀更新：滿格時推進閃爍相位並重畫。未滿格不做事（靜態）。
   * 由 UISystem.update 傳 dt 呼叫。
   */
  update(dt: number): void {
    if (!this.full) return;
    this.flashTime += dt;
    this.redraw();
  }

  /** 依目前 value / full / flashTime 重畫所有格子。 */
  private redraw(): void {
    const cfg = ENERGY_BAR_LAYOUT;
    let fullColor = 0;
    if (this.full) {
      const f = cfg.readyFlash;
      const phase = (this.flashTime % f.periodSec) / f.periodSec; // 0..1
      const t = 1 - Math.abs(phase * 2 - 1); // 三角波 0→1→0
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
      const fill = this.full
        ? fullColor
        : on
          ? HUD_COLORS.energyOn
          : HUD_COLORS.energyOff;
      gfx.fillStyle(fill, 1);
      gfx.fillRoundedRect(0, 0, cfg.cellWidth, cfg.cellHeight, cfg.cornerRadius);
      gfx.lineStyle(2, HUD_COLORS.energyStroke, 0.85);
      gfx.strokeRoundedRect(0, 0, cfg.cellWidth, cfg.cellHeight, cfg.cornerRadius);
    }
  }

  destroy(): void {
    for (const gfx of this.cells) gfx.destroy();
  }
}
