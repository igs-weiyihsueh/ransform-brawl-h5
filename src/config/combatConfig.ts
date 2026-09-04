import type { AttackData } from '@/systems/AttackData';

/**
 * 戰鬥相關數值設定。
 *
 * 全部對照 Unity 專案實際數值（單位為 Unity world unit，除非另註）。
 * 之後這些可改成從 JSON 載入；目前先集中在此常數。
 */

/** 角色整體縮放（Unity globalCharacterScale）。攻擊判定的 offset/尺寸都要 × 此值。 */
export const GLOBAL_CHARACTER_SCALE = 1.5;

/**
 * 逐幀動畫貼圖的縮放。
 *
 * 幀畫布為 256×256（FRAME_SIZE），但角色實際只佔畫布一部分。
 * 目標：讓角色視覺高度大致對齊階段 1 的色塊（body height 1 unit × scale1.5 × PPU100 = 150px）。
 * 這裡用一個基準倍率 × GLOBAL_CHARACTER_SCALE；若某角色看起來太大/太小，調 spriteScaleBase 即可。
 */
export const SPRITE_SCALE_BASE = 0.7;

/** 動畫貼圖最終縮放 = 基準 × 角色整體 scale。 */
export const SPRITE_SCALE = SPRITE_SCALE_BASE * GLOBAL_CHARACTER_SCALE;

/** 玩家設定。 */
export const PLAYER_CONFIG = {
  /** 移動速度（unit/s）。 */
  moveSpeed: 3,
  /** 普攻冷卻（秒）。 */
  attackCooldown: 0.333,
  /** 佔位色塊尺寸（unit，未乘 scale）。 */
  bodySize: { width: 0.6, height: 1 },
} as const;

/** 衝刺（Dash）設定（對齊 Unity PlayerConfig）。單位 unit，判定時 ×PPU。 */
export const DASH_CONFIG = {
  /** 衝刺速度（unit/s）。 */
  speed: 8,
  /** 衝刺持續時間（秒）。 */
  duration: 0.2,
  /** 衝刺命中傷害。 */
  damage: 1,
  /** 衝刺命中側向擊退力道（輕微）。 */
  knockback: 1,
  /** 衝刺命中判定圓半徑（unit）。 */
  radius: 0.5,
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

/** 玩家受擊無敵時間（秒），對齊 Unity iFrameDuration。 */
export const PLAYER_IFRAME_DURATION = 0.5;

/** 玩家被攻擊命中的碰撞半徑（unit）。 */
export const PLAYER_HIT_RADIUS = 0.4;
