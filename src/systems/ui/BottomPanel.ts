import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import { HUD_COLORS, HUD_FONT_FAMILY, PANEL_DEPTH, UI_ICONS } from '@/config/uiConfig';
import { playerColor } from '@/config/playerConfig';
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
  /** 待機點螢幕座標（投幣進場起點 / 回待機終點）＝ layout 'platform' element 中心（可 ui-editor 調）。 */
  waitingX: number;
  waitingY: number;
  /** 待機台座顯示尺寸（來自 layout 'platform' element；GameScene 畫台座時 setDisplaySize 用）。 */
  waitingW: number;
  waitingH: number;
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

    // 面板底框（用 panel 共用排版參數）。外框一律用該 player 識別色（未加入欄靠 alpha 淡化，
    // 加入時 setActiveCount 只調 alpha 即轉亮，顏色已是識別色不需重畫）。
    const bg = track(scene.add.graphics()).setScrollFactor(0).setDepth(PANEL_DEPTH);
    bg.fillStyle(active ? HUD_COLORS.panelFill : HUD_COLORS.slotInactive, active ? HUD_COLORS.panelFillAlpha : 0.35);
    bg.fillRoundedRect(slotX, slotY, panel.slotWidth, panel.slotHeight, panel.cornerRadius);
    bg.lineStyle(3, playerColor(playerIndex), active ? HUD_COLORS.panelStrokeAlpha : 0.3);
    bg.strokeRoundedRect(slotX, slotY, panel.slotWidth, panel.slotHeight, panel.cornerRadius);

    // 欄標籤 P1~P4（用該 player 識別色，跟外框/頭上 P 牌一致）。
    const labelColor = `#${playerColor(playerIndex).toString(16).padStart(6, '0')}`;
    track(
      scene.add
        .text(slotX + panel.padding, slotY + panel.padding, `P${playerIndex + 1}`, {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: '22px',
          color: labelColor,
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
      const img = track(scene.add.image(tx, ty, UI_ICONS.ticket.key));
      // 等比縮放到 iconSize 見方的框內（不拉伸變形）：票券圖是直式(116×144)，
      // 若直接 setDisplaySize(28,28) 會壓扁。取原圖長寬比、fit 進 iconSize 方框。
      const src = scene.textures.get(UI_ICONS.ticket.key).getSourceImage() as {
        width: number;
        height: number;
      };
      const ratio = src.width && src.height ? src.width / src.height : 1;
      const w = ratio >= 1 ? iconSize : iconSize * ratio;
      const h = ratio >= 1 ? iconSize / ratio : iconSize;
      img
        .setOrigin(0, 0.5)
        .setDisplaySize(w, h)
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

    // 用戶 #6：移除下方面板右下角無意義的金幣顯示（layout schema 的 coin element 保留、僅不繪製，最小改動不碰波騎 schema）。

    // 進度條（底槽 + 填充；填充由 setProgress 動態畫）。
    const progEl = this.findEl(template, 'progress');
    const progressX = slotX + (progEl?.x ?? panel.padding);
    const progressY = slotY + (progEl?.y ?? panel.slotHeight - panel.padding - 16);
    const progressW = progEl?.width ?? panel.slotWidth - panel.padding * 2;
    const progressH = progEl?.height ?? 16;
    const progressRadius = 6;
    const progress = track(scene.add.graphics()).setScrollFactor(0).setDepth(PANEL_DEPTH);
    progress.setAlpha(alpha);

    // 用戶 #1：待機平台移進下方面板 + 可 ui-editor 調位置。
    // 待機站位改讀 layout element 'platform'（波騎 schema 同步中；沒有則 fallback 欄上方中心，schema 上了自動讀到）。
    // 平台圖由 GameScene.drawWaitingPlatforms 在此 anchor 畫（已有、depth 面板<台座<角色），
    // 待機角色也站此 anchor → 調 layout platform 位置，平台+待機角色一起動。此處只定 anchor，不重複畫圖。
    const platEl = this.findEl(template, 'platform');
    const waitingX = platEl ? slotX + platEl.x + platEl.width / 2 : slotX + panel.slotWidth / 2;
    const waitingY = platEl ? slotY + platEl.y + platEl.height / 2 : slotY;
    const waitingW = platEl?.width ?? 0; // 0 = 用 platform.png 原生尺寸（fallback，schema 未加時）
    const waitingH = platEl?.height ?? 0;

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
      waitingW,
      waitingH,
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
  getWaitingAnchor(playerIndex: number): { x: number; y: number; w: number; h: number } | undefined {
    const slot = this.slots[playerIndex];
    if (!slot || !slot.active) return undefined;
    return { x: slot.waitingX, y: slot.waitingY, w: slot.waitingW, h: slot.waitingH };
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
