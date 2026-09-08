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
  /**
   * 推怪負重（用戶：敵人越多推越有阻力，Unity PlayerController）：
   * factor = 1/(1 + pushResistance × 推的怪數)，下限 pushMinSpeedFactor。effectiveSpeed = moveSpeed × factor。
   */
  pushResistance: 0.35,
  pushMinSpeedFactor: 0.3,
  /**
   * 攻擊前戳 lunge（Unity PlayerController ApplyLungeVelocity / PlayerConfig，十一輪#2）：
   * 攻擊時本體往攻擊(aim)方向給一個 lunge 初速 impulse，每幀指數衰減施加位移（看得見前進、不回彈）。
   */
  lungeEnabled: true,
  /** lunge 初速（unit/s；Unity lungeForce=6，×PPU=600px/s 起手、衰減後為短前戳一步）。 */
  lungeForce: 6,
  /** lunge 每幀(1/60s)速度衰減係數（0.82→約 0.15s 內衰減至可忽略，配合連打累積）。 */
  lungeDecayFactor: 0.82,
} as const;

/** 衝刺（Dash）設定（對齊 Unity PlayerConfig）。單位 unit，判定時 ×PPU。 */
export const DASH_CONFIG = {
  /** 衝刺速度（unit/s）。七輪對齊 Unity dashSpeed=15（用戶定案：更快更遠更衝）。 */
  speed: 15,
  /** 衝刺持續時間（秒）。七輪對齊 Unity dashDuration=0.15（距離=speed×duration=2.25unit）。 */
  duration: 0.15,
  /** 衝刺命中傷害（Unity dashDamage=1）。 */
  damage: 1,
  /** 衝刺命中側向擊退力道（Unity dashKnockback=1，輕微）。 */
  knockback: 1,
  /** 衝刺命中判定圓半徑（unit）。 */
  radius: 0.5,
  /** 衝刺充能最大格數（十六輪 充能式衝刺，異靈規格=3）。 */
  maxCharges: 3,
  /** 每格衝刺充能回充所需時間（秒）。跑滿一圈 +1 格。用戶定案 2 秒。 */
  cooldownDuration: 2,
} as const;

/**
 * 二段變身能量條設定（用戶新大功能，型態 A＝沿用悟空、變大+強化）。★邊做邊調。
 * ★feature flag：enabled 預設 false——關時 TransformSystem 完全不跑二段邏輯，行為 100% 不變（不影響用戶現測）。
 * 前提：玩家已是一段悟空變身後才累積二段能量；滿自動觸發二段（放大+攻擊範圍加成）；二段隨時間消退，退完回一段常態。
 */
export const SECOND_TRANSFORM_CONFIG = {
  /** ★feature flag：預設關（做好先不上線）。開才啟用二段變身。 */
  enabled: false,
  /** 擊殺一隻怪累積的能量（ratio，0~1 空間；預設約 8 隻滿）。 */
  energyPerKill: 0.12,
  /** 普攻命中一次累積的能量（ratio；比擊殺少）。 */
  energyPerHit: 0.03,
  /** 觸發二段的能量閾值（滿＝1）。 */
  fillThreshold: 1,
  /** 二段期間每秒能量消退（ratio/秒；1/decayPerSec≈二段持續秒數，預設約 8s）。 */
  decayPerSec: 0.125,
  /** 二段視覺放大倍率（悟空放大，乘在 SPRITE_SCALE 上）。 */
  scaleMult: 1.4,
  /** 二段攻擊範圍加成倍率（攻擊形狀 length/radius ×此值）。 */
  attackRangeMult: 1.4,
} as const;

/**
 * 玩家普攻的 AttackData（對齊 Unity）。
 * 幾何數值為「未乘 scale」的原始 unit 值；實際判定時再 × GLOBAL_CHARACTER_SCALE。
 */
export const PLAYER_BASIC_ATTACK: AttackData = {
  shapeType: 'rectangle',
  length: 2,
  width: 1.3,
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
