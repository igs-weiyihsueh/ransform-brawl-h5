import type Phaser from 'phaser';
import type { Enemy } from '@/entities/Enemy';
import type { Player } from '@/entities/Player';
import type { ChestSystem } from '@/systems/ChestSystem';
import type { ComboSystem } from '@/systems/ComboSystem';
import type { CreditSystem } from '@/systems/CreditSystem';
import type { BuffSystem } from '@/systems/BuffSystem';
import type { EffectSystem } from '@/systems/EffectSystem';
import type { EnemySpawner } from '@/systems/EnemySpawner';
import type { EnergySystem } from '@/systems/EnergySystem';
import type { HelmetSystem } from '@/systems/HelmetSystem';
import type { InputSystem } from '@/systems/InputSystem';
import type { JpSystem } from '@/systems/JpSystem';
import type { TicketSystem } from '@/systems/TicketSystem';
import type { TransformSystem } from '@/systems/TransformSystem';
import type { WaveSystem } from '@/systems/WaveSystem';

/**
 * GameContext — 各 GameSystem 共用的執行環境與服務。
 *
 * 這是系統之間的「共用契約」（見 docs/h5_collab_spec.md §4）：
 * 新系統一律透過 context 取得場景與共用服務（玩家、輸入、特效、生怪器、敵人清單），
 * 不直接伸手進 GameScene 內部欄位，避免多人開發互相耦合/撞車。
 *
 * 欄位刻意用「唯讀存取 + 服務物件」形式；要改共用契約請走 spec §4 流程。
 */
export interface GameContext {
  readonly scene: Phaser.Scene;
  readonly worldBounds: Phaser.Geom.Rectangle;

  /**
   * 本地人類玩家 P1（= players[0]）。現有讀取 ctx.player 的碼皆指向本地 P1。
   * per-player 迭代（多人）未來用 players[]；ctx.player === ctx.players[0] 恆真。
   */
  readonly player: Player;
  /** 玩家陣列（多人遷移；讀取用。增減只透過 addPlayer 受控入口）。 */
  readonly players: readonly Player[];
  /**
   * 受控加入玩家（S4 join API 單一入口）：F2/F3/F4 生成 AI player 時呼叫。
   * 不讓外部隨意 push players[]，保持增減有單一入口。
   */
  addPlayer(player: Player): void;
  /**
   * 待機點解析器（投幣進場循環）：回某 player 下方面板待機點螢幕座標。
   * 由 GameScene 設定（委派 UISystem.getWaitingAnchor + fallback）。純視覺/流程用。
   */
  getWaitingAnchor(playerIndex: number): { x: number; y: number };
  /** 輸入抽象。 */
  readonly input: InputSystem;
  /** 可重用特效系統。 */
  readonly effects: EffectSystem;
  /** 生怪器：波次等系統透過它生怪，不碰 Enemy 內部。 */
  readonly spawner: EnemySpawner;
  /** 能量/招式系統：放招決策 + 充能狀態（UI 讀能量條、PlayerControl 取攻擊意圖）。 */
  readonly energy: EnergySystem;
  /** 變身系統：變身狀態 + 魂力（UI 讀魂力環、道具撿取觸發變身）。 */
  readonly transform: TransformSystem;
  /** Credit 系統：投幣/命資源 + 耗盡狀態（UI 讀 credit、攻擊/移動閘門、命中扣 credit）。 */
  readonly credit: CreditSystem;
  /** COMBO 連段系統：連段數/警告/結算彩票（UI 讀 COMBO、命中累積）。 */
  readonly combo: ComboSystem;
  /** 彩票系統：累積彩票（COMBO 結算灌入、UI 讀彩票數）。 */
  readonly ticket: TicketSystem;
  /** 寶盒系統：擊殺累積寶盒能量、滿 165 自動開箱（UI 讀進度、EnemySpawner 擊殺灌 charge）。 */
  readonly chest: ChestSystem;
  /** 波次/關卡系統：生怪節奏、一幕通關事件（JP 給燈）。 */
  readonly wave: WaveSystem;
  /**
   * 十六輪(追加)：請求某玩家「強制真攻擊」的 hook（GameScene 綁 PlayerControlSystem.requestForcedAttack）。
   * GrabSystem 掙脫成功那刻呼叫 → 角色下一幀揮一次真攻擊（揮開 grabber，非只解除）。避免直接耦合 PlayerControlSystem 型別。
   */
  requestPlayerAttack?: (playerId: number) => void;
  /**
   * 十六輪：充能式衝刺 UI 讀取 hook（GameScene 綁 PlayerControlSystem）。供界騎繪製衝刺充能格 + 冷卻壓黑。
   * - getDashCharges：目前可用格數（0~max）。
   * - getDashMaxCharges：最大格數（=3）。
   * - getDashCooldownProgress：當前回充格進度 0~1（滿格 0）。
   */
  getDashCharges?: (playerId: number) => number;
  getDashMaxCharges?: (playerId: number) => number;
  getDashCooldownProgress?: (playerId: number) => number;
  /**
   * 用戶新大功能：二段變身能量條 UI/特效讀取 hook（GameScene 綁 TransformSystem）。★feature flag 關時回 0/false。
   * - getSecondTransformEnergyRatio：能量條填充 0~1。
   * - isSecondTransformActive：是否二段變身中（放大+強化）。特效可讀此做邊緣觸發。
   * - isSecondTransformAvailable：是否可累積（一段悟空後 且 flag 開）。
   */
  getSecondTransformEnergyRatio?: (playerId: number) => number;
  isSecondTransformActive?: (playerId: number) => boolean;
  isSecondTransformAvailable?: (playerId: number) => boolean;
  /** JP 累積獎池：三組燈/倍數池、集滿派彩（幕通關給燈、命中扣 credit 累積、灌 ticket）。 */
  readonly jp: JpSystem;
  /** 通用計時 buff 框架（頭盔能力 + 寶盒坐騎/二段變身共用）。 */
  readonly buff: BuffSystem;
  /** 頭盔能力系統（撿頭盔套計時能力）。 */
  readonly helmet: HelmetSystem;

  /** 取得目前場上存活的敵人（唯讀快照，供命中查詢/AI 目標）。 */
  getEnemies(): readonly Enemy[];

  /**
   * 腳本控制旗標（用戶 #4 守護波開場導引走位）：true 時 PlayerControlSystem 跳過玩家輸入，
   * 由 GuardEvent 導引走位驅動。開場結束設回 false 恢復操作。可變（非 readonly）。
   */
  scriptedControl: boolean;

  /**
   * 守護波聚焦暫停定格（對齊 Unity Time.timeScale=0）：focus phase 期間 true → 遊戲玩法系統凍結
   * （敵人/物理/移動/計時 dt=0），但聚焦 UI（spotlight/協力大字/雕像呼吸燈，皆 scene.tweens）照播。
   * GuardEvent beginFocus 設 true、endFocus/forceFinish 設 false（務必解除乾淨不卡死）。可變。
   */
  guardFocusPause: boolean;
}
