/**
 * formationMath — 整隊移動純邏輯（怪物 AI 移植第 2 塊，鬥破規格第 6 節）。
 * 零 Phaser、offset-無關（只算相對位移/速度；世界座標/offset 由呼叫端注入）。交測騎。
 *
 * 職責：①成員入位/跟節點走的每幀位移（速度補償+最大速度夾）②整隊錨點沿 facing/spline 推進。
 * 座標「形狀」在 formationConfig.computeFormationSlots；本檔只管「怎麼移動到/跟隨節點」。
 */
import type { Vec2 } from '@/systems/hitDetection';

/**
 * 成員朝目標節點的每幀位移（速度補償：離遠→正常速趨近、快到→減速不過衝；夾 maxSpeed）。
 * @param cur 成員現位置（世界 px）。
 * @param node 目標節點（世界 px）。
 * @param baseSpeedPx 基礎速度（px/s）。
 * @param dt 幀時間（秒）。
 * @param maxSpeedPx 最大速度（px/s；入位追節點時上限，防瞬移）。預設 baseSpeedPx×2。
 * @returns 本幀新位置（世界 px）。到節點內 <1px 直接吸附節點（不抖）。
 */
export function stepTowardNode(
  cur: Vec2,
  node: Vec2,
  baseSpeedPx: number,
  dt: number,
  maxSpeedPx?: number,
): Vec2 {
  const dx = node.x - cur.x;
  const dy = node.y - cur.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return { x: node.x, y: node.y }; // 吸附，不抖
  const maxPx = maxSpeedPx ?? baseSpeedPx * 2;
  // 速度補償：需要移動 dist；本幀最多 走 min(baseSpeed×dt 補償係數, maxSpeed×dt)，但不超過 dist（不過衝）。
  //   離遠用 base、離近(dist < base×dt)直接到節點；追趕落後可到 maxSpeed。
  const desiredPx = Math.min(dist, Math.max(baseSpeedPx, Math.min(maxPx, dist / Math.max(dt, 1e-3))) * dt);
  const ux = dx / dist;
  const uy = dy / dist;
  return { x: cur.x + ux * desiredPx, y: cur.y + uy * desiredPx };
}

/**
 * 整隊錨點沿 facing 方向推進（無 spline 時的直線整隊移動）。
 * @param anchor 現錨點（世界 px）。
 * @param facingDeg 推進方向（度）。
 * @param speedPx 整隊速度（px/s）。
 * @param dt 幀時間（秒）。
 * @returns 新錨點。
 */
export function advanceAnchor(anchor: Vec2, facingDeg: number, speedPx: number, dt: number): Vec2 {
  const rad = (facingDeg * Math.PI) / 180;
  return { x: anchor.x + Math.cos(rad) * speedPx * dt, y: anchor.y + Math.sin(rad) * speedPx * dt };
}

/**
 * Catmull-Rom spline 取點（整隊沿曲線推進用）：由控制點陣列 + 參數 t(0..1) 回曲線上位置。
 * 純函式；點數 <2 回首點/空回原點。t 夾 [0,1]。
 * @param points 控制點（世界 px，>=2）。
 * @param t 進度 0..1。
 */
export function splinePoint(points: readonly Vec2[], t: number): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { x: points[0].x, y: points[0].y };
  const tt = Math.max(0, Math.min(1, t));
  const seg = tt * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(seg));
  const localT = seg - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(points.length - 1, i + 2)];
  return {
    x: catmullRom(p0.x, p1.x, p2.x, p3.x, localT),
    y: catmullRom(p0.y, p1.y, p2.y, p3.y, localT),
  };
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** 全員是否都到節點附近（整隊入位完成判定）：所有成員 dist<threshold。 */
export function allMembersInPlace(
  members: readonly { cur: Vec2; node: Vec2 }[],
  thresholdPx: number,
): boolean {
  return members.every((m) => Math.hypot(m.node.x - m.cur.x, m.node.y - m.cur.y) < thresholdPx);
}
