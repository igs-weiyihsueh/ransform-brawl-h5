import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import {
  BOTTOM_PANEL_LAYOUT,
  HUD_COLORS,
  HUD_FONT_FAMILY,
  PANEL_DEPTH,
} from '@/config/uiConfig';

/** 單一玩家欄的可刷新元素。 */
interface Slot {
  ticketText: Phaser.GameObjects.Text;
  progress: Phaser.GameObjects.Graphics;
  progressX: number;
  progressY: number;
  progressW: number;
  active: boolean;
  shownTicket: number;
  shownRatio: number;
}

/**
 * BottomPanel — 下方面板（對照 Unity 底部 4 欄 P1~P4）。
 *
 * 螢幕底部固定（setScrollFactor 0），4 欄橫排置中。每欄：面板底框 /
 * 寶箱 icon（方塊佔位）/ 彩票數（stub）/ 進度條 / 金幣 icon。
 * 目前單人 → P1 完整、P2~P4 佔位淡化（等待加入）。
 *
 * 純顯示層：數值由 UISystem 傳入（stub），絕不回寫。真美術 icon 之後替換。
 */
export class BottomPanel {
  private readonly slots: Slot[] = [];
  /** 所有建立的顯示物件，供 destroy 一次清除。 */
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene) {
    const cfg = BOTTOM_PANEL_LAYOUT;
    const totalWidth =
      cfg.slotCount * cfg.slotWidth + (cfg.slotCount - 1) * cfg.slotGap;
    const startX = (GAME_WIDTH - totalWidth) / 2;
    const y = GAME_HEIGHT - cfg.bottomOffset - cfg.slotHeight;

    for (let i = 0; i < cfg.slotCount; i++) {
      const slotX = startX + i * (cfg.slotWidth + cfg.slotGap);
      const active = i === 0; // 單人：只有 P1 加入
      this.slots.push(this.buildSlot(scene, slotX, y, i + 1, active));
    }
  }

  private buildSlot(
    scene: Phaser.Scene,
    x: number,
    y: number,
    playerNo: number,
    active: boolean,
  ): Slot {
    const cfg = BOTTOM_PANEL_LAYOUT;
    const alpha = active ? 1 : 0.4; // P2~P4 淡化佔位
    const track = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.objects.push(o);
      return o;
    };

    // 面板底框。
    const bg = track(scene.add.graphics()).setScrollFactor(0).setDepth(PANEL_DEPTH);
    bg.fillStyle(active ? HUD_COLORS.panelFill : HUD_COLORS.slotInactive, active ? HUD_COLORS.panelFillAlpha : 0.35);
    bg.fillRoundedRect(x, y, cfg.slotWidth, cfg.slotHeight, cfg.cornerRadius);
    bg.lineStyle(3, HUD_COLORS.panelStroke, active ? HUD_COLORS.panelStrokeAlpha : 0.3);
    bg.strokeRoundedRect(x, y, cfg.slotWidth, cfg.slotHeight, cfg.cornerRadius);

    // 欄標籤 P1~P4。
    track(
      scene.add
        .text(x + cfg.padding, y + cfg.padding, `P${playerNo}`, {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: cfg.labelFontSize,
          color: HUD_COLORS.text,
          fontStyle: 'bold',
        })
        .setAlpha(alpha)
        .setScrollFactor(0)
        .setDepth(PANEL_DEPTH),
    );

    // 寶箱 icon（方塊佔位）。
    const chestX = x + cfg.padding;
    const chestY = y + cfg.slotHeight - cfg.padding - cfg.chest.size;
    const chest = track(scene.add.graphics()).setScrollFactor(0).setDepth(PANEL_DEPTH);
    chest.fillStyle(HUD_COLORS.chest, alpha);
    chest.fillRoundedRect(chestX, chestY, cfg.chest.size, cfg.chest.size, 8);
    chest.lineStyle(2, 0x5d4037, alpha);
    chest.strokeRoundedRect(chestX, chestY, cfg.chest.size, cfg.chest.size, 8);
    // 寶箱蓋線（簡單佔位裝飾）。
    chest.lineStyle(2, 0x5d4037, alpha);
    chest.lineBetween(chestX, chestY + cfg.chest.size * 0.35, chestX + cfg.chest.size, chestY + cfg.chest.size * 0.35);

    // 彩票標籤 + 數字（寶箱右）。
    const infoX = chestX + cfg.chest.size + 16;
    track(
      scene.add
        .text(infoX, chestY, cfg.ticket.label, {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: cfg.ticket.labelFontSize,
          color: HUD_COLORS.textMuted,
        })
        .setAlpha(alpha)
        .setScrollFactor(0)
        .setDepth(PANEL_DEPTH),
    );
    const ticketText = track(
      scene.add
        .text(infoX, chestY + 22, cfg.ticket.placeholder, {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: cfg.ticket.fontSize,
          color: HUD_COLORS.text,
          fontStyle: 'bold',
        })
        .setAlpha(alpha)
        .setScrollFactor(0)
        .setDepth(PANEL_DEPTH),
    );

    // 金幣 icon（右下角圓形佔位）。
    const coinR = cfg.coin.size / 2;
    const coinCx = x + cfg.slotWidth - cfg.padding - coinR;
    const coinCy = y + cfg.slotHeight - cfg.padding - coinR;
    const coin = track(scene.add.graphics()).setScrollFactor(0).setDepth(PANEL_DEPTH);
    coin.fillStyle(HUD_COLORS.coin, alpha);
    coin.fillCircle(coinCx, coinCy, coinR);
    coin.lineStyle(2, 0x8a6d0f, alpha);
    coin.strokeCircle(coinCx, coinCy, coinR);

    // 進度條（下方，跨欄寬）。
    const progressX = infoX;
    const progressW = cfg.slotWidth - (infoX - x) - cfg.padding - cfg.coin.size - 10;
    const progressY = y + cfg.slotHeight - cfg.padding - cfg.progress.height;
    const progress = track(scene.add.graphics()).setScrollFactor(0).setDepth(PANEL_DEPTH);
    progress.setAlpha(alpha);

    const slot: Slot = {
      ticketText,
      progress,
      progressX,
      progressY,
      progressW,
      active,
      shownTicket: -1,
      shownRatio: -1,
    };
    this.drawProgress(slot, cfg.progress.placeholderRatio);
    return slot;
  }

  private drawProgress(slot: Slot, ratio: number): void {
    const cfg = BOTTOM_PANEL_LAYOUT;
    const clamped = Phaser.Math.Clamp(ratio, 0, 1);
    if (clamped === slot.shownRatio) return;
    slot.shownRatio = clamped;
    const g = slot.progress;
    g.clear();
    g.fillStyle(HUD_COLORS.progressBg, 1);
    g.fillRoundedRect(slot.progressX, slot.progressY, slot.progressW, cfg.progress.height, cfg.progress.cornerRadius);
    if (clamped > 0) {
      g.fillStyle(HUD_COLORS.progressFill, 1);
      g.fillRoundedRect(slot.progressX, slot.progressY, slot.progressW * clamped, cfg.progress.height, cfg.progress.cornerRadius);
    }
  }

  /**
   * 設定某玩家欄的彩票數（stub）。
   * @param index 欄索引（0=P1）。
   */
  setTicket(index: number, value: number): void {
    const slot = this.slots[index];
    if (!slot) return;
    const n = Math.max(0, Math.floor(value));
    if (n === slot.shownTicket) return;
    slot.shownTicket = n;
    slot.ticketText.setText(`${n}`.padStart(5, '0'));
  }

  /** 設定某玩家欄的進度條比例（0..1，stub）。 */
  setProgress(index: number, ratio: number): void {
    const slot = this.slots[index];
    if (!slot) return;
    this.drawProgress(slot, ratio);
  }

  destroy(): void {
    for (const o of this.objects) o.destroy();
    this.objects.length = 0;
    this.slots.length = 0;
  }
}
