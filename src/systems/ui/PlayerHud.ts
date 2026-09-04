import Phaser from 'phaser';
import {
  HUD_COLORS,
  HUD_DEPTH,
  HUD_FONT_FAMILY,
  PLAYER_HUD_LAYOUT,
} from '@/config/uiConfig';

/** 顯示用：角色 key → 兒童向短名。 */
const CHAR_DISPLAY_NAME: Record<string, string> = {
  Human: '凡人',
  SunWukong: '悟空',
};

/**
 * PlayerHud — 玩家 HUD 框架（左上）。
 *
 * 顯示：目前角色、受擊 iFrame 提示、魂力佔位條。
 * 純顯示層：資料由 UISystem 每幀傳入（讀自 ctx.player），本元件不回寫任何狀態。
 *
 * 魂力：本遊戲玩家為 Credit/魂力制（非傳統血條），魂力系統尚未實作 →
 * 先畫一個佔位條，等系統做好由 UISystem 換資料來源即可。
 * 固定螢幕座標不隨相機移動。
 */
export class PlayerHud {
  private readonly panel: Phaser.GameObjects.Graphics;
  private readonly soulBar: Phaser.GameObjects.Graphics;
  private readonly titleText: Phaser.GameObjects.Text;
  private readonly statusText: Phaser.GameObjects.Text;
  private readonly soulLabel: Phaser.GameObjects.Text;

  private shownChar = '';
  private shownInvincible: boolean | null = null;
  private shownSoulRatio = -1;

  constructor(scene: Phaser.Scene) {
    const cfg = PLAYER_HUD_LAYOUT;

    // 背板。
    this.panel = scene.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH);
    this.panel.fillStyle(HUD_COLORS.panelFill, HUD_COLORS.panelFillAlpha);
    this.panel.fillRoundedRect(cfg.x, cfg.y, cfg.width, cfg.height, 12);
    this.panel.lineStyle(3, HUD_COLORS.panelStroke, HUD_COLORS.panelStrokeAlpha);
    this.panel.strokeRoundedRect(cfg.x, cfg.y, cfg.width, cfg.height, 12);

    const innerX = cfg.x + cfg.padding;

    // 目前角色。
    this.titleText = scene.add
      .text(innerX, cfg.y + cfg.padding, '', {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: cfg.titleFontSize,
        color: HUD_COLORS.text,
        fontStyle: 'bold',
      })
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH);

    // 受擊 iFrame 提示。
    this.statusText = scene.add
      .text(cfg.x + cfg.width - cfg.padding, cfg.y + cfg.padding, '', {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: cfg.statusFontSize,
        color: HUD_COLORS.warn,
        fontStyle: 'bold',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH);

    // 魂力佔位標籤 + 條。
    const soulY = cfg.y + cfg.height - cfg.padding - cfg.soulBarHeight;
    this.soulLabel = scene.add
      .text(innerX, soulY - 4, cfg.soulLabel, {
        fontFamily: HUD_FONT_FAMILY,
        fontSize: '18px',
        color: HUD_COLORS.textMuted,
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH);

    this.soulBar = scene.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH);

    // 首次繪製。
    this.setCharacter('Human');
    this.setInvincible(false);
    this.setSoul(0);
  }

  /** 設定目前角色（由 UISystem 讀 player.getCharacterKey() 傳入）。 */
  setCharacter(charKey: string): void {
    if (charKey === this.shownChar) return;
    this.shownChar = charKey;
    const name = CHAR_DISPLAY_NAME[charKey] ?? charKey;
    this.titleText.setText(name);
  }

  /** 設定受擊無敵提示（由 UISystem 讀 player.isInvincible() 傳入）。 */
  setInvincible(invincible: boolean): void {
    if (invincible === this.shownInvincible) return;
    this.shownInvincible = invincible;
    this.statusText.setText(invincible ? '受擊!' : '');
  }

  /**
   * 設定魂力顯示比例（0..1）。魂力系統尚未實作 → UISystem 目前傳 0（佔位）。
   * 之後接真資料只需 UISystem 改資料來源一行。
   */
  setSoul(ratio: number): void {
    const clamped = Phaser.Math.Clamp(ratio, 0, 1);
    if (clamped === this.shownSoulRatio) return;
    this.shownSoulRatio = clamped;

    const cfg = PLAYER_HUD_LAYOUT;
    const barX = cfg.x + cfg.padding;
    const barY = cfg.y + cfg.height - cfg.padding - cfg.soulBarHeight;
    const barW = cfg.width - cfg.padding * 2;
    const h = cfg.soulBarHeight;

    this.soulBar.clear();
    // 底槽。
    this.soulBar.fillStyle(HUD_COLORS.energyOff, 1);
    this.soulBar.fillRoundedRect(barX, barY, barW, h, 6);
    // 充填（佔位）。
    if (clamped > 0) {
      this.soulBar.fillStyle(HUD_COLORS.soulPlaceholder, 1);
      this.soulBar.fillRoundedRect(barX, barY, barW * clamped, h, 6);
    }
    this.soulBar.lineStyle(2, HUD_COLORS.panelStroke, 0.6);
    this.soulBar.strokeRoundedRect(barX, barY, barW, h, 6);
  }

  destroy(): void {
    this.panel.destroy();
    this.soulBar.destroy();
    this.titleText.destroy();
    this.statusText.destroy();
    this.soulLabel.destroy();
  }
}
