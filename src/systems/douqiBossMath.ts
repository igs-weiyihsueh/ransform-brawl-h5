/**
 * douqiBossMath — 鬥氣 BOSS 三招命中判定純函式（階段 5）。無 Phaser/場景，抽給測騎測。
 * 招 a 圓 / c 扇形 / d 左右半場——形狀區域 telegraph→fire pattern 的幾何判定（同 towerRingSkill 家族）。
 */

import { normalizeDeg, angleDiffDeg } from '@/systems/douqiTowerFanMath';

/** 填滿進度 [0,1]。 */
export function bossFillProgress(elapsedMs: number, fillMs: number): number {
  if (fillMs <= 0) return 1;
  const p = elapsedMs / fillMs;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** 招 a：以 BOSS 為圓心實心大圓——玩家距 BOSS ≤ radius+玩家半徑 → 命中。 */
export function circleHit(
  boss: { x: number; y: number },
  target: { x: number; y: number },
  targetRadius: number,
  radiusPx: number,
): boolean {
  return Math.hypot(target.x - boss.x, target.y - boss.y) <= radiusPx + targetRadius;
}

/**
 * 招 c：瞄玩家方向的大扇形——玩家距 BOSS ≤ range+半徑 且 相對 BOSS 角度落 [瞄準中心 ± arcDeg/2] 內 → 命中。
 * @param aimDeg 扇形中心朝向（度，發招瞬間鎖定的玩家方向；填滿期間固定不追）。
 */
export function fanHit(
  boss: { x: number; y: number },
  target: { x: number; y: number },
  targetRadius: number,
  aimDeg: number,
  arcDeg: number,
  rangePx: number,
): boolean {
  const dx = target.x - boss.x;
  const dy = target.y - boss.y;
  if (Math.hypot(dx, dy) > rangePx + targetRadius) return false;
  const ang = normalizeDeg((Math.atan2(dy, dx) * 180) / Math.PI);
  return angleDiffDeg(ang, aimDeg) <= arcDeg / 2;
}

/**
 * 招 d：左右半場接力——以場中心 centerX 分左右半場，該半場 fill 完發射時，玩家在該半場側 → 命中。
 * @param side 'left'|'right'。
 */
export function halfFieldHit(centerX: number, targetX: number, side: 'left' | 'right'): boolean {
  return side === 'left' ? targetX <= centerX : targetX > centerX;
}

/**
 * 招 d 接力時序：左半 0→fillMs fill；右半在左半 fill 到 halfOverlap 比例時才開始（延遲 fillMs×halfOverlap）。
 * @returns { leftFill, rightFill } 各半場填滿進度 [0,1]。
 */
export function halfFieldFills(
  elapsedMs: number,
  fillMs: number,
  halfOverlap: number,
): { leftFill: number; rightFill: number } {
  const leftFill = bossFillProgress(elapsedMs, fillMs);
  const rightStart = fillMs * halfOverlap;
  const rightFill = bossFillProgress(elapsedMs - rightStart, fillMs);
  return { leftFill, rightFill };
}

/** BOSS HP：base ×(1+(bossCount-1)×growth)×hpScale。 */
export function bossMaxHp(base: number, bossCount: number, growth: number, hpScale: number): number {
  const seqMult = 1 + Math.max(0, bossCount - 1) * growth;
  return Math.max(1, Math.round(base * seqMult * hpScale));
}
