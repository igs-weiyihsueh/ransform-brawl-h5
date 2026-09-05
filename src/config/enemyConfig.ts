import type { AttackData } from '@/systems/AttackData';

/**
 * 敵人 AI 設定（資料驅動，全部對照 Unity 數值）。
 *
 * 單位為 Unity world unit（除非另註）；用到時 ×PPU 換像素。
 * 之後要加新敵人，在 ENEMY_AI 加一筆即可，Enemy entity 不用改。
 */

/** 敵人攻擊方式：近戰圓形判定 or 射出射彈。 */
export type EnemyAttackKind = 'melee' | 'projectile';

/**
 * 一般波敵人登場預警時間（秒，對應 Unity spawnWarningDuration=3）：
 * 生成點先冒預警圈淡入這麼久 → 怪才原地出現（非場邊走進）。守護波不用（維持場邊走進）。
 */
export const SPAWN_WARNING_DURATION_SEC = 3;

export interface EnemyAIConfig {
  /** 對應動畫角色 key（也決定 perCharScale）。 */
  characterKey: string;
  hp: number;
  /** 移動速度（unit/s）。 */
  moveSpeed: number;
  /** 偵測範圍（unit）：進入才開始追。 */
  detectRange: number;
  /** 攻擊範圍（unit）：進入就停下、開始蓄力出手。 */
  attackRange: number;
  /** 蓄力時間（秒）：進入攻擊距離後，播 attack 前的前搖。 */
  chargeTime: number;
  /** 攻擊冷卻（秒）。 */
  attackCooldown: number;
  /** 攻擊方式。 */
  attackKind: EnemyAttackKind;
  /** 攻擊資料（近戰用形狀/半徑/offset；射彈用 damage/knockback，形狀給射彈碰撞半徑）。 */
  attack: AttackData;
  /** 射彈速度（unit/s），attackKind='projectile' 時使用。 */
  projectileSpeed?: number;
  /** 受擊硬直時間（秒）。 */
  hitStun: number;
  /** 被擊退力道（對應玩家 knockback 語意：unit → 像素/秒等效）。 */
  knockbackForce: number;
  /**
   * 防穿透抗性（像牆，用戶 #4）：true = 玩家頂不動這隻（immovable），改成玩家自己被擋在敵人外。
   * 菁英 Enemy_Elite=true（Unity hitStun=0.05 幾乎不退像牆）；一般敵人省略/false 照舊被頂開。
   */
  immovable?: boolean;
}

/** 近戰圓形攻擊的 AttackData 輔助。 */
const meleeCircle = (
  radius: number,
  offsetX: number,
  damage: number,
  knockback: number,
): AttackData => ({
  shapeType: 'circle',
  radius,
  offsetX,
  offsetY: 0,
  damage,
  hitDelay: 0, // 敵人用 chargeTime 當前搖，出手當下即判定
  knockback,
});

export const ENEMY_AI: Record<string, EnemyAIConfig> = {
  // 衝鋒兵（近戰）
  Enemy_Rush: {
    characterKey: 'Enemy_Rush',
    hp: 3,
    moveSpeed: 1.5,
    detectRange: 30,
    attackRange: 2,
    chargeTime: 0.5,
    attackCooldown: 2,
    attackKind: 'melee',
    attack: meleeCircle(0.45, 0.8, 10, 3),
    hitStun: 0.8,
    knockbackForce: 3,
  },
  // 遠程兵（射彈）
  Enemy_Ranged: {
    characterKey: 'Enemy_Ranged',
    hp: 2,
    moveSpeed: 1,
    detectRange: 5,
    attackRange: 5,
    chargeTime: 2,
    attackCooldown: 3,
    attackKind: 'projectile',
    // 射彈：radius 當射彈碰撞半徑；offset 讓射彈從身體前方生成。
    attack: {
      shapeType: 'circle',
      radius: 0.2,
      offsetX: 0.5,
      offsetY: 0,
      damage: 15,
      hitDelay: 0,
      knockback: 2,
    },
    projectileSpeed: 8,
    hitStun: 0.8,
    knockbackForce: 2,
  },
  // 菁英兵（大範圍坦）
  Enemy_Elite: {
    characterKey: 'Enemy_Elite',
    hp: 10,
    moveSpeed: 1,
    detectRange: 5,
    attackRange: 2,
    chargeTime: 0.5,
    attackCooldown: 2.5,
    attackKind: 'melee',
    attack: meleeCircle(1.5, 0, 25, 2),
    hitStun: 0.05, // 幾乎不退，像牆
    knockbackForce: 2,
    immovable: true, // 防穿透豁免：玩家頂不動菁英，改成玩家被擋在菁英外（用戶 #4，對應像牆）
  },
};
