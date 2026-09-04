import type Phaser from 'phaser';
import type { Enemy } from '@/entities/Enemy';
import type { Player } from '@/entities/Player';
import type { EffectSystem } from '@/systems/EffectSystem';
import type { EnemySpawner } from '@/systems/EnemySpawner';
import type { InputSystem } from '@/systems/InputSystem';

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

  /** 取得目前場上存活的敵人（唯讀快照，供命中查詢/AI 目標）。 */
  getEnemies(): readonly Enemy[];
}
