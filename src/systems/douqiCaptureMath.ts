/**
 * douqiCaptureMath — 鬥氣佔領事件純邏輯（階段 4 commit2）。無 Phaser/場景，抽給測騎測。
 */

/** 圓內均勻取點（√random 半徑分佈避免中心聚集）。rng 回 [0,1)。 */
export function randomPointInCircle(
  cx: number,
  cy: number,
  radius: number,
  rng: () => number = Math.random,
): { x: number; y: number } {
  const ang = rng() * Math.PI * 2;
  const r = radius * Math.sqrt(rng()); // √random＝面積均勻
  return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
}

/** 點是否在圓內（<= 半徑）。 */
export function inCircle(px: number, py: number, cx: number, cy: number, radius: number): boolean {
  return Math.hypot(px - cx, py - cy) <= radius;
}

/**
 * 佔領進度推進量（秒）。★雙條件門控：玩家在圈內 且 圈內存活怪==0 才推進 progressPerSec×dt；
 *   有怪或玩家不在圈→不推進（★不倒退）。
 * @returns 本幀進度增量（>=0）。
 */
export function captureProgressDelta(
  playerInCircle: boolean,
  enemiesInCircle: number,
  progressPerSec: number,
  dt: number,
): number {
  if (!playerInCircle || enemiesInCircle > 0) return 0;
  return progressPerSec * dt;
}

/** 佔領圈視覺狀態：綠(在圈+無怪)/黃(在圈有怪)/灰(不在圈)。 */
export function captureRingColor(playerInCircle: boolean, enemiesInCircle: number): 'green' | 'yellow' | 'gray' {
  if (!playerInCircle) return 'gray';
  return enemiesInCircle > 0 ? 'yellow' : 'green';
}
