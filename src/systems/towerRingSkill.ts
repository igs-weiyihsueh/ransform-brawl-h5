/**
 * towerRingSkill.ts — 魔尖塔「環狀擴散技」純邏輯（征騎，2 新事件階段 B）。
 *
 * 尖塔週期放環狀技：每 intervalSec 生一個新環，環半徑隨時間以 expandPxPerRing（px/秒）向外擴大，
 * 像漣漪/衝擊波。★只有「環那一圈（環厚度帶）」有命中判定，中心是空的（annulus，不是實心圓）。
 * 命中玩家 → 扣 energyCost 段能量（預設 2）。
 *
 * 純函式/純資料、零 Phaser、零遊戲 runtime 依賴（可測）。世界座標用像素 {x,y}。
 * 特效（fx_tower_ring 單張放大淡出）由 EffectSystem 接，本檔只管「何時生環/環多大/環有沒有打到玩家」時序邏輯。
 */

import type { Vec2 } from '@/systems/hitDetection';

/** 一個進行中的環（由某尖塔某次放技生成）。 */
export interface ActiveRing {
  /** 環中心（＝尖塔位置，生成時鎖定，之後不隨尖塔移動——尖塔本來也不動）。 */
  center: Vec2;
  /** 目前環半徑（px），每幀 += expandPxPerRing×dt。 */
  radius: number;
  /** 這個環已存活秒數（到 maxLifeSec 移除）。 */
  age: number;
  /** 命中判定用：環圈厚度帶半寬（px）。環的有效判定＝[radius-halfThickness, radius+halfThickness] 環帶。 */
  halfThickness: number;
  /** 本環是否已扣過該玩家能量（一個環對同一玩家只扣一次，避免每幀連扣）。key=playerId。 */
  hitPlayers: Set<number>;
}

/** 環狀技執行期參數（由 RingSkillParams + 預設補齊）。 */
export interface TowerRingRuntimeParams {
  /** 每環出現間隔秒。 */
  intervalSec: number;
  /** 每環擴大速度（px/秒）。 */
  expandPxPerSec: number;
  /** 命中扣能量段數。 */
  energyCost: number;
  /** 環圈判定厚度帶半寬（px）。 */
  halfThickness: number;
  /** 環最大半徑（px，到此移除；預設涵蓋場地對角）。 */
  maxRadiusPx: number;
}

export const DEFAULT_TOWER_RING_PARAMS: TowerRingRuntimeParams = {
  intervalSec: 2,
  expandPxPerSec: 160,
  energyCost: 2,
  halfThickness: 18,
  maxRadiusPx: 1400,
};

/**
 * 由 levelSchema.RingSkillParams（intervalSec/expandPxPerRing/energyCost）＋預設補齊成執行期參數。
 * ★expandPxPerRing 語意＝「每環擴大量」：解讀為環每秒擴大的像素速度（px/秒）。0-nullish 合法（0=不擴大）。
 */
export function resolveTowerRingParams(
  ring: { intervalSec?: number; expandPxPerRing?: number; energyCost?: number } | null | undefined,
  overrides: Partial<TowerRingRuntimeParams> = {},
): TowerRingRuntimeParams {
  const d = DEFAULT_TOWER_RING_PARAMS;
  return {
    intervalSec: ring?.intervalSec != null && ring.intervalSec > 0 ? ring.intervalSec : d.intervalSec,
    expandPxPerSec: ring?.expandPxPerRing != null && ring.expandPxPerRing >= 0 ? ring.expandPxPerRing : d.expandPxPerSec,
    energyCost: ring?.energyCost != null && ring.energyCost >= 0 ? ring.energyCost : d.energyCost,
    halfThickness: overrides.halfThickness ?? d.halfThickness,
    maxRadiusPx: overrides.maxRadiusPx ?? d.maxRadiusPx,
  };
}

/** 生一個新環（半徑從 0 開始）。 */
export function spawnRing(center: Vec2, params: TowerRingRuntimeParams): ActiveRing {
  return { center: { x: center.x, y: center.y }, radius: 0, age: 0, halfThickness: params.halfThickness, hitPlayers: new Set() };
}

/**
 * 推進一個環一幀：半徑擴大、age 累加。回傳是否仍存活（false＝超過 maxRadius 該移除）。
 */
export function advanceRing(ring: ActiveRing, dt: number, params: TowerRingRuntimeParams): boolean {
  ring.radius += params.expandPxPerSec * dt;
  ring.age += dt;
  return ring.radius <= params.maxRadiusPx;
}

/**
 * ★環圈命中判定（annulus，中心空）：玩家圓是否碰到「環那一圈厚度帶」。
 * 玩家中心到環心距離 d，玩家半徑 r：碰到環帶 ⇔ 環帶內外緣 [radius-half, radius+half] 與 [d-r, d+r] 有交集。
 * 即 |d - radius| <= half + r。d < radius-half-r（在環內側空心）→ 不命中；d > radius+half+r（環還沒擴到）→ 不命中。
 */
export function ringHitsPlayer(
  ring: ActiveRing,
  playerCenter: Vec2,
  playerRadius: number,
): boolean {
  const dx = playerCenter.x - ring.center.x;
  const dy = playerCenter.y - ring.center.y;
  const d = Math.hypot(dx, dy);
  return Math.abs(d - ring.radius) <= ring.halfThickness + playerRadius;
}

/** 計時器狀態：判斷本幀是否該生新環（達 intervalSec）。回傳 {fire, timer}（呼叫端保存 timer）。 */
export function tickRingTimer(timer: number, dt: number, intervalSec: number): { fire: boolean; timer: number } {
  const t = timer + dt;
  if (t >= intervalSec) return { fire: true, timer: t - intervalSec };
  return { fire: false, timer: t };
}
