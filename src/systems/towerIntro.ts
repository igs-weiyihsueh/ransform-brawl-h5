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
