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
  /** JP 累積獎池：三組燈/倍數池、集滿派彩（幕通關給燈、命中扣 credit 累積、灌 ticket）。 */
  readonly jp: JpSystem;
  /** 通用計時 buff 框架（頭盔能力 + 寶盒坐騎/二段變身共用）。 */
  readonly buff: BuffSystem;
  /** 頭盔能力系統（撿頭盔套計時能力）。 */
  readonly helmet: HelmetSystem;

  /** 取得目前場上存活的敵人（唯讀快照，供命中查詢/AI 目標）。 */
  getEnemies(): readonly Enemy[];
}
