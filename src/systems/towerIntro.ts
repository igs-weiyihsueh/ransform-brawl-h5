/**
 * towerIntro.ts — 魔尖塔波開場「玩家聚集中央」純邏輯（用戶：塔波照搬守護波，走位目標改中央/塔陣中心）。
 *
 * 平移守護波 guardIntro 的 scriptedMoveStep/allScriptedArrived（那兩支通用、直接沿用），
 * 只差走位目標：守護波是雕像四角（guardCornerTargets），塔波改成「玩家往中央聚集」。
 * 抽純函式方便測試：中央聚集點座標。零 Phaser 依賴。
 */

import type { Vec2 } from '@/systems/guardIntro';

/**
 * 玩家聚集中央定位點：以 (cx,cy) 為中心、gatherOffsetPx 為半徑，把 N 名玩家均勻排在中心周圍
 * 一小圈（不重疊、聚攏感），朝正上方起始（-90°）順時針分布。單人→就站中心。
 *
 * @param cx,cy 聚集中心（畫面/塔陣中央）。
 * @param count 玩家數（1~4）。
 * @param gatherOffsetPx 玩家離中心的半徑（越小越聚攏；單人時忽略＝站正中心）。
 * @returns 依 playerIndex(0~N-1) 對應的聚集點陣列。
 */
export function towerGatherTargets(cx: number, cy: number, count: number, gatherOffsetPx: number): Vec2[] {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return [{ x: cx, y: cy }]; // 單人站正中心
  const r = Math.max(0, gatherOffsetPx);
  const out: Vec2[] = [];
  // 從正上方(-90°)起、順時針均分一圈，聚攏在中心周圍。
  for (let i = 0; i < n; i += 1) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    out.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r });
  }
  return out;
}

/**
 * 聚焦聚光燈打在「塔」上（Bug2 修：不再打玩家聚集點）：算塔位包圍盒中心 + 框住整組塔的半徑。
 * - 中心＝(minX+maxX)/2, (minY+maxY)/2（單塔＝該塔位）。
 * - 半徑＝max(半對角線 + marginPx, minRadiusPx)：半對角線框住整組塔外接圓、加邊距、且不小於 preset spotlight 半徑。
 *
 * @param towers 塔位（場景座標；至少 1 座）。
 * @param minRadiusPx preset spotlightRadiusPx（半徑下限）。
 * @param marginPx 塔外圈到亮圈邊的邊距（預設 120，讓塔完整落在亮圈內不貼邊）。
 * @returns { center, radiusPx }；towers 空 → center 原點、radius=minRadiusPx（保底不炸）。
 */
export function towerSpotlightTarget(
  towers: readonly Vec2[],
  minRadiusPx: number,
  marginPx = 120,
): { center: Vec2; radiusPx: number } {
  if (towers.length === 0) return { center: { x: 0, y: 0 }, radiusPx: Math.max(0, minRadiusPx) };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of towers) {
    if (t.x < minX) minX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.x > maxX) maxX = t.x;
    if (t.y > maxY) maxY = t.y;
  }
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const halfDiagonal = Math.hypot(maxX - minX, maxY - minY) / 2; // 包圍盒半對角線＝外接圓半徑
  const radiusPx = Math.max(halfDiagonal + Math.max(0, marginPx), Math.max(0, minRadiusPx));
  return { center, radiusPx };
}
