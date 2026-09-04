/**
 * dashMath.ts — 衝刺命中的側向擊退方向計算（純函式，零依賴，可 node 測）。
 */

export interface Vec2Like {
  x: number;
  y: number;
}

/**
 * 依衝刺方向 dir 與「玩家→敵人」向量 toEnemy，算出側向擊退單位向量
 * （垂直於 dir，指向敵人所在的那一側）。
 *
 * 作法：法向量 (-dir.y, dir.x)；用 cross(dir, toEnemy) 的正負決定指左或右，
 * 使結果永遠朝敵人所在側（把敵人往它偏離衝刺線的方向再推開）。
 * dir 需為單位向量（呼叫端保證）。
 */
export function lateralKnockbackDir(dir: Vec2Like, toEnemy: Vec2Like): Vec2Like {
  const cross = dir.x * toEnemy.y - dir.y * toEnemy.x;
  const sign = cross >= 0 ? 1 : -1;
  return { x: -dir.y * sign, y: dir.x * sign };
}
