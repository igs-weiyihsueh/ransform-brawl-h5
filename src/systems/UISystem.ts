import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import type Phaser from 'phaser';
import { UI_ICONS, UI_LAYOUT_ASSET } from '@/config/uiConfig';
import { playerColor } from '@/config/playerConfig';
import {
  DEFAULT_UI_LAYOUT,
  validateUiLayout,
  isVisible,
  type UiLayoutFile,
} from '@/config/uiLayoutSchema';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';
import { BottomPanel } from '@/systems/ui/BottomPanel';
import { PlayerOverheadUI } from '@/systems/ui/PlayerOverheadUI';

/**
 * UISystem — HUD 系統（見 docs/h5_collab_spec.md），per-player 多份版（S5 ③）。
 *
 * 對照 Unity prefab，HUD 分兩塊，皆為純顯示層（**絕不回寫任何核心狀態**）：
 *  A. PlayerOverheadUI —— 每個 active player 頭上一份，世界座標跟隨各自 player 位置，
 *     讀各自 playerId 的 Credit / COMBO / 能量 / 魂力。
 *  B. BottomPanel —— 螢幕底部固定 N 欄，欄內元素座標讀 uiLayout schema（相對欄左上）。
 *     每欄顯示該 player 的寶箱 / 彩票 / 進度 / 金幣；active 欄亮、未加入欄淡化。
 *
 * per-player 讀取（系統層皆 Map<playerId>）：
 *  - 彩票 ctx.ticket.getTickets(pid)、Credit ctx.credit.getCredit(pid)、
 *    COMBO ctx.combo.getCombo/isWarning/consumeMaxTriggered(pid)、
 *    能量 ctx.energy.getEnergy(pid)、魂力 ctx.transform.getSoulRatio(pid)。
 *  - 進度（寶盒）ctx.chest.getProgress() 目前為全域（系統層尚未 per-player kill 歸屬），
 *    各欄暫顯示同一全域進度；系統層做 per-player 後改成 getProgress(pid) 一行。
 *
 * 佈局來源：public/assets/data/uiLayout.json（uiLayoutSchema 驗證）；載不到用 DEFAULT_UI_LAYOUT。
 * 🔴 防漂移（決策 b765cfbf）：BottomPanel 各欄一律用 columns[0].elements 複製，P1~P4 恆等。
 *
 * 邊界：只動 UI 讀取層（本檔 + BottomPanel + PlayerOverheadUI），不碰系統層 / schema / 核心。
 */
export class UISystem implements GameSystem {
  readonly name = 'UISystem';

  /**
   * 載入 HUD 用的 UI icon 貼圖 + 佈局 JSON（對照 EffectSystem.preload 慣例）。
   * 由 GameScene.preload() 呼叫一次：UISystem.preload(this)。
   * 沒載到的資源會 graceful fallback（icon 退回色塊、佈局退回 DEFAULT_UI_LAYOUT），不會壞。
   */
  static preload(scene: Phaser.Scene): void {
    for (const icon of Object.values(UI_ICONS)) {
      scene.load.image(icon.key, icon.path);
    }
    scene.load.json(UI_LAYOUT_ASSET.key, UI_LAYOUT_ASSET.path);
  }

  /**
   * 取某 player 寶盒欄的螢幕錨點（能量飛光終點；面板 scrollFactor 0 = 螢幕座標）。
   * 委派 BottomPanel（權威來源、避免座標漂移，決策 b765cfbf）。BottomPanel 尚未提供
   * getChestAnchor 時回 undefined（飛光就不觸發），待界騎補上該 getter 即自動生效。
   */
  getChestAnchor(playerIndex: number): { x: number; y: number } | undefined {
    const bp = this.bottomPanel as unknown as {
      getChestAnchor?: (i: number) => { x: number; y: number } | undefined;
    };
    return bp.getChestAnchor?.(playerIndex);
  }

  /**
   * 取某 player 下方面板待機點螢幕座標（投幣進場循環的待機位置/進場起點）。
   * 委派 BottomPanel.getWaitingAnchor（界騎提供，權威來源）；未提供時回 undefined，
   * 呼叫端(GameScene)再 fallback，不阻塞。
   */
  getWaitingAnchor(playerIndex: number): { x: number; y: number; w?: number; h?: number } | undefined {
    const bp = this.bottomPanel as unknown as {
      getWaitingAnchor?: (i: number) => { x: number; y: number; w?: number; h?: number } | undefined;
    };
    return bp.getWaitingAnchor?.(playerIndex);
  }

  /** 面板欄數（供待機台座逐欄繪製）。 */
  getSlotCount(): number {
    const bp = this.bottomPanel as unknown as { slotCount?: () => number };
    return bp.slotCount?.() ?? 0;
  }

  /** 用戶 #6：待機平台(platform)是否顯示（讀 layout.panel columns[0] platform 元素 visible）。 */
  isPlatformVisible(): boolean {
    const cols = this.layout?.panel?.columns;
    const platform = cols?.[0]?.elements?.find((e) => e.id === 'platform');
    return isVisible(platform);
  }

  private ctx!: GameContext;
  private layout!: UiLayoutFile;
  private bottomPanel!: BottomPanel;
  /** 每個 player 一份頭上 UI（index = players[] index）。 */
  private overheads: PlayerOverheadUI[] = [];

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const scene = ctx.scene;
    this.layout = this.loadLayout(scene);

    const activeCount = ctx.players.length;
    this.bottomPanel = new BottomPanel(scene, this.layout.panel, activeCount);

    // 每個目前存在的 player 各建一份頭上 UI（P 牌底用該 player 識別色 PLAYER_COLORS）。
    for (let i = 0; i < ctx.players.length; i++) {
      const oh = new PlayerOverheadUI(scene, `P${i + 1}`, playerColor(ctx.players[i].playerId), this.layout.overhead);
      oh.setElementVisibility(this.overheadVisibility()); // 用戶 #6：套 layout.overhead 顯示開關
      this.overheads.push(oh);
    }
  }

  /** 用戶 #6：讀 layout.overhead 各元素 visible（badge/credit/energy/combo）。undefined=顯示。 */
  private overheadVisibility(): { badge?: boolean; credit?: boolean; energy?: boolean; combo?: boolean } {
    const oh = this.layout?.overhead as
      | Record<'badge' | 'credit' | 'energy' | 'combo', { visible?: boolean } | undefined>
      | undefined;
    return {
      badge: isVisible(oh?.badge),
      credit: isVisible(oh?.credit),
      energy: isVisible(oh?.energy),
      combo: isVisible(oh?.combo),
    };
  }

  /** 載入並驗證 uiLayout.json；匯入 override(localStorage) 優先、否則打包預設；失敗退回 DEFAULT_UI_LAYOUT。 */
  private loadLayout(scene: Phaser.Scene): UiLayoutFile {
    // 匯入機制：localStorage override(編輯器套用)優先(同步)，無則用打包預設(Phaser cache)。
    const override = loadOverride(EDITOR_STORE_KEYS.uiLayout);
    const raw = override ?? (scene.cache.json.get(UI_LAYOUT_ASSET.key) as unknown);
    if (raw !== undefined && raw !== null) {
      const result = validateUiLayout(raw);
      if (result.ok) return result.data;
      // 不合法（含 override 壞掉）：警告後退回預設（不讓 UI 整個壞掉）。
      console.warn('[UISystem] uiLayout 驗證失敗，改用預設佈局：', result.errors);
    }
    return DEFAULT_UI_LAYOUT;
  }

  update(_dt: number): void {
    const players = this.ctx.players;

    // 玩家加入（F2~F4）→ 補建頭上 UI + 亮對應底部欄。
    if (this.overheads.length < players.length) {
      for (let i = this.overheads.length; i < players.length; i++) {
        const oh = new PlayerOverheadUI(this.ctx.scene, `P${i + 1}`, playerColor(players[i].playerId), this.layout.overhead);
        oh.setElementVisibility(this.overheadVisibility()); // 用戶 #6：套 layout.overhead 顯示開關
        this.overheads.push(oh);
      }
      this.bottomPanel.setActiveCount(players.length);
    }

    // A. 每個 player 各自頭上 UI：跟隨自己位置 + 讀自己 playerId 的狀態。
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const pid = p.playerId;
      const overhead = this.overheads[i];
      // 七輪 待機隔離：待機玩家（未參戰）不顯頭上 UI；加入（投幣進場）後恢復。
      const waiting = typeof p.isWaiting === 'function' && p.isWaiting();
      overhead.setContainerVisible(!waiting);
      if (waiting) continue; // 待機不更新內容/跟隨（隱藏即可）
      const pos = p.getPosition();
      overhead.followWorldPosition(pos.x, pos.y);
      // 魂力環顯示：變身後才顯魂力環（soulRatio）（用戶 #1）。
      const transformed = this.ctx.transform.isTransformed(pid);
      overhead.setSoulVisible(transformed);
      if (transformed) overhead.setSoul(this.ctx.transform.getSoulRatio(pid));
      overhead.setCredit(this.ctx.credit.getCredit(pid));
      // 沒 Credit 演出（閃紅 + 投幣提示 + 倒數）：讀 CreditSystem 耗盡狀態（只讀）。
      overhead.setOutOfCredit(
        this.ctx.credit.isOutOfCredit(pid),
        this.ctx.credit.getCountdown(pid),
      );
      overhead.setCombo(this.ctx.combo.getCombo(pid));
      overhead.setComboWarning(this.ctx.combo.isWarning(pid));
      if (this.ctx.combo.consumeMaxTriggered(pid)) overhead.showMaxCombo();
      // 二段變身能量條（用戶正式規格：取代原 4 格技能槽；讀翼騎接口，只讀不回寫，?. graceful）：
      //  打怪累積 getSecondTransformEnergyRatio 填充 → 滿→二段變身（核心放大/特效/攻擊範圍）→ 消退退完解除。
      //  ★flag 關時核心回 available=false/ratio=0 → 空條（不影響現況）。放招功能已移除（用戶選 A）。
      overhead.setSecondEnergy(
        this.ctx.isSecondTransformAvailable?.(pid) ?? false,
        this.ctx.isSecondTransformActive?.(pid) ?? false,
        this.ctx.getSecondTransformEnergyRatio?.(pid) ?? 0,
      );
    }

    // B. 下方面板：每個 active player 欄刷新自己的彩票 / 進度。
    for (let i = 0; i < players.length && i < this.bottomPanel.slotCount(); i++) {
      const pid = players[i].playerId;
      this.bottomPanel.setTicket(i, this.ctx.ticket.getTickets(pid));
      // 寶盒進度 per-player（chest 已 per-player 化，決策 c61872a6）：各欄顯各自進度。
      this.bottomPanel.setProgress(i, this.ctx.chest.getProgress(pid));
      // 衝刺充能「衝」圖示（用戶新系統，讀翼騎接口，只讀不回寫）：右上數字=可用格數、
      // 未滿→依 cooldownProgress 逆時針壓黑消去、滿→全亮。接口未提供（舊 ctx）則 graceful 略過。
      const getCharges = this.ctx.getDashCharges;
      if (getCharges) {
        const charges = getCharges(pid);
        const max = this.ctx.getDashMaxCharges?.(pid) ?? 3;
        const cd = this.ctx.getDashCooldownProgress?.(pid) ?? 1;
        this.bottomPanel.setDash(i, charges, max, cd);
      }
      // 進場 gate（用戶指定）：衝刺圖示要角色登場動畫完成後才顯示。
      // 進場完成 = 非待機 且 非進場中（isEntering 落地當幀轉 false）。與頭上 UI 待機隔離同範式。
      const p = players[i];
      const waitingP = typeof p.isWaiting === 'function' && p.isWaiting();
      const enteringP = typeof p.isEntering === 'function' && p.isEntering();
      this.bottomPanel.setDashVisible(i, !waitingP && !enteringP);
    }
  }

  destroy(): void {
    for (const o of this.overheads) o.destroy();
    this.overheads = [];
    this.bottomPanel.destroy();
  }
}

