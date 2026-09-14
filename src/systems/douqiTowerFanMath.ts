/**
 * douqiTowerFanMath — 鬥氣塔事件「四大扇形攻擊 fanBlast」純邏輯（階段 4 commit1）。
 * 無 Phaser/場景依賴，抽給測騎測。世界座標像素 {x,y}。
 *
 * ★v45 規格（海牛）：塔為圓心，每 cycleMs 發一組 count 個扇形；填滿式預警（半徑 0→radius 漸長 fillMs）→
 *   填滿瞬間發射判定：角色距塔≤radius(+玩家半徑) 且 相對塔角度落某扇形[中心±arcDeg/2]內 → 命中(傷害+定身 rootMs)。
 * ★正↔斜十字交替（group 0/1）：group0 baseDeg0（0/90/180/270）、group1 baseDeg45（45/135/225/315）。
 *   每扇形中心 = baseDeg + i×(360/count)。arcDeg 留縫（count×arcDeg < 360 → 有縫可躲），逼玩家換位。
 *
 * 本檔只管幾何/時序純邏輯（角度落扇形內？距離內？填滿進度？group 切換？扇形中心角）；
 * 視覺（畫扇形漸長）+ 命中套用（damage/root）+ 清預警由 system 端接。
 */

/** 角度正規化到 [0,360)。 */
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

/** 兩角度最小夾角（度，0~180）。 */
export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}

/**
 * 第 group 組、第 i 個扇形的中心角（度）。
 * group 偶數＝正十字(baseDeg0)、奇數＝斜十字(baseDeg=360/count/2 半格偏移)。
 * @param count 扇形數（v45=4）。
 */
export function fanCenterDeg(group: number, i: number, count: number): number {
  const step = 360 / count;
  const baseDeg = group % 2 === 0 ? 0 : step / 2; // 4 扇→正0 / 斜45
  return normalizeDeg(baseDeg + i * step);
}

/** 一組所有扇形的中心角（度）陣列。 */
export function fanGroupCenters(group: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(fanCenterDeg(group, i, count));
  return out;
}

/**
 * 角色相對塔的角度（度，0=右、90=下，對齊 Phaser Y 向下）。
 */
export function angleFromTowerDeg(tower: { x: number; y: number }, target: { x: number; y: number }): number {
  return normalizeDeg((Math.atan2(target.y - tower.y, target.x - tower.x) * 180) / Math.PI);
}

/**
 * 判定角色是否被某組扇形命中（填滿瞬間發射時呼叫）。
 *  命中條件：距塔中心 ≤ radius + targetRadius（距離內）且 相對塔角度落任一扇形 [中心 ± arcDeg/2] 內。
 * @param tower 塔中心。
 * @param target 角色中心。
 * @param targetRadius 角色判定半徑（放寬距離）。
 * @param centers 該組各扇形中心角（度）。
 * @param arcDeg 扇形弧度（度）。
 * @param radiusPx 扇形半徑（px，塔中心往外）。
 * @returns 命中的扇形 index（-1＝未命中）。
 */
export function fanHitIndex(
  tower: { x: number; y: number },
  target: { x: number; y: number },
  targetRadius: number,
  centers: readonly number[],
  arcDeg: number,
  radiusPx: number,
): number {
  const dx = target.x - tower.x;
  const dy = target.y - tower.y;
  const dist = Math.hypot(dx, dy);
  if (dist > radiusPx + targetRadius) return -1; // 距離外
  const ang = normalizeDeg((Math.atan2(dy, dx) * 180) / Math.PI);
  const half = arcDeg / 2;
  for (let i = 0; i < centers.length; i += 1) {
    if (angleDiffDeg(ang, centers[i]) <= half) return i;
  }
  return -1;
}

/** 縫隙角度（度）：count 個扇形均分後每縫寬 = (360 − count×arcDeg)/count。<=0 表無縫（全被覆蓋）。 */
export function gapDeg(count: number, arcDeg: number): number {
  return (360 - count * arcDeg) / count;
}

/** 填滿預警進度 [0,1]（elapsedMs/fillMs，夾）。1＝填滿即發射。 */
export function fillProgress(elapsedMs: number, fillMs: number): number {
  if (fillMs <= 0) return 1;
  const p = elapsedMs / fillMs;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** 當前預警半徑（px）＝radiusPx × 填滿進度（漸長預警視覺用）。 */
export function telegraphRadiusPx(elapsedMs: number, fillMs: number, radiusPx: number): number {
  return radiusPx * fillProgress(elapsedMs, fillMs);
}
