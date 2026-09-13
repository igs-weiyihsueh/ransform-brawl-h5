/**
 * fusionAimMath — 鬥氣融合瞄準純邏輯（階段 1 commit2）。零 Phaser、可測。交測騎。
 *
 * 融合瞄準（autoLock=false）：滑鼠指向 → 錐形內選「角度差最小」者鎖定；候選含敵人+道具，道具略優先（角度差 ×itemWeight）。
 * ★純選擇邏輯（誰被鎖）；實際位移/衝刺/命中在 DouqiControlStrategy（走現有 startDash/resolveDashHits）。
 */

export interface AimCandidate {
  /** 候選唯一 id（呼叫端用於取回實體）。 */
  id: number;
  /** 候選位置（世界座標 px）。 */
  x: number;
  y: number;
  /** 是否道具（true→角度差 ×itemWeight 略優先）。 */
  isItem: boolean;
}

export interface FusionAimParams {
  /** 錐半角（度）。 */
  coneHalfAngleDeg: number;
  /** 道具權重（<1 略優先）。 */
  itemWeight: number;
  /** 最大距離（px）；超出不納入。 */
  maxRangePx: number;
}

/** 兩角度差（弧度）取絕對值，收斂到 [0, π]。 */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/**
 * 融合瞄準選擇：從 origin 朝 aimAngle（弧度）方向，在錐半角內、距離內、選加權角度差最小的候選。
 * @param origin 玩家位置。
 * @param aimAngle 滑鼠指向角（弧度，atan2(my-py, mx-px)）。
 * @param candidates 候選（敵人+道具）。
 * @param params 錐半角/道具權重/最大距離。
 * @returns 命中候選 id，或 null（錐內無候選）。
 */
export function selectFusionTarget(
  origin: { x: number; y: number },
  aimAngle: number,
  candidates: readonly AimCandidate[],
  params: FusionAimParams,
): number | null {
  const half = (params.coneHalfAngleDeg * Math.PI) / 180;
  let bestId: number | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const dx = c.x - origin.x;
    const dy = c.y - origin.y;
    const dist = Math.hypot(dx, dy);
    if (dist > params.maxRangePx || dist < 1e-6) continue;
    const diff = angleDiff(Math.atan2(dy, dx), aimAngle);
    if (diff > half) continue; // 錐外
    const score = c.isItem ? diff * params.itemWeight : diff; // 道具略優先
    if (score < bestScore) {
      bestScore = score;
      bestId = c.id;
    }
  }
  return bestId;
}

/**
 * 靜止按攻擊時：鎖「最近」可傷怪（無方向，純距離最近）。
 * @returns 最近候選 id 或 null。
 */
export function selectNearest(
  origin: { x: number; y: number },
  candidates: readonly AimCandidate[],
  maxRangePx: number,
): number | null {
  let bestId: number | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const dist = Math.hypot(c.x - origin.x, c.y - origin.y);
    if (dist > maxRangePx) continue;
    if (dist < bestDist) {
      bestDist = dist;
      bestId = c.id;
    }
  }
  return bestId;
}
