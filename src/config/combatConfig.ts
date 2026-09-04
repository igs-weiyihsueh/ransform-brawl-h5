import type { AttackData } from '@/systems/AttackData';

/**
 * 戰鬥相關數值設定。
 *
 * 全部對照 Unity 專案實際數值（單位為 Unity world unit，除非另註）。
 * 之後這些可改成從 JSON 載入；目前先集中在此常數。
 */

/** 角色整體縮放（Unity globalCharacterScale）。攻擊判定的 offset/尺寸都要 × 此值。 */
export const GLOBAL_CHARACTER_SCALE = 1.5;

/** 玩家設定。 */
export const PLAYER_CONFIG = {
  /** 移動速度（unit/s）。 */
  moveSpeed: 3,
  /** 普攻冷卻（秒）。 */
  attackCooldown: 0.333,
  /** 佔位色塊尺寸（unit，未乘 scale）。 */
  bodySize: { width: 0.6, height: 1 },
} as const;

/**
 * 玩家普攻的 AttackData（對齊 Unity）。
 * 幾何數值為「未乘 scale」的原始 unit 值；實際判定時再 × GLOBAL_CHARACTER_SCALE。
 */
export const PLAYER_BASIC_ATTACK: AttackData = {
  shapeType: 'rectangle',
  length: 2,
  width: 0.8,
  offsetX: 1.2,
  offsetY: 0.2,
  damage: 1,
  hitDelay: 0.1,
  knockback: 10,
};

/** Enemy_Rush（骷髏衝鋒兵，近戰追擊）設定。 */
export const ENEMY_RUSH_CONFIG = {
  hp: 3,
  moveSpeed: 1.5,
  /** 進入此距離(unit)內停止追擊。 */
  attackRange: 2,
  /** 佔位色塊尺寸（unit，未乘 scale）。 */
  bodySize: { width: 0.6, height: 1 },
} as const;
