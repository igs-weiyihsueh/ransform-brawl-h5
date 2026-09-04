import Phaser from 'phaser';
import {
  HUD_COLORS,
  HUD_FONT_FAMILY,
  OVERHEAD_DEPTH,
  OVERHEAD_LAYOUT,
} from '@/config/uiConfig';
import { EnergyBar } from '@/systems/ui/EnergyBar';

/**
 * PlayerOverheadUI — 角色頭上 UI（對照 Unity PlayerUI 200×80）。
 *
 * 世界座標容器，每幀跟隨玩家浮在頭上（setPosition）。內含：
 *  - 玩家編號牌（P1）
 *  - 魂力環（60×60 圓環，stub 先固定滿）
 *  - Credit 數字 + 金幣 icon（stub）
 *  - 能量 4 格（EnergyBar 嵌入，接現有 getEnergy，滿格閃爍）
 *  - COMBO「n HIT」（stub）
 *
 * 純顯示層：位置讀 ctx.player.getPosition()，數值由 UISystem 傳入，絕不回寫。
 * 目前用色塊/圓/文字排佈局；真美術 icon 之後替換。
 */
export class PlayerOverheadUI {
  private readonly container: Phaser.GameObjects.Container;
  private readonly soulRing: Phaser.GameObjects.Graphics;
  private readonly creditText: Phaser.GameObjects.Text;
  private readonly comboText: Phaser.GameObjects.Text;
  private readonly energyBar: EnergyBar;

  private shownSoul = -1;
  private shownCredit = -1;
  private shownCombo = -1;

  constructor(scene: Phaser.Scene) {
    const cfg = OVERHEAD_LAYOUT;
    this.container = scene.add.container(0, 0);
    this.container.setDepth(OVERHEAD_DEPTH);

    // --- 玩家編號牌（圓角方底 + 文字）---
    const pnum = scene.add.graphics();
    pnum.fillStyle(HUD_COLORS.pNumBg, 1);
    pnum.fillRoundedRect(cfg.pNum.x, cfg.pNum.y, cfg.pNum.size, cfg.pNum.size, 6);
    pnum.lineStyle(2, HUD_COLORS.panelStroke, 0.9);
    pnum.strokeRoundedRect(cfg.pNum.x, cfg.pNum.y, cfg.pNum.size, cfg.pNum.size, 6);
    this.container.add(pnum);
    const pnumText = scene.add
      .text(cfg.pNum.x + cfg.pNum.size / 2, cfg.pNum.y + cfg.pNum.size / 2, cfg.pNum.text, {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: cfg.pNum.fontSize,
        color: HUD_COLORS.text,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.container.add(pnumText);

    // --- 魂力環（stub 先固定滿）---
    this.soulRing = scene.add.graphics();
    this.container.add(this.soulRing);

    // --- Credit 底框 + 金幣 icon + 數字 ---
    const creditBg = scene.add.graphics();
    creditBg.fillStyle(HUD_COLORS.creditBg, 0.55);
    creditBg.fillRoundedRect(cfg.credit.x, cfg.credit.y, cfg.credit.width, cfg.credit.height, 6);
    this.container.add(creditBg);
    // 金幣 icon 佔位（圓）。
    const coin = scene.add.graphics();
    const coinR = cfg.credit.coinSize / 2;
    const coinCx = cfg.credit.x + coinR + 6;
    const coinCy = cfg.credit.y + cfg.credit.height / 2;
    coin.fillStyle(HUD_COLORS.coin, 1);
    coin.fillCircle(coinCx, coinCy, coinR);
    coin.lineStyle(2, 0x8a6d0f, 1);
    coin.strokeCircle(coinCx, coinCy, coinR);
    this.container.add(coin);
    this.creditText = scene.add
      .text(coinCx + coinR + 6, coinCy, cfg.credit.placeholder, {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: cfg.credit.fontSize,
        color: HUD_COLORS.text,
      })
      .setOrigin(0, 0.5);
    this.container.add(this.creditText);

    // --- 能量 4 格（嵌入容器）---
    this.energyBar = new EnergyBar(scene, this.container, cfg.energy.x, cfg.energy.y);

    // --- COMBO「n HIT」---
    this.comboText = scene.add
      .text(cfg.combo.x, cfg.combo.y, '', {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: cfg.combo.fontSize,
        color: HUD_COLORS.comboText,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.container.add(this.comboText);

    // 初始顯示。
    this.setSoul(1);
    this.setCredit(0);
    this.setCombo(0);
  }

  /** 每幀跟隨玩家：把容器移到玩家位置上方。 */
  followWorldPosition(x: number, y: number): void {
    this.container.setPosition(x, y + OVERHEAD_LAYOUT.offsetY);
  }

  /** 設定魂力比例（0..1）。stub：目前傳固定值（魂力系統未做）。 */
  setSoul(ratio: number): void {
    const clamped = Phaser.Math.Clamp(ratio, 0, 1);
    if (clamped === this.shownSoul) return;
    this.shownSoul = clamped;

    const cfg = OVERHEAD_LAYOUT.soulRing;
    const g = this.soulRing;
    g.clear();
    // 底槽環。
    g.lineStyle(cfg.thickness, HUD_COLORS.soulRingBg, 1);
    g.strokeCircle(cfg.x, cfg.y, cfg.radius);
    // 充填弧（從 12 點鐘順時針）。
    if (clamped > 0) {
      const start = -Math.PI / 2;
      const end = start + Math.PI * 2 * clamped;
      g.lineStyle(cfg.thickness, HUD_COLORS.soulRingFill, 1);
      g.beginPath();
      g.arc(cfg.x, cfg.y, cfg.radius, start, end, false);
      g.strokePath();
    }
  }

  /** 設定 Credit 數字。stub：目前傳 0（Credit 系統未做）。 */
  setCredit(value: number): void {
    if (value === this.shownCredit) return;
    this.shownCredit = value;
    // 補零到 5 位（對照 Unity 99999 樣式）。
    this.creditText.setText(`${Math.max(0, Math.floor(value))}`.padStart(5, '0'));
  }

  /** 設定 COMBO 數。stub：目前傳 0（COMBO 系統未做）。 */
  setCombo(value: number): void {
    const cfg = OVERHEAD_LAYOUT.combo;
    const n = Math.max(0, Math.floor(value));
    if (n === this.shownCombo) return;
    this.shownCombo = n;
    const visible = !(cfg.hideWhenZero && n === 0);
    this.comboText.setVisible(visible);
    if (visible) this.comboText.setText(`${n}${cfg.suffix}`);
  }

  /** 設定能量格數（0..4）。接現有 getEnergy stub。 */
  setEnergy(value: number): void {
    this.energyBar.setEnergy(value);
  }

  /** 每幀推進能量滿格閃爍。 */
  updateEnergy(dt: number): void {
    this.energyBar.update(dt);
  }

  destroy(): void {
    this.energyBar.destroy();
    this.container.destroy(); // 連同容器內所有子物件一併銷毀
  }
}
