/**
 * guardIntro.ts — 守護波開場「導引走位」純邏輯（用戶 #4，對照 Unity RunGuardEvent scripted move）。
 *
 * 玩家自動走到雕像四角（P1 左上/P2 右上/P3 左下/P4 右下），非瞬移、正常速度移動。
 * 抽純函式方便測試：四角座標、單步移動、到位判定。零 Phaser 依賴。
 */

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * 雕像四角定位點（螢幕/世界座標）：P0 左上、P1 右上、P2 左下、P3 右下（對照 Unity 四角）。
 * @param cx,cy 雕像中心。
 * @param offsetPx 角點離中心的水平/垂直距離。
 * @returns 依 playerIndex(0~3) 對應的定位點陣列。
 */
export function guardCornerTargets(cx: number, cy: number, offsetPx: number): Vec2[] {
  return [
    { x: cx - offsetPx, y: cy - offsetPx }, // P1 左上
    { x: cx + offsetPx, y: cy - offsetPx }, // P2 右上
    { x: cx - offsetPx, y: cy + offsetPx }, // P3 左下
    { x: cx + offsetPx, y: cy + offsetPx }, // P4 右下
  ];
}

/**
 * 導引走位單步：從 cur 朝 target 移動 speedPx×dt，回新位置與是否到位。
 * 到位判定：距離 ≤ 本步位移 或 ≤ arriveEps → snap 到 target、arrived=true（防抖動/過衝）。
 * @param cur 目前位置。
 * @param target 目標角點。
 * @param speedPx 移動速度（px/s，用玩家一般 moveSpeed×PPU）。
 * @param dt 幀時間（秒）。
 * @param arriveEps 到位容差（px，預設 2）。
 * @returns { pos, arrived, dir } dir 為單位方向（給 player.move 用；到位為 {0,0}）。
 */
export function scriptedMoveStep(
  cur: Vec2,
  target: Vec2,
  speedPx: number,
  dt: number,
  arriveEps = 2,
): { pos: Vec2; arrived: boolean; dir: Vec2 } {
  const dx = target.x - cur.x;
  const dy = target.y - cur.y;
  const dist = Math.hypot(dx, dy);
  const step = speedPx * dt;
  if (dist <= arriveEps || dist <= step || dist === 0) {
    return { pos: { x: target.x, y: target.y }, arrived: true, dir: { x: 0, y: 0 } };
  }
  const nx = dx / dist;
  const ny = dy / dist;
  return {
    pos: { x: cur.x + nx * step, y: cur.y + ny * step },
    arrived: false,
    dir: { x: nx, y: ny },
  };
}

/** 全部到位判定（所有 flag 皆 true）。逾時保底由呼叫端 snap，不在此。 */
export function allScriptedArrived(arrivedFlags: readonly boolean[]): boolean {
  return arrivedFlags.length > 0 && arrivedFlags.every((a) => a);
}
