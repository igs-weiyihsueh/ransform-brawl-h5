/**
 * douqiItemEffectMath — 鬥氣道具效果純函式（階段2a/2b）。零 Phaser，交測騎。
 *
 * A 旋風 DOT 跳數、B 雷擊環繞角度/落點、C 居合直線取樣點、圓形 AOE 命中。
 */

/** A 旋風 DOT 總跳數：一開始一跳 + 每 tickMs 一跳直到 duration。time.addEvent repeat=count-1。 */
export function dotTickCount(durationMs: number, tickMs: number): number {
  if (tickMs <= 0) return 0;
  return Math.floor(durationMs / tickMs); // v45：3000/200=15 跳
}

/**
 * ★C 居合直線取樣點（從 from 到 to 每 stepPx 一個取樣點，含起訖）。沿路徑各點做 circleAoeHit 命中＝膠囊近似。
 * @returns 取樣點陣列（世界座標）。
 */
export function pathSamplePoints(x1: number, y1: number, x2: number, y2: number, stepPx: number): Array<{ x: number; y: number }> {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const pts: Array<{ x: number; y: number }> = [];
  if (len < 1e-6 || stepPx <= 0) { pts.push({ x: x1, y: y1 }); return pts; }
  const n = Math.max(1, Math.ceil(len / stepPx));
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    pts.push({ x: x1 + dx * t, y: y1 + dy * t });
  }
  return pts;
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
