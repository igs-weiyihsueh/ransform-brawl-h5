import Phaser from 'phaser';
import { HUD_COLORS, SECOND_ENERGY_BAR_LAYOUT } from '@/config/uiConfig';
import { resolveSecondTransformDisplay } from '@/systems/ui/secondTransformDisplay';

/**
 * SecondEnergyBar — 二段變身能量條（橫條填充式；用戶正式規格：取代原「4 格技能槽 EnergyBar」）。
 *
 * 純顯示層：讀翼騎 TransformSystem 接口的比例（getSecondTransformEnergyRatio），畫一條橫向填充條：
 *  - 打怪累積 → ratio 上升 → 填充加長（charging 色）。
 *  - 滿 → 二段變身（核心處理放大/特效/攻擊範圍）。
 *  - 消退 → ratio 下降 → 填充縮短（active 色，二段變身中）；退完解除。
 *
 * 設計為「可嵌入容器」：以 local 座標 add 進頭上 UI 容器，隨玩家移動。位置沿用原 energy 區
 * （OVERHEAD_LAYOUT.energy x/y 一帶）。★feature flag 關時核心回 ratio 0 → 空條（不影響現況）。
 */
export class SecondEnergyBar {
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly fill: Phaser.GameObjects.Graphics;
  private readonly width: number;
  private readonly height: number;
  private readonly cornerRadius: number;
  /** 上次繪製狀態（ratio+是否 active）：變動才重畫，省開銷。 */
  private shownRatio = -1;
  private shownActive = false;

  /**
   * @param scene 場景。
   * @param parent 要嵌入的容器（頭上 UI 容器）。
   * @param originX 條左緣 local x（相對容器）。
   * @param originY 條頂緣 local y（相對容器）。
   */
  constructor(
    scene: Phaser.Scene,
    parent: Phaser.GameObjects.Container,
    originX: number,
    originY: number,
  ) {
    const cfg = SECOND_ENERGY_BAR_LAYOUT;
    this.width = cfg.width;
    this.height = cfg.height;
    this.cornerRadius = cfg.cornerRadius;

    this.bg = scene.add.graphics();
    this.bg.setPosition(originX, originY);
    parent.add(this.bg);

    this.fill = scene.add.graphics();
    this.fill.setPosition(originX, originY);
    parent.add(this.fill);

    this.drawBg();
    this.redraw();
  }

  /** 底槽（恆顯，暗色圓角條）。 */
  private drawBg(): void {
    this.bg.clear();
    this.bg.fillStyle(HUD_COLORS.secondBarBg, 1);
    this.bg.fillRoundedRect(0, 0, this.width, this.height, this.cornerRadius);
    this.bg.lineStyle(2, HUD_COLORS.energyStroke, 0.85);
    this.bg.strokeRoundedRect(0, 0, this.width, this.height, this.cornerRadius);
  }

  /**
   * 設定二段能量顯示（由 UISystem 每幀以翼騎接口值呼叫）。
   * @param available isSecondTransformAvailable（一段悟空後且 flag 開）。
   * @param active isSecondTransformActive（二段變身中→ active 色）。
   * @param ratio getSecondTransformEnergyRatio（0..1）填充/消退。
   */
  setSecond(available: boolean, active: boolean, ratio: number): void {
    const d = resolveSecondTransformDisplay(available, active, ratio);
    // available/active 皆否（含 flag 關）→ 空條（ratio 0）；否則依 ratio + active 樣式。
    const r = d.show ? d.ratio : 0;
    const act = d.show && d.style === 'active';
    if (r === this.shownRatio && act === this.shownActive) return;
    this.shownRatio = r;
    this.shownActive = act;
    this.redraw();
  }

  /** 用戶 #6：整條顯示開關（layout.overhead.energy.visible=false → 底槽+填充全隱）。 */
  setContainerVisible(visible: boolean): void {
    this.bg.setVisible(visible);
    this.fill.setVisible(visible);
  }

  /** 依目前 ratio/active 重畫填充。 */
  private redraw(): void {
    this.fill.clear();
    if (this.shownRatio > 0) {
      const color = this.shownActive ? HUD_COLORS.secondBarActive : HUD_COLORS.secondBarFill;
      const w = Math.max(0, Math.min(1, this.shownRatio)) * this.width;
      this.fill.fillStyle(color, 1);
      this.fill.fillRoundedRect(0, 0, w, this.height, this.cornerRadius);
    }
  }

  destroy(): void {
    this.bg.destroy();
    this.fill.destroy();
  }
}
