import type Phaser from 'phaser';
import type { Enemy } from '@/entities/Enemy';
import type { Player } from '@/entities/Player';
import type { CreditSystem } from '@/systems/CreditSystem';
import type { EffectSystem } from '@/systems/EffectSystem';
import type { EnemySpawner } from '@/systems/EnemySpawner';
import type { EnergySystem } from '@/systems/EnergySystem';
import type { InputSystem } from '@/systems/InputSystem';
import type { TransformSystem } from '@/systems/TransformSystem';

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

  /** 玩家實體。 */
  readonly player: Player;
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

  /** 取得目前場上存活的敵人（唯讀快照，供命中查詢/AI 目標）。 */
  getEnemies(): readonly Enemy[];
}
