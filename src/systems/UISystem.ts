import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import { ComboCounter } from '@/systems/ui/ComboCounter';
import { EnergyBar } from '@/systems/ui/EnergyBar';
import { PlayerHud } from '@/systems/ui/PlayerHud';

/**
 * UISystem — HUD 系統（見 docs/h5_collab_spec.md）。
 *
 * 職責：在 init 建立固定螢幕 HUD（玩家框架 / 能量 4 格 / COMBO 數字），
 * update 每幀「只讀」ctx 狀態刷新顯示。純顯示層，**絕不回寫任何核心狀態**。
 *
 * 資料來源分兩類：
 *  - 已存在狀態：直接讀 ctx.player（角色 / iFrame 無敵）。
 *  - 尚未實作的系統（能量 / COMBO / 魂力）：走本檔的 stub（見 getEnergy/getCombo/getSoulRatio），
 *    目前一律回 0，只畫視覺框架。日後系統做好，只需把對應 stub 換成真資料一行，
 *    UI 元件與版面完全不動。
 *
 * 邊界：本系統只新增 UI 檔，不改 Player/Enemy/GameScene/config 等他人檔案；
 * 註冊（registerSystems）由整合者統一加。
 */
export class UISystem implements GameSystem {
  readonly name = 'UISystem';

  private ctx!: GameContext;
  private playerHud!: PlayerHud;
  private energyBar!: EnergyBar;
  private comboCounter!: ComboCounter;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const scene = ctx.scene;
    this.playerHud = new PlayerHud(scene);
    this.energyBar = new EnergyBar(scene);
    this.comboCounter = new ComboCounter(scene);
  }

  update(dt: number): void {
    const player = this.ctx.player;

    // 玩家 HUD：讀現有狀態（唯讀）。
    this.playerHud.setCharacter(player.getCharacterKey());
    this.playerHud.setInvincible(player.isInvincible());
    this.playerHud.setSoul(this.getSoulRatio());

    // 能量 / COMBO：走 stub（系統尚未實作）。
    this.energyBar.setEnergy(this.getEnergy());
    this.energyBar.update(dt);
    this.comboCounter.setCombo(this.getCombo());
  }

  destroy(): void {
    this.playerHud.destroy();
    this.energyBar.destroy();
    this.comboCounter.destroy();
  }

  // ---------------------------------------------------------------------------
  // 資料來源 stub —— 能量 / COMBO / 魂力系統尚未實作。
  // 之後接真資料：把對應這一行的回傳改成讀真正的服務即可（UI 不需重做）。
  // 例：能量系統做好後
  //   private getEnergy(): number { return this.ctx.energy.getCharge(); }
  // （若需在 GameContext 加欄位，走 spec §4 由 leader 過 additive，不自己加。）
  // ---------------------------------------------------------------------------

  /** 目前能量充能格數（0..4）。stub：能量系統未實作，暫回 0。 */
  private getEnergy(): number {
    return 0;
  }

  /** 目前 COMBO 連擊數。stub：COMBO 系統未實作，暫回 0。 */
  private getCombo(): number {
    return 0;
  }

  /** 魂力顯示比例（0..1）。stub：魂力系統未實作，暫回 0（佔位框架）。 */
  private getSoulRatio(): number {
    return 0;
  }
}
