import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import type Phaser from 'phaser';
import { UI_ICONS, UI_LAYOUT_ASSET } from '@/config/uiConfig';
import {
  DEFAULT_UI_LAYOUT,
  validateUiLayout,
  type UiLayoutFile,
} from '@/config/uiLayoutSchema';
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

    // 每個目前存在的 player 各建一份頭上 UI。
    for (let i = 0; i < ctx.players.length; i++) {
      this.overheads.push(new PlayerOverheadUI(scene, `P${i + 1}`));
    }
  }

  /** 載入並驗證 uiLayout.json；失敗（未載/不合法）退回 DEFAULT_UI_LAYOUT。 */
  private loadLayout(scene: Phaser.Scene): UiLayoutFile {
    const raw = scene.cache.json.get(UI_LAYOUT_ASSET.key) as unknown;
    if (raw !== undefined && raw !== null) {
      const result = validateUiLayout(raw);
      if (result.ok) return result.data;
      // 不合法：警告後退回預設（不讓 UI 整個壞掉）。
      console.warn('[UISystem] uiLayout.json 驗證失敗，改用預設佈局：', result.errors);
    }
    return DEFAULT_UI_LAYOUT;
  }

  update(dt: number): void {
    const players = this.ctx.players;

    // 玩家加入（F2~F4）→ 補建頭上 UI + 亮對應底部欄。
    if (this.overheads.length < players.length) {
      for (let i = this.overheads.length; i < players.length; i++) {
        this.overheads.push(new PlayerOverheadUI(this.ctx.scene, `P${i + 1}`));
      }
      this.bottomPanel.setActiveCount(players.length);
    }

    // A. 每個 player 各自頭上 UI：跟隨自己位置 + 讀自己 playerId 的狀態。
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const pid = p.playerId;
      const overhead = this.overheads[i];
      const pos = p.getPosition();
      overhead.followWorldPosition(pos.x, pos.y);
      overhead.setSoul(this.ctx.transform.getSoulRatio(pid));
      overhead.setCredit(this.ctx.credit.getCredit(pid));
      overhead.setCombo(this.ctx.combo.getCombo(pid));
      overhead.setComboWarning(this.ctx.combo.isWarning(pid));
      if (this.ctx.combo.consumeMaxTriggered(pid)) overhead.showMaxCombo();
      overhead.setEnergy(this.ctx.energy.getEnergy(pid));
      overhead.updateEnergy(dt);
    }

    // B. 下方面板：每個 active player 欄刷新自己的彩票 / 進度。
    for (let i = 0; i < players.length && i < this.bottomPanel.slotCount(); i++) {
      const pid = players[i].playerId;
      this.bottomPanel.setTicket(i, this.ctx.ticket.getTickets(pid));
      // 寶盒進度 per-player（chest 已 per-player 化，決策 c61872a6）：各欄顯各自進度。
      this.bottomPanel.setProgress(i, this.ctx.chest.getProgress(pid));
    }
  }

  destroy(): void {
    for (const o of this.overheads) o.destroy();
    this.overheads = [];
    this.bottomPanel.destroy();
  }
}

