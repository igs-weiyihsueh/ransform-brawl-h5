import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import { BOTTOM_PANEL_LAYOUT, HUD_COLORS, HUD_FONT_FAMILY, PANEL_DEPTH, UI_ICONS, resolveDashDisplay } from '@/config/uiConfig';
import { playerColor } from '@/config/playerConfig';
import { darkWedgeArc, isDashRecharging } from '@/systems/dashChargeDisplay';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';
import { isVisible, type PanelElement, type PanelLayout } from '@/config/uiLayoutSchema';

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
  /** 衝刺「衝」圖示：圓底+字（識別）、右上數字、冷卻壓黑遮罩 gfx、圓心/半徑。 */
  dashBase: Phaser.GameObjects.Graphics;
  dashLabel: Phaser.GameObjects.Text;
  dashCount: Phaser.GameObjects.Text;
  dashDim: Phaser.GameObjects.Graphics;
  dashCx: number;
  dashCy: number;
  dashR: number;
  shownDashCharges: number;
  shownDashProgress: number;
  /** 衝刺圖示進場 gate：角色待機/進場中隱藏，登場動畫完成才顯示（用戶指定）。 */
  dashVisible: boolean;
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
    if (chestEl && isVisible(chestEl)) {
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
    const ticketVisible = isVisible(ticketEl); // 用戶 #6：勾掉 ticket → icon+數字不顯
    const tx = slotX + (ticketEl?.x ?? 0);
    const ty = slotY + (ticketEl?.y ?? 0);
    const iconSize = 28;
    if (ticketVisible && scene.textures.exists(UI_ICONS.ticket.key)) {
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
        .setDepth(PANEL_DEPTH)
        .setVisible(ticketVisible), // 用戶 #6：ticket 勾掉則數字也隱
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
    progress.setVisible(isVisible(progEl)); // 用戶 #6：progress 勾掉 → 進度條不顯

    // 用戶 #1：待機平台移進下方面板 + 可 ui-editor 調位置。
    // 待機站位改讀 layout element 'platform'（波騎 schema 同步中；沒有則 fallback 欄上方中心，schema 上了自動讀到）。
    // 平台圖由 GameScene.drawWaitingPlatforms 在此 anchor 畫（已有、depth 面板<台座<角色），
    // 待機角色也站此 anchor → 調 layout platform 位置，平台+待機角色一起動。此處只定 anchor，不重複畫圖。
    const platEl = this.findEl(template, 'platform');
    const waitingX = platEl ? slotX + platEl.x + platEl.width / 2 : slotX + panel.slotWidth / 2;
    const waitingY = platEl ? slotY + platEl.y + platEl.height / 2 : slotY;
    const waitingW = platEl?.width ?? 0; // 0 = 用 platform.png 原生尺寸（fallback，schema 未加時）
    const waitingH = platEl?.height ?? 0;

    // 衝刺充能「衝」圖示（用戶新系統）：圓底+「衝」字 + 右上數字 + 冷卻壓黑遮罩。
    // 位置/大小讀 config BOTTOM_PANEL_LAYOUT.dash + editorStore override（layout.dash，additive
    // 不動凍結 schema；同 JP/進度可調範式）→ resolveDashDisplay 併預設。逆時針壓黑/數字/圖示都跟隨。
    const dcfg = BOTTOM_PANEL_LAYOUT.dash;
    const dres = resolveDashDisplay(readDashOverride());
    const dashCx = slotX + dres.cx;
    const dashCy = slotY + dres.cy;
    const dashR = dres.radius;
    const dashBase = track(scene.add.graphics()).setScrollFactor(0).setDepth(PANEL_DEPTH + 1);
    dashBase.fillStyle(dcfg.fill, 1);
    dashBase.fillCircle(dashCx, dashCy, dashR);
    dashBase.lineStyle(3, playerColor(playerIndex), 1);
    dashBase.strokeCircle(dashCx, dashCy, dashR);
    dashBase.setAlpha(alpha);
    const dashLabel = track(
      scene.add
        .text(dashCx, dashCy, '衝', {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: `${dres.labelFontPx}px`,
          color: dcfg.labelColor,
          fontStyle: 'bold',
        })
        .setOrigin(0.5, 0.5),
    )
      .setScrollFactor(0)
      .setDepth(PANEL_DEPTH + 2)
      .setAlpha(alpha);
    // 冷卻壓黑遮罩：畫在圖示上層（依 getDashCooldownProgress 逆時針消去）。
    const dashDim = track(scene.add.graphics()).setScrollFactor(0).setDepth(PANEL_DEPTH + 3);
    dashDim.setAlpha(alpha);
    // 右上角數字（可用格數）。
    const dashCount = track(
      scene.add
        .text(dashCx + dres.countOffsetX, dashCy + dres.countOffsetY, '3', {
          fontFamily: HUD_FONT_FAMILY,
          fontSize: `${dres.countFontPx}px`,
          color: '#ffffff',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(0.5, 0.5),
    )
      .setScrollFactor(0)
      .setDepth(PANEL_DEPTH + 4)
      .setAlpha(alpha);

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
      dashBase,
      dashLabel,
      dashCount,
      dashDim,
      dashCx,
      dashCy,
      dashR,
      shownDashCharges: -1,
      shownDashProgress: -1,
      // 進場 gate：預設隱藏，等 UISystem 依角色進場完成才 setDashVisible(true)（用戶指定）。
      dashVisible: false,
    };
    // 進場前先隱藏衝刺圖示（圓底/字/數字/壓黑遮罩），避免一開場待機/進場中就顯示。
    dashBase.setVisible(false);
    dashLabel.setVisible(false);
    dashCount.setVisible(false);
    dashDim.setVisible(false);
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

  /**
   * 進場 gate（用戶指定）：設定某玩家欄衝刺「衝」圖示是否可見。
   * 角色待機/登場動畫進行中 → visible=false（隱藏圓底/字/數字/壓黑）；
   * 登場動畫完成後 → visible=true。只變動才套用（省開銷）。
   * 圖示本身的數值/壓黑仍由 setDash 維護，可見性由此獨立控制（顯示時沿用最新狀態）。
   */
  setDashVisible(index: number, visible: boolean): void {
    const slot = this.slots[index];
    if (!slot) return;
    if (visible === slot.dashVisible) return;
    slot.dashVisible = visible;
    slot.dashBase.setVisible(visible);
    slot.dashLabel.setVisible(visible);
    slot.dashCount.setVisible(visible);
    slot.dashDim.setVisible(visible);
  }

  /**
   * 設定某玩家欄的衝刺充能顯示（用戶新系統，純顯示）：
   *  - 右上數字 = 目前可用格數 charges。
   *  - 未滿（charges<max，有格在回充）→「衝」圖示壓暗 + 依 cooldownProgress **逆時針**徑向消去壓黑
   *    （progress 0=全壓黑、1=消完該格恢復）；滿格（charges==max）→ 無壓黑、全亮。
   * 只變動才重畫（省開銷）。cooldownProgress 只在未滿時有效。
   */
  setDash(index: number, charges: number, max: number, cooldownProgress: number): void {
    const slot = this.slots[index];
    if (!slot) return;
    const c = Math.max(0, Math.floor(charges));
    const recharging = isDashRecharging(c, max);
    // 滿格時壓黑進度視為 1（無壓黑）；未滿才吃 cooldownProgress。
    const prog = recharging ? Math.min(1, Math.max(0, cooldownProgress)) : 1;
    if (c === slot.shownDashCharges && prog === slot.shownDashProgress) return;
    slot.shownDashCharges = c;
    slot.shownDashProgress = prog;

    slot.dashCount.setText(`${c}`);

    // 冷卻壓黑遮罩：未滿且 prog<1 才畫壓黑楔形（逆時針消去）；否則清空（全亮）。
    slot.dashDim.clear();
    if (recharging && prog < 1) {
      const { startAngle, endAngle, anticlockwise } = darkWedgeArc(prog);
      slot.dashDim.fillStyle(0x000000, BOTTOM_PANEL_LAYOUT.dash.dimAlpha);
      slot.dashDim.beginPath();
      slot.dashDim.moveTo(slot.dashCx, slot.dashCy);
      slot.dashDim.arc(slot.dashCx, slot.dashCy, slot.dashR, startAngle, endAngle, anticlockwise);
      slot.dashDim.closePath();
      slot.dashDim.fillPath();
    }
  }

  destroy(): void {
    for (const slot of this.slots) {
      for (const o of slot.objects) o.destroy();
    }
    this.slots.length = 0;
  }
}

/** 衝刺圖示位置/大小 override（編輯器可調，additive 附掛 layout.dash）。 */
interface DashDisplayOverride {
  dashOffsetX?: number;
  dashOffsetY?: number;
  dashScale?: number;
}

/**
 * 讀 uiLayout override 裡的衝刺圖示 override（layout.dash，additive 附掛，同 JP/進度做法）。
 * 無 override / 無 dash 欄 → undefined（resolveDashDisplay 用打包預設，行為不變）。
 */
function readDashOverride(): DashDisplayOverride | undefined {
  const raw = loadOverride(EDITOR_STORE_KEYS.uiLayout);
  if (!raw || typeof raw !== 'object') return undefined;
  const d = (raw as { dash?: unknown }).dash;
  if (!d || typeof d !== 'object') return undefined;
  const o = d as DashDisplayOverride;
  return {
    dashOffsetX: typeof o.dashOffsetX === 'number' ? o.dashOffsetX : undefined,
    dashOffsetY: typeof o.dashOffsetY === 'number' ? o.dashOffsetY : undefined,
    dashScale: typeof o.dashScale === 'number' ? o.dashScale : undefined,
  };
}
