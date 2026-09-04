import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import type Phaser from 'phaser';
import { UI_ICONS } from '@/config/uiConfig';
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

  /**
   * 載入 HUD 用的 UI icon 貼圖（對照 EffectSystem.preload 慣例）。
   * 由 GameScene.preload() 呼叫一次：UISystem.preload(this)。
   * 沒載到的 icon，元件會自動退回原本的色塊/圖形佔位（不會壞）。
   */
  static preload(scene: Phaser.Scene): void {
    for (const icon of Object.values(UI_ICONS)) {
      scene.load.image(icon.key, icon.path);
    }
  }

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
    // COMBO 警告閃爍 + 滿檔 MAX!（接 ComboSystem）。
    this.overhead.setComboWarning(this.ctx.combo.isWarning());
    if (this.ctx.combo.consumeMaxTriggered()) this.overhead.showMaxCombo();
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

  /** 能量充能格數（0..上限）。接 EnergySystem（決策 15fec2a4）。 */
  private getEnergy(): number {
    return this.ctx.energy.getEnergy();
  }

  /** COMBO 連擊數。接 ComboSystem。 */
  private getCombo(): number {
    return this.ctx.combo.getCombo();
  }

  /** 魂力顯示比例（0..1）。接 TransformSystem：變身時 soul/max、退變時 0。 */
  private getSoulRatio(): number {
    return this.ctx.transform.getSoulRatio();
  }

  /** Credit 數字。接 CreditSystem。 */
  private getCredit(): number {
    return this.ctx.credit.getCredit();
  }

  /** 彩票數。接 TicketSystem。 */
  private getTicket(): number {
    return this.ctx.ticket.getTickets();
  }

  /** 寶箱進度比例（0..1）。接 ChestSystem（chestCharge/門檻）。 */
  private getProgress(): number {
    return this.ctx.chest.getProgress();
  }
}
