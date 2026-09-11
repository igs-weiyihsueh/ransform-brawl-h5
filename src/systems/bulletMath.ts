/**
 * bulletMath — 技能三層「彈道」純邏輯（怪物 AI 移植第 1 塊，對應鬥破規格第 7 節 BulletShooter/Bullet）。
 * 純函式、零 Phaser、offset-無關（只算方向/角度/壽命參數，世界座標由呼叫端注入）。可測交測騎。
 *
 * ★三契約遵守：
 *  1) offset-aware：本檔不碰世界常數/bounds；發射點/命中由呼叫端傳世界座標（已 offset）。
 *  2) 命中不在此：本檔只算「往哪飛/飛多遠算過期」，命中判定回既有 circleIntersectsCircle（不重寫）。
 *  3) 生命週期：壽命以「飛行距離」為主（offset-無關，比畫面 bounds 乾淨）+ 時間 + 命中數三態。
 */
import type { Vec2 } from '@/systems/hitDetection';

/** 子彈運動型別（先支援直線；tracking/curve/orbit 後續 Boss 彈幕擴充）。 */
export type BulletMovementType = 'straight' | 'tracking';

/**
 * 一顆子彈的壽命三態上限（任一達到即過期）。undefined＝不以該項限制。
 * ★distanceUnits 為主（offset-無關）：飛行累積距離 >= 此值即過期，取代「飛出畫面 bounds」。
 */
export interface BulletLifetime {
  /** 最大飛行距離（unit）。到達即過期（offset-無關，主要壽命）。 */
  distanceUnits?: number;
  /** 最大存活時間（秒）。 */
  timeSec?: number;
  /** 最大命中數（穿透幾個目標後過期）；預設 1（單體命中即消）。 */
  maxHits?: number;
}

/**
 * 依 BulletsPerShot + 展開總角度 Angle（度）算每顆子彈的發射方向（單位向量）。
 * 以 aimDir 為中心對稱展開：n=1→就是 aimDir；n>1→在 [-angle/2, +angle/2] 均分。
 * @param aimDir 中心瞄準方向（不需正規化，內部處理；零向量 fallback 朝右 {1,0}）。
 * @param count BulletsPerShot（>=1）。
 * @param spreadDeg 展開總角度（度，0=全部同向）。
 * @returns count 個單位方向向量。
 */
export function spreadDirections(aimDir: Vec2, count: number, spreadDeg: number): Vec2[] {
  const n = Math.max(1, Math.floor(count));
  const len = Math.hypot(aimDir.x, aimDir.y);
  const baseAng = len > 1e-6 ? Math.atan2(aimDir.y, aimDir.x) : 0;
  const spread = (spreadDeg * Math.PI) / 180;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    // n=1 → t=0（中心）；n>1 → t ∈ [-0.5, 0.5] 均分。
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    const ang = baseAng + t * spread;
    out.push({ x: Math.cos(ang), y: Math.sin(ang) });
  }
  return out;
}

/**
 * 追蹤子彈每幀轉向：把 curDir 朝 (target−pos) 方向轉，最多轉 rotationSpeedDegPerSec×dt（度）。
 * 超出 trackingRangeUnits 則不追（回 curDir 不變，維持直線）。純函式：回新單位方向。
 * @param curDir 現行單位方向。
 * @param pos 子彈現位置（世界 px）。
 * @param target 目標位置（世界 px）。
 * @param rotationSpeedDegPerSec 每秒最大轉向角（度）。
 * @param trackingRangeUnits 追蹤範圍（unit）；pos→target 距離超過(×ppu 由呼叫端一致單位)則不追。
 * @param dt 幀時間（秒）。
 * @param ppu 單位→px（判 trackingRange 用；預設 100）。
 */
export function trackTurn(
  curDir: Vec2,
  pos: Vec2,
  target: Vec2,
  rotationSpeedDegPerSec: number,
  trackingRangeUnits: number,
  dt: number,
  ppu = 100,
): Vec2 {
  const toX = target.x - pos.x;
  const toY = target.y - pos.y;
  const distPx = Math.hypot(toX, toY);
  if (distPx < 1e-6 || distPx > trackingRangeUnits * ppu) return normalize(curDir);
  const cur = normalize(curDir);
  const curAng = Math.atan2(cur.y, cur.x);
  const tgtAng = Math.atan2(toY, toX);
  let delta = tgtAng - curAng;
  // 正規化到 [-π, π]。
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const maxStep = (rotationSpeedDegPerSec * Math.PI) / 180 * dt;
  const step = Math.max(-maxStep, Math.min(maxStep, delta));
  const ang = curAng + step;
  return { x: Math.cos(ang), y: Math.sin(ang) };
}

/**
 * 判斷子彈是否過期（壽命三態，任一達到即 true）。純函式。
 * @param traveledUnits 已飛行距離（unit）。
 * @param elapsedSec 已存活時間（秒）。
 * @param hitCount 已命中數。
 * @param life 壽命上限設定。
 */
export function isBulletExpired(
  traveledUnits: number,
  elapsedSec: number,
  hitCount: number,
  life: BulletLifetime,
): boolean {
  if (life.distanceUnits !== undefined && traveledUnits >= life.distanceUnits) return true;
  if (life.timeSec !== undefined && elapsedSec >= life.timeSec) return true;
  const maxHits = life.maxHits ?? 1;
  if (hitCount >= maxHits) return true;
  return false;
}

/** 正規化向量（零向量 fallback 朝右 {1,0}）。 */
export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}
