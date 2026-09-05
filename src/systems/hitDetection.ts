import type { AttackData } from '@/systems/AttackData';
import { PPU } from '@/config/gameConfig';

/**
 * hitDetection — 可重用的命中判定（純幾何）。
 *
 * 設計理由：攻擊 hitbox 是「瞬間、方向性、由 AttackData 驅動」的判定，
 * 用幾何 overlap（OBB 對圓）能精準對齊 Unity 的 Physics2D.OverlapBox 語意、
 * 可決定性、易單元測試，且不必把邏輯綁進 Phaser 物理系統。
 * 移動與擊退仍走 Arcade physics body；判定與物理分離，職責清楚。
 *
 * 座標系：像素（已 × PPU）。所有輸入均為世界像素座標。
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** 有向矩形（Oriented Bounding Box）。中心 + 半長/半寬 + 旋轉(弧度)。 */
export interface OBB {
  center: Vec2;
  halfLength: number; // 沿面向(local x)的半長
  halfWidth: number; // 垂直面向(local y)的半寬
  rotation: number; // 弧度，local x 相對世界 x 的夾角
}

/** 命中目標介面：任何能被判定命中的東西都提供中心與碰撞半徑。 */
export interface Hittable {
  getHitCenter(): Vec2;
  getHitRadius(): number;
}

/**
 * 由 AttackData + 攻擊者位置 + 面向 + 角色 scale，算出世界像素座標的判定 OBB。
 * @param facing 面向：+1 面右、-1 面左。
 */
export function buildAttackOBB(
  attack: AttackData,
  attackerPos: Vec2,
  facing: number,
  scale: number,
): OBB {
  const dir = facing >= 0 ? 1 : -1;
  // 中心偏移（unit → 像素，且 × scale）。offsetX 沿面向；offsetY 為垂直。
  const cx = attackerPos.x + dir * attack.offsetX * scale * PPU;
  const cy = attackerPos.y + attack.offsetY * scale * PPU;

  const length = (attack.length ?? 0) * scale * PPU;
  const width = (attack.width ?? 0) * scale * PPU;

  return {
    center: { x: cx, y: cy },
    halfLength: length / 2,
    halfWidth: width / 2,
    // 面左時矩形旋轉 180°，長邊仍沿水平；對稱矩形其實不影響，但保留語意正確。
    rotation: dir === 1 ? 0 : Math.PI,
  };
}

/**
 * OBB 對圓的重疊判定。
 * 作法：把圓心轉到 OBB 的 local 空間，clamp 到矩形範圍取最近點，比較距離與半徑。
 */
export function obbIntersectsCircle(
  obb: OBB,
  circleCenter: Vec2,
  circleRadius: number,
): boolean {
  const dx = circleCenter.x - obb.center.x;
  const dy = circleCenter.y - obb.center.y;

  const cos = Math.cos(-obb.rotation);
  const sin = Math.sin(-obb.rotation);

  // 旋轉到 local 空間（local x = 面向, local y = 垂直）。
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  // clamp 到矩形範圍，取矩形上離圓心最近的點。
  const closestX = clamp(localX, -obb.halfLength, obb.halfLength);
  const closestY = clamp(localY, -obb.halfWidth, obb.halfWidth);

  const distX = localX - closestX;
  const distY = localY - closestY;

  return distX * distX + distY * distY <= circleRadius * circleRadius;
}

/**
 * 用 OBB 對一組 Hittable 做命中查詢，回傳所有命中的目標。
 * 一次攻擊可命中多個目標（對齊規格）。
 */
export function queryHits<T extends Hittable>(obb: OBB, targets: readonly T[]): T[] {
  const hits: T[] = [];
  for (const t of targets) {
    const c = t.getHitCenter();
    if (obbIntersectsCircle(obb, c, t.getHitRadius())) {
      hits.push(t);
    }
  }
  return hits;
}

/** 攻擊判定圓（世界像素座標）。 */
export interface AttackCircle {
  center: Vec2;
  radius: number;
}

/**
 * 由 AttackData（shapeType='circle'）+ 攻擊者位置 + 面向 + 角色 scale，
 * 算出世界像素座標的判定圓。offsetX 沿面向、offsetY 垂直，皆 × scale × PPU。
 */
export function buildAttackCircle(
  attack: AttackData,
  attackerPos: Vec2,
  facing: number,
  scale: number,
): AttackCircle {
  const dir = facing >= 0 ? 1 : -1;
  const cx = attackerPos.x + dir * attack.offsetX * scale * PPU;
  const cy = attackerPos.y + attack.offsetY * scale * PPU;
  return {
    center: { x: cx, y: cy },
    radius: (attack.radius ?? 0) * scale * PPU,
  };
}

/** 圓對圓重疊判定。 */
export function circleIntersectsCircle(
  a: AttackCircle,
  circleCenter: Vec2,
  circleRadius: number,
): boolean {
  const dx = circleCenter.x - a.center.x;
  const dy = circleCenter.y - a.center.y;
  const r = a.radius + circleRadius;
  return dx * dx + dy * dy <= r * r;
}

/** 用判定圓對一組 Hittable 做命中查詢，回傳所有命中的目標。 */
export function queryHitsCircle<T extends Hittable>(
  circle: AttackCircle,
  targets: readonly T[],
): T[] {
  const hits: T[] = [];
  for (const t of targets) {
    if (circleIntersectsCircle(circle, t.getHitCenter(), t.getHitRadius())) {
      hits.push(t);
    }
  }
  return hits;
}

/** 攻擊判定扇形（世界像素座標）。apex 在 center，朝 facing 方向張開 angle 度、半徑 radius。 */
export interface AttackFan {
  center: Vec2;
  radius: number;
  /** 面向方向（+1 右、-1 左），決定扇形朝向。 */
  facing: number;
  /** 半張角（弧度）：命中需與面向夾角 <= 此值。 */
  halfAngleRad: number;
}

/**
 * 由 AttackData（shapeType='fan'）算出世界像素扇形。
 * 命中條件：目標在半徑內 且 與面向水平方向的夾角 <= angle/2。
 */
export function buildAttackFan(
  attack: AttackData,
  attackerPos: Vec2,
  facing: number,
  scale: number,
): AttackFan {
  const dir = facing >= 0 ? 1 : -1;
  const cx = attackerPos.x + dir * attack.offsetX * scale * PPU;
  const cy = attackerPos.y + attack.offsetY * scale * PPU;
  return {
    center: { x: cx, y: cy },
    radius: (attack.radius ?? 0) * scale * PPU,
    facing: dir,
    halfAngleRad: (((attack.angle ?? 0) / 2) * Math.PI) / 180,
  };
}

/**
 * 扇形對圓的命中判定。
 * 條件：圓心到扇心距離（減去圓半徑後）在扇半徑內，且圓心方向與面向夾角 <= 半張角。
 * 為讓貼很近的目標仍算中，距離為 0 時視為命中。
 */
export function fanIntersectsCircle(
  fan: AttackFan,
  circleCenter: Vec2,
  circleRadius: number,
): boolean {
  const dx = circleCenter.x - fan.center.x;
  const dy = circleCenter.y - fan.center.y;
  const dist = Math.hypot(dx, dy);

  // 半徑檢查：把目標碰撞半徑納入（近似），距離超過扇半徑+目標半徑則不中。
  if (dist > fan.radius + circleRadius) return false;
  if (dist <= 1e-6) return true; // 幾乎同點 → 中

  // 角度檢查：目標方向與面向（+x*dir）的夾角。
  // 面向向量為 (fan.facing, 0)；用點積求夾角。
  const forwardX = fan.facing;
  const cosTheta = (dx * forwardX) / dist; // forward 為單位水平向量，y=0
  const clamped = cosTheta < -1 ? -1 : cosTheta > 1 ? 1 : cosTheta;
  const theta = Math.acos(clamped);
  return theta <= fan.halfAngleRad;
}

/** 用扇形對一組 Hittable 做命中查詢。 */
export function queryHitsFan<T extends Hittable>(
  fan: AttackFan,
  targets: readonly T[],
): T[] {
  const hits: T[] = [];
  for (const t of targets) {
    if (fanIntersectsCircle(fan, t.getHitCenter(), t.getHitRadius())) {
      hits.push(t);
    }
  }
  return hits;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * 揮前攻擊形狀確認（用戶試玩#2 敵人空揮，對齊 Unity IsPlayerInAttackShape）：
 * 用**跟實際敵人攻擊命中判定同一套形狀/基準**（buildAttackOBB/Circle/Fan + 對應 intersect），
 * 預判玩家是否真的在攻擊形狀內——是才揮、否則不揮（不對空氣揮）。
 *
 * 與實際命中同基準（同 builder、同 offset×scale×PPU、同 intersect），避免「兩套判定」誤差。
 * @param attack 敵人的 AttackData（enemy-editor 編的形狀：rectangle/circle/fan + offset/radius/angle/width/length）。
 * @param enemyPos 敵人位置（getHitCenter）。
 * @param facing 敵人面向（+1/-1）。
 * @param scale 角色 scale（perCharScale，菁英放大）。
 * @param playerPos 玩家位置。
 * @param playerRadius 玩家碰撞半徑（像素）——與命中查詢一致，把玩家當圓判定。
 * @returns 玩家是否在攻擊形狀內（true=可揮）。
 */
export function isPlayerInEnemyAttackShape(
  attack: AttackData,
  enemyPos: Vec2,
  facing: number,
  scale: number,
  playerPos: Vec2,
  playerRadius: number,
): boolean {
  if (attack.shapeType === 'circle') {
    const circle = buildAttackCircle(attack, enemyPos, facing, scale);
    return circleIntersectsCircle(circle, playerPos, playerRadius);
  }
  if (attack.shapeType === 'fan') {
    const fan = buildAttackFan(attack, enemyPos, facing, scale);
    return fanIntersectsCircle(fan, playerPos, playerRadius);
  }
  const obb = buildAttackOBB(attack, enemyPos, facing, scale);
  return obbIntersectsCircle(obb, playerPos, playerRadius);
}
