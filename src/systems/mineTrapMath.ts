/**
 * mineTrapMath.ts — 地雷陷阱純邏輯（2 新事件階段 B）。
 *
 * 定點鋪雷→delaySec 延遲爆炸→radiusPx 範圍內玩家/怪麻痺 paralyzeSec（★不分敵我、不扣血）。
 * 這裡抽「範圍命中判定」+ 延遲倒數推進純函式（rng/Phaser 無關，好測）。
 */

/** 目標是否在地雷爆炸範圍內（歐氏距離 <= radiusPx）。 */
export function isInBlastRange(
  targetPos: { x: number; y: number },
  minePos: { x: number; y: number },
  radiusPx: number,
): boolean {
  const dx = targetPos.x - minePos.x;
  const dy = targetPos.y - minePos.y;
  return Math.hypot(dx, dy) <= radiusPx;
}

/**
 * 推進地雷延遲倒數（純函式）：回傳 { remaining, exploded }。
 * @param remaining 目前剩餘延遲秒。@param dt 幀時間。
 * @returns exploded=true 表示這幀倒數歸零（該爆）；remaining clamp 0。
 */
export function tickMineDelay(remaining: number, dt: number): { remaining: number; exploded: boolean } {
  const next = remaining - dt;
  if (remaining > 0 && next <= 0) return { remaining: 0, exploded: true };
  return { remaining: Math.max(0, next), exploded: false };
}
