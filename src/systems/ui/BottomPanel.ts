import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import { HUD_COLORS, HUD_FONT_FAMILY, PANEL_DEPTH, UI_ICONS } from '@/config/uiConfig';
import type { PanelElement, PanelLayout } from '@/config/uiLayoutSchema';

/** 單一玩家欄：可刷新元素 + 淡化控制。 */
interface Slot {
  playerIndex: number;
  /** 欄內所有顯示物件（供 destroy / 淡化）。 */
  objects: Phaser.GameObjects.GameObject[];
  ticketText: Phaser.GameObjects.Text;
  progress: Phaser.GameObjects.Graphics;
  /** progress 底槽/填充的絕對座標與尺寸（來自 template element）。 */
  progressX: number;
  progressY: number;
  progressW: number;
  progressH: number;
  progressRadius: number;
  active: boolean;
  shownTicket: number;
  shownRatio: number;
  /** 寶盒圖示中心的螢幕座標（能量飛光終點；防漂移 template 錨點）。 */
  chestCenterX: number;
  chestCenterY: number;
  /** 待機點螢幕座標（投幣進場起點 / 回待機終點）：欄上方中心。 */
  waitingX: number;
  waitingY: number;
}

/** 未加入欄的淡化透明度。 */
const INACTIVE_ALPHA = 0.4;

/**
 * BottomPanel — 下方面板（對照 Unity 底部 4 欄 P1~P4），資料驅動版。
 *
 * 螢幕底部固定（setScrollFactor 0），slotCount 欄橫排置中。每欄顯示該 player 的
 * 寶箱 / 彩票 / 進度 / 金幣。欄內元素座標**讀 uiLayout schema**（相對欄左上）。
 *
 * 🔴 防漂移（決策 b765cfbf）：所有欄的元素一律用 columns[0].elements（template 欄）
 * 複製衍生，**不各讀 columns[i].elements**，確保 P1~P4 面板結構恆等。
 *
 * per-player：active 欄（i < activeCount）亮、未加入欄淡化。數值由 UISystem 每幀
 * 依各 player 的 Map（ticket/credit…）傳入。純顯示層，只讀不回寫。
 */
export class BottomPanel {
  private readonly slots: Slot[] = [];
  private readonly panel: PanelLayout;

  /**
   * @param scene 場景。
   * @param panel 面板佈局（讀自 uiLayout schema）。
   * @param activeCount 目前 active（已加入）的玩家數；i < activeCount 的欄亮，其餘淡化。
   */
  constructor(scene: Phaser.Scene, panel: PanelLayout, activeCount: number) {
    this.panel = panel;
    const totalWidth =
      panel.slotCount * panel.slotWidth + (panel.slotCount - 1) * panel.slotGap;
    const startX = (GAME_WIDTH - totalWidth) / 2;
    const y = GAME_HEIGHT - panel.bottomOffset - panel.slotHeight;

    // 防漂移：template = columns[0].elements，所有欄共用這份座標。
    const template = panel.columns[0]?.elements ?? [];

    for (let i = 0; i < panel.slotCount; i++) {
      const slotX = startX + i * (panel.slotWidth + panel.slotGap);
      const active = i < activeCount;
      this.slots.push(this.buildSlot(scene, slotX, y, i, active, template));
    }
  }

  /** 依 id 從 template 找元素（防漂移：一律用 columns[0] 的 element）。 */
  private findEl(template: PanelElement[], id: string): PanelElement | undefined {
    return template.find((e) => e.id === id);
  }

  private buildSlot(
    scene: Phaser.Scene,
    slotX: number,
    slotY: number,
    playerIndex: number,
    active: boolean,
    template: PanelElement[],
  ): Slot {
    const panel = this.panel;
    const alpha = active ? 1 : INACTIVE_ALPHA;
    const objects: Phaser.GameObjects.GameObject[] = [];
    const track = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      objects.push(o);
      return o;
    };

    // 面板底框（用 panel 共用排版參數）。
    const bg = track(scene.add.graphics()).setScrollFactor(0).setDepth(PANEL_DEPTH);
    bg.fillStyle(active ? HUD_COLORS.panelFill : HUD_COLORS.slotInactive, active ? HUD_COLORS.panelFillAlpha : 0.35);
    bg.fillRoundedRect(slotX, slotY, panel.slotWidth, panel.slotHeight, panel.cornerRadius);
    bg.lineStyle(3, HUD_COLORS.panelStroke, active ? HUD_COLORS.panelStrokeAlpha : 0.3);
    bg.strokeRoundedRect(slotX, slotY, panel.slotWidth, panel.slotHeight, panel.cornerRadius);

    // 欄標籤 P1~P4。
    track(
      scene.add
        .text(slotX + panel.padding, slotY + panel.padding, `P${playerIndex + 1}`, {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: '22px',
          color: HUD_COLORS.text,
          fontStyle: 'bold',
        })
        .setAlpha(alpha)
        .setScrollFactor(0)
        .setDepth(PANEL_DEPTH),
    );

    // 寶箱（chest.png，退回方塊佔位）。座標=欄左上 + element.x/y。
    const chestEl = this.findEl(template, 'chest');
    // 寶盒圖示中心螢幕座標（能量飛光終點）：chest 用 origin(0,0)，故中心 = 左上 + 半寬高。
    // 無 chestEl 時退回欄中心（不會壞）。防漂移：template=columns[0]，各欄 slotX 不同→各欄各自正確。
    const chestCenterX = chestEl
      ? slotX + chestEl.x + chestEl.width / 2
      : slotX + panel.slotWidth / 2;
    const chestCenterY = chestEl
      ? slotY + chestEl.y + chestEl.height / 2
      : slotY + panel.slotHeight / 2;
    if (chestEl) {
      const cx = slotX + chestEl.x;
      const cy = slotY + chestEl.y;
      if (scene.textures.exists(UI_ICONS.chest.key)) {
        track(scene.add.image(cx, cy, UI_ICONS.chest.key))
          .setOrigin(0, 0)
          .setDisplaySize(chestEl.width, chestEl.height)
          .setAlpha(alpha)
          .setScrollFactor(0)
          .setDepth(PANEL_DEPTH);
      } else {
        const chest = track(scene.add.graphics()).setScrollFactor(0).setDepth(PANEL_DEPTH);
        chest.fillStyle(HUD_COLORS.chest, alpha);
        chest.fillRoundedRect(cx, cy, chestEl.width, chestEl.height, 8);
        chest.lineStyle(2, 0x5d4037, alpha);
        chest.strokeRoundedRect(cx, cy, chestEl.width, chestEl.height, 8);
        chest.lineBetween(cx, cy + chestEl.height * 0.35, cx + chestEl.width, cy + chestEl.height * 0.35);
      }
    }

    // 彩票（ticket.png icon + 數字）。icon 放 element 左端，數字接右。
    const ticketEl = this.findEl(template, 'ticket');
    const tx = slotX + (ticketEl?.x ?? 0);
    const ty = slotY + (ticketEl?.y ?? 0);
    const iconSize = 28;
    if (scene.textures.exists(UI_ICONS.ticket.key)) {
      track(scene.add.image(tx, ty, UI_ICONS.ticket.key))
        .setOrigin(0, 0.5)
        .setDisplaySize(iconSize, iconSize)
        .setAlpha(alpha)
        .setScrollFactor(0)
        .setDepth(PANEL_DEPTH);
    }
    const ticketText = track(
      scene.add
        .text(tx + iconSize + 6, ty, '00000', {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: '30px',
          color: HUD_COLORS.text,
          fontStyle: 'bold',
        })
        .setOrigin(0, 0.5)
        .setAlpha(alpha)
        .setScrollFactor(0)
        .setDepth(PANEL_DEPTH),
    );

    // 金幣（coin.png，退回圓形佔位）。
    const coinEl = this.findEl(template, 'coin');
    if (coinEl) {
      const cxc = slotX + coinEl.x + coinEl.width / 2;
      const cyc = slotY + coinEl.y + coinEl.height / 2;
      if (scene.textures.exists(UI_ICONS.coin.key)) {
        track(scene.add.image(cxc, cyc, UI_ICONS.coin.key))
          .setDisplaySize(coinEl.width, coinEl.height)
          .setAlpha(alpha)
          .setScrollFactor(0)
          .setDepth(PANEL_DEPTH);
      } else {
        const coin = track(scene.add.graphics()).setScrollFactor(0).setDepth(PANEL_DEPTH);
        coin.fillStyle(HUD_COLORS.coin, alpha);
        coin.fillCircle(cxc, cyc, coinEl.width / 2);
        coin.lineStyle(2, 0x8a6d0f, alpha);
        coin.strokeCircle(cxc, cyc, coinEl.width / 2);
      }
    }

    // 進度條（底槽 + 填充；填充由 setProgress 動態畫）。
    const progEl = this.findEl(template, 'progress');
    const progressX = slotX + (progEl?.x ?? panel.padding);
    const progressY = slotY + (progEl?.y ?? panel.slotHeight - panel.padding - 16);
    const progressW = progEl?.width ?? panel.slotWidth - panel.padding * 2;
    const progressH = progEl?.height ?? 16;
    const progressRadius = 6;
    const progress = track(scene.add.graphics()).setScrollFactor(0).setDepth(PANEL_DEPTH);
    progress.setAlpha(alpha);

    // 待機點：欄上方中心（角色投幣前站在自己面板欄上方待機；進場從這裡跳出、沒 Credit 回這裡）。
    const waitingX = slotX + panel.slotWidth / 2;
    const waitingY = slotY;

    const slot: Slot = {
      playerIndex,
      objects,
      ticketText,
      progress,
      progressX,
      progressY,
      progressW,
      progressH,
      progressRadius,
      active,
      shownTicket: -1,
      shownRatio: -1,
      chestCenterX,
      chestCenterY,
      waitingX,
      waitingY,
    };
    this.drawProgress(slot, 0);
    return slot;
  }

  private drawProgress(slot: Slot, ratio: number): void {
    const clamped = Phaser.Math.Clamp(ratio, 0, 1);
    if (clamped === slot.shownRatio) return;
    slot.shownRatio = clamped;
    const g = slot.progress;
    g.clear();
    g.fillStyle(HUD_COLORS.progressBg, 1);
    g.fillRoundedRect(slot.progressX, slot.progressY, slot.progressW, slot.progressH, slot.progressRadius);
    if (clamped > 0) {
      g.fillStyle(HUD_COLORS.progressFill, 1);
      g.fillRoundedRect(slot.progressX, slot.progressY, slot.progressW * clamped, slot.progressH, slot.progressRadius);
    }
  }

  /**
   * 取某 player 寶盒圖示中心的螢幕座標（能量飛光終點；面板 scrollFactor 0 = 螢幕座標）。
   * playerIndex 無效回 undefined（呼叫端 optional，飛光不觸發、不會壞）。
   */
  getChestAnchor(playerIndex: number): { x: number; y: number } | undefined {
    const slot = this.slots[playerIndex];
    if (!slot) return undefined;
    return { x: slot.chestCenterX, y: slot.chestCenterY };
  }

  /**
   * 取某 player 在下方面板的待機點螢幕座標（投幣進場起點 / 回待機終點）。
   * 待機點 = 該玩家面板欄上方中心（面板 scrollFactor 0 = 螢幕座標）。
   * playerIndex 無效或該欄未啟用（未加入）回 undefined（呼叫端 optional + fallback）。
   */
  getWaitingAnchor(playerIndex: number): { x: number; y: number } | undefined {
    const slot = this.slots[playerIndex];
    if (!slot || !slot.active) return undefined;
    return { x: slot.waitingX, y: slot.waitingY };
  }

  /** 目前欄數（= slotCount）。 */
  slotCount(): number {
    return this.slots.length;
  }

  /**
   * 更新 active 欄數（玩家加入時呼叫）：i < activeCount 的欄轉亮。
   * 只調整透明度（結構不變，恆等），不重建。
   */
  setActiveCount(activeCount: number): void {
    for (const slot of this.slots) {
      const active = slot.playerIndex < activeCount;
      if (active === slot.active) continue;
      slot.active = active;
      const a = active ? 1 : INACTIVE_ALPHA;
      for (const o of slot.objects) {
        (o as unknown as { setAlpha?: (v: number) => void }).setAlpha?.(a);
      }
    }
  }

  /** 設定某玩家欄的彩票數。index=playerIndex（0=P1）。 */
  setTicket(index: number, value: number): void {
    const slot = this.slots[index];
    if (!slot) return;
    const n = Math.max(0, Math.floor(value));
    if (n === slot.shownTicket) return;
    slot.shownTicket = n;
    slot.ticketText.setText(`${n}`.padStart(5, '0'));
  }

  /** 設定某玩家欄的進度條比例（0..1）。 */
  setProgress(index: number, ratio: number): void {
    const slot = this.slots[index];
    if (!slot) return;
    this.drawProgress(slot, ratio);
  }

  destroy(): void {
    for (const slot of this.slots) {
      for (const o of slot.objects) o.destroy();
    }
    this.slots.length = 0;
  }
}
