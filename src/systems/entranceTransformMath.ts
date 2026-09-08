/**
 * entranceTransformMath.ts — 投幣「變身進場表演」純邏輯（用戶第3條：浮起→發光變身→降臨→落地震退）。
 *
 * 表演時序（待機區）：投幣→①身體浮起(floatSec 內往上浮 riseUnits)→②浮到頂發光變身(transformToRandomHero)
 *   →③降臨(沿用既有拋物線 startEntrance 到場上落點)→④落地震退周圍敵人(applyLandingKnockback)。
 * 這裡抽時序進度 + 震退範圍/力道 config（純函式，rng/Phaser 無關，好測、可調）。
 * ★特效素材（浮起光/發光/降臨/震退波）另做，本模組只管時序數值+震退幾何。
 */
import { PPU } from '@/config/gameConfig';

/** 變身進場表演參數（可調，對齊可調範式；unit×PPU 換 px）。 */
export const ENTRANCE_TRANSFORM = {
  /** ①浮起時長（秒）：投幣後在待機區往上浮這麼久 → 到頂發光變身。 */
  floatSec: 0.6,
  /** ①浮起高度（unit，往上；px = ×PPU）。離地一小段。 */
  floatRiseUnits: 0.6,
  /** 變身觸發時機：浮起進度達此比例（0~1）發光變身（預設浮到 85% 高度時變身）。 */
  transformAtProgress: 0.85,
  /** ④落地震退範圍半徑（unit）：落點此範圍內的敵人被震開。 */
  knockbackRadiusUnits: 2.0,
  /** ④落地震退推進距離（unit）：被震敵人往外推這麼遠。 */
  knockbackDistUnits: 1.8,
} as const;

/** 震退範圍半徑（px）。 */
export const ENTRANCE_KNOCKBACK_RADIUS_PX = ENTRANCE_TRANSFORM.knockbackRadiusUnits * PPU;

/**
 * ①浮起 Y 位移（純函式）：投幣後經過 elapsed 秒，相對待機基準 y 的位移（負=往上，H5 Y 下為正）。
 * ease-out 上浮（快起慢停）；elapsed>=floatSec → 停在最高點 -riseUnits×PPU。
 * @param elapsed 浮起已經過秒數（>=0）。
 * @param floatSec 浮起總時長（預設 ENTRANCE_TRANSFORM.floatSec）。
 * @param riseUnits 浮起高度 unit（預設 ENTRANCE_TRANSFORM.floatRiseUnits）。
 * @returns Y 位移 px（<=0，往上）。
 */
export function floatOffsetY(
  elapsed: number,
  floatSec: number = ENTRANCE_TRANSFORM.floatSec,
  riseUnits: number = ENTRANCE_TRANSFORM.floatRiseUnits,
): number {
  if (floatSec <= 0) return -riseUnits * PPU;
  const t = Math.min(1, Math.max(0, elapsed / floatSec));
  const eased = 1 - (1 - t) * (1 - t); // ease-out quad
  return -eased * riseUnits * PPU;
}

/** ①浮起是否結束（elapsed 達 floatSec）→ 該進降臨。 */
export function isFloatDone(elapsed: number, floatSec: number = ENTRANCE_TRANSFORM.floatSec): boolean {
  return elapsed >= floatSec;
}

/**
 * ②是否到達「發光變身」時機（浮起進度達 transformAtProgress）。
 * @param elapsed 浮起已經過秒。@param floatSec 總時長。@param at 觸發比例（預設 transformAtProgress）。
 */
export function shouldTransformDuringFloat(
  elapsed: number,
  floatSec: number = ENTRANCE_TRANSFORM.floatSec,
  at: number = ENTRANCE_TRANSFORM.transformAtProgress,
): boolean {
  if (floatSec <= 0) return true;
  return elapsed / floatSec >= at;
}

/**
 * ④某敵人是否在落地震退範圍內（純函式）。
 * @param enemyPos 敵人位置。@param landPos 落點。@param radiusPx 範圍半徑 px（預設 ENTRANCE_KNOCKBACK_RADIUS_PX）。
 */
export function isInKnockbackRange(
  enemyPos: { x: number; y: number },
  landPos: { x: number; y: number },
  radiusPx: number = ENTRANCE_KNOCKBACK_RADIUS_PX,
): boolean {
  return Math.hypot(enemyPos.x - landPos.x, enemyPos.y - landPos.y) <= radiusPx;
}
