import { PPU } from '@/config/gameConfig';
import type { Vec2 } from '@/systems/hitDetection';

/**
 * enemySeparation.ts — 敵人分離力/防穿透（純向量，移植 Unity 邏輯，可單元測）。
 * backlog 21976cd3。用幾何算，不走 Phaser 物理。
 */

/** 分離半徑（unit）：他敵在此距離內才互推。Unity 值。 */
export const SEPARATION_RADIUS = 0.6;
/** 分離力權重（追擊方向疊加）。Unity 值。 */
export const SEPARATION_WEIGHT = 0.8;

/** 分離半徑（像素）。 */
export const SEPARATION_RADIUS_PX = SEPARATION_RADIUS * PPU;

/**
 * 計算某敵人受其他敵人的分離力（世界像素座標；已 ×PPU 的半徑）。
 * 平方加權：越近推力越大（近距爆推、自動解堆疊）。超出 separationRadius 的不計。
 * @param selfPos 自己的位置（像素）。
 * @param others 其他敵人的位置（像素，不含自己）。
 * @param radiusPx 分離半徑（像素，預設 SEPARATION_RADIUS_PX）。
 * @returns 分離向量（未正規化的加總，方向為「遠離鄰居」）。
 */
export function calculateSeparation(
  selfPos: Vec2,
  others: readonly Vec2[],
  radiusPx: number = SEPARATION_RADIUS_PX,
): Vec2 {
  let sx = 0;
  let sy = 0;
  for (const o of others) {
    const dx = selfPos.x - o.x;
    const dy = selfPos.y - o.y;
    const dist = Math.hypot(dx, dy);
    if (dist < radiusPx && dist > 0.01) {
      const t = (radiusPx - dist) / radiusPx; // 1=貼身、0=邊緣
      const w = t * t; // 平方加權
      sx += (dx / dist) * w;
      sy += (dy / dist) * w;
    }
  }
  return { x: sx, y: sy };
}

/**
 * 追擊方向疊加分離力：finalDir = normalize(toTarget + separation × weight)。
 * @param toTarget 朝目標的方向（可未正規化）。
 * @param separation calculateSeparation 的結果。
 * @param weight 分離權重（預設 SEPARATION_WEIGHT）。
 * @returns 正規化後的最終移動方向（零向量時回 (0,0)）。
 */
export function combineWithSeparation(
  toTarget: Vec2,
  separation: Vec2,
  weight: number = SEPARATION_WEIGHT,
): Vec2 {
  // toTarget 先正規化，避免遠距時淹沒分離力。
  const tl = Math.hypot(toTarget.x, toTarget.y) || 1;
  const fx = toTarget.x / tl + separation.x * weight;
  const fy = toTarget.y / tl + separation.y * weight;
  const fl = Math.hypot(fx, fy);
  if (fl < 1e-6) return { x: 0, y: 0 };
  return { x: fx / fl, y: fy / fl };
}

/**
 * 防穿透位置修正：敵人在玩家 minDist 內 → 推到 minDist 邊緣（直接修位置，非彈飛）。
 * @param enemyPos 敵人位置（像素）。
 * @param playerPos 玩家位置（像素）。
 * @param minDistPx 最小間距（playerHitRadius + enemyBodyRadius，像素）。
 * @returns 修正後的敵人位置（未穿透則原位）。
 */
export function pushOutOfPlayer(
  enemyPos: Vec2,
  playerPos: Vec2,
  minDistPx: number,
): Vec2 {
  const dx = enemyPos.x - playerPos.x;
  const dy = enemyPos.y - playerPos.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= minDistPx) return enemyPos; // 沒穿透
  if (dist <= 0.0001) {
    return { x: playerPos.x + minDistPx, y: playerPos.y }; // 完全重疊 → 往右推
  }
  return { x: playerPos.x + (dx / dist) * minDistPx, y: playerPos.y + (dy / dist) * minDistPx };
}

/**
 * 攻擊出手面向（用戶新#2）：出手瞬間敵人該面向玩家那側。
 * dx = aimX - posX：明顯右→+1、明顯左→-1、|dx|≤閾值(玩家幾乎正上下)→保留 currentFacing（不亂轉）。
 * 純函式，給測騎測（攻擊出手 facing 朝玩家 aim 那側）。
 * @param aimX 瞄準點（玩家/目標）x。
 * @param posX 敵人 x。
 * @param currentFacing 目前面向（dx≈0 時保留）。
 * @param eps 水平判定閾值（預設 0.001）。
 */
export function attackFacing(
  aimX: number,
  posX: number,
  currentFacing: number,
  eps = 0.001,
): number {
  const dx = aimX - posX;
  if (dx > eps) return 1;
  if (dx < -eps) return -1;
  return currentFacing; // 幾乎正上下 → 保留最近有效朝向
}

/**
 * 推怪負重降速係數（用戶：敵人越多推越有阻力，Unity PlayerController）：
 * factor = max(minFactor, 1/(1 + resistance × pushedCount))。
 * 0 隻→1（不降速）；推越多→遞減；夾限 minFactor（不到 0 龜速）。菁英/grabber 不算 pushedCount（呼叫端過濾）。
 * 純函式，給測騎測。
 * @param pushedCount 真空圈內正在被推的「可推」敵人數（非菁英/非 grabber/非 dummy）。
 * @param resistance 每隻降速係數（Unity pushResistance 0.35）。
 * @param minFactor 降速下限（Unity pushMinSpeedFactor 0.3）。
 */
export function pushLoadFactor(
  pushedCount: number,
  resistance: number,
  minFactor: number,
): number {
  const n = Math.max(0, pushedCount);
  const factor = 1 / (1 + resistance * n);
  return Math.max(minFactor, factor);
}

/**
 * immovable 菁英「像牆」防穿透（用戶試玩 #1：菁英不該推玩家）：
 * 菁英移動撞到玩家時，把**菁英自己**頂回玩家外緣（擋下菁英的前進），**不推玩家**；
 * 但菁英不會被玩家「推著倒退」——修正後位置**不得比移動前(prevPos)離玩家更遠**
 * （玩家貼著菁英走，菁英停在原地當牆，不會被玩家往後擠）。
 *
 * 規則：
 *  - 無重疊 → 菁英維持現位。
 *  - 有重疊 → 目標是頂到 minDist 邊緣；但夾限「與玩家距離不超過 prevPos 當時的距離」，
 *    使菁英最多退回本幀移動前的位置（擋自己前進），不被玩家推得更遠。
 *
 * @param elitePos 菁英本幀移動後位置。
 * @param prevPos  菁英本幀移動前位置。
 * @param playerPos 玩家位置。
 * @param minDistPx 最小間距（playerHitRadius + eliteBodyRadius）。
 * @returns 修正後的菁英位置。
 */
export function blockEliteAdvance(
  elitePos: Vec2,
  prevPos: Vec2,
  playerPos: Vec2,
  minDistPx: number,
): Vec2 {
  const dx = elitePos.x - playerPos.x;
  const dy = elitePos.y - playerPos.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= minDistPx) return elitePos; // 沒重疊、菁英照走

  // 菁英移動前與玩家的距離：菁英最多退回這個距離（不被玩家推得比原本更遠）。
  const prevDist = Math.hypot(prevPos.x - playerPos.x, prevPos.y - playerPos.y);
  // 目標距離 = 頂到 minDist 邊緣，但不超過移動前距離（擋前進、不被推）。
  const targetDist = Math.min(minDistPx, Math.max(prevDist, 0));

  if (dist <= 0.0001) {
    // 完全重疊：沿「移動前→玩家」的反方向退回（沒有方向就往右）。
    const pdx = prevPos.x - playerPos.x;
    const pdy = prevPos.y - playerPos.y;
    const pl = Math.hypot(pdx, pdy);
    if (pl <= 0.0001) return { x: playerPos.x + targetDist, y: playerPos.y };
    return { x: playerPos.x + (pdx / pl) * targetDist, y: playerPos.y + (pdy / pl) * targetDist };
  }
  return {
    x: playerPos.x + (dx / dist) * targetDist,
    y: playerPos.y + (dy / dist) * targetDist,
  };
}
