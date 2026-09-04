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

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
