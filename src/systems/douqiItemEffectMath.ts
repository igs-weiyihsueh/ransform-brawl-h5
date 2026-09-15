/**
 * douqiItemEffectMath — 鬥氣道具效果純函式（階段2a）。零 Phaser，交測騎。
 *
 * H 補能量 clamp、A 旋風 DOT 跳數、B 雷擊環繞角度分佈/落點座標。
 */

/** H 補能量：cur + add，clamp 到 cap（不超）。回新能量。 */
export function healClampEnergy(cur: number, add: number, cap: number): number {
  return Math.min(cap, Math.max(0, cur + add));
}

/** A 旋風 DOT 總跳數：一開始一跳 + 每 tickMs 一跳直到 duration。time.addEvent repeat=count-1。 */
export function dotTickCount(durationMs: number, tickMs: number): number {
  if (tickMs <= 0) return 0;
  return Math.floor(durationMs / tickMs); // v45：3000/200=15 跳
}

/**
 * B 雷擊環繞角度（度）：從 startDeg 起、順時針等分 count 道（間隔 360/count）。
 * @returns 角度陣列（度，長度 count）。
 */
export function lightningStrikeAngles(count: number, startDeg = -90): number[] {
  if (count <= 0) return [];
  const step = 360 / count;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(startDeg + i * step); // 順時針（+）
  return out;
}

/** 極座標落點：中心 (cx,cy)、半徑 r、角度 deg → 世界座標。 */
export function orbitPoint(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r };
}

/** 點在圓內（AOE 命中判定，含目標半徑）：距離 ≤ radius + targetRadius。 */
export function circleAoeHit(cx: number, cy: number, tx: number, ty: number, radius: number, targetRadius: number): boolean {
  const dx = tx - cx;
  const dy = ty - cy;
  const rr = radius + targetRadius;
  return dx * dx + dy * dy <= rr * rr;
}
