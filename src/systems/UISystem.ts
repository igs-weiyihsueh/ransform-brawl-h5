import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import { BottomPanel } from '@/systems/ui/BottomPanel';
import { PlayerOverheadUI } from '@/systems/ui/PlayerOverheadUI';

/**
 * UISystem — HUD 系統（見 docs/h5_collab_spec.md）。
 *
 * 對照 Unity prefab，HUD 分兩塊，皆為純顯示層（**絕不回寫任何核心狀態**）：
 *  A. PlayerOverheadUI —— 角色頭上 UI，世界座標，每幀跟隨 ctx.player 位置。
 *     元素：玩家編號牌 / 魂力環 / Credit+金幣 / 能量 4 格 / COMBO。
 *  B. BottomPanel —— 螢幕底部固定 4 欄 P1~P4（單人：P1 完整、P2~P4 佔位）。
 *     元素：面板底框 / 寶箱 icon / 彩票數 / 進度條 / 金幣 icon。
 *
 * 資料來源：
 *  - 已存在狀態：ctx.player.getPosition()（頭上 UI 跟隨）、能量接 getEnergy。
 *  - 尚未實作系統（Credit / 彩票 / 魂力 / COMBO / 能量真值）：走本檔 stub，
 *    目前回佔位值，只排佈局。日後系統做好只換對應 stub 一行，UI 版面不動。
 *
 * 邊界：只新增 UI 檔，不改 Player/Enemy/GameScene/config 等他人檔；
 * 註冊（registerSystems）由整合者統一加。
 */
export class UISystem implements GameSystem {
  readonly name = 'UISystem';

  private ctx!: GameContext;
  private overhead!: PlayerOverheadUI;
  private bottomPanel!: BottomPanel;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const scene = ctx.scene;
    this.overhead = new PlayerOverheadUI(scene);
    this.bottomPanel = new BottomPanel(scene);
  }

  update(dt: number): void {
    const player = this.ctx.player;

    // A. 頭上 UI：跟隨玩家世界座標 + 刷新數值。
    const pos = player.getPosition();
    this.overhead.followWorldPosition(pos.x, pos.y);
    this.overhead.setSoul(this.getSoulRatio());
    this.overhead.setCredit(this.getCredit());
    this.overhead.setCombo(this.getCombo());
    this.overhead.setEnergy(this.getEnergy());
    this.overhead.updateEnergy(dt);

    // B. 下方面板：刷新 P1 stub 數值（P2~P4 佔位不刷新）。
    this.bottomPanel.setTicket(0, this.getTicket());
    this.bottomPanel.setProgress(0, this.getProgress());
  }

  destroy(): void {
    this.overhead.destroy();
    this.bottomPanel.destroy();
  }

  // ---------------------------------------------------------------------------
  // 資料來源 stub —— 相依系統（Credit / 彩票 / 魂力 / COMBO / 能量）尚未實作。
  // 之後接真資料：把對應這一行的回傳改成讀真正的服務即可（UI 版面不需重做）。
  // 例：能量系統做好後
  //   private getEnergy(): number { return this.ctx.energy.getCharge(); }
  // （若需在 GameContext 加欄位，走 spec §4 由 leader 過 additive，不自己加。）
  // ---------------------------------------------------------------------------

  /** 能量充能格數（0..4）。stub：能量系統未實作，暫回 0。 */
  private getEnergy(): number {
    return 0;
  }

  /** COMBO 連擊數。stub：COMBO 系統未實作，暫回 0。 */
  private getCombo(): number {
    return 0;
  }

  /** 魂力顯示比例（0..1）。stub：魂力系統未實作，暫回 1（環先畫滿當佔位）。 */
  private getSoulRatio(): number {
    return 1;
  }

  /** Credit 數字。stub：Credit 系統未實作，暫回 0。 */
  private getCredit(): number {
    return 0;
  }

  /** 彩票數。stub：彩票系統未實作，暫回 0。 */
  private getTicket(): number {
    return 0;
  }

  /** 寶箱/獎勵進度比例（0..1）。stub：未實作，暫回 0。 */
  private getProgress(): number {
    return 0;
  }
}
