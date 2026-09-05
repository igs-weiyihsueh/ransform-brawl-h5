/**
 * grabMath — 抓人機制純邏輯（用戶試玩#4，搬自 Unity PlayerController idle/grab）。
 * idle 累加規則 + grabber 追擊位移 + 觸碰判定，抽純函式可測。純幾何/規則，不依賴 Phaser。
 */
import { PPU } from '@/config/gameConfig';
import type { Vec2 } from '@/systems/hitDetection';

/** 抓人參數（對齊 Unity PlayerController，unit×PPU 換 px）。 */
export const GRAB = {
  /** 沒消耗 Credit 滿這麼久（秒）→ 觸發抓人（Unity idleTriggerSeconds）。 */
  idleTriggerSeconds: 8,
  /** 被抓後倒數這麼久（秒）自動掙脫（Unity grabCountdownSeconds）。 */
  grabCountdownSeconds: 5,
  /** grabber 衝向玩家速度（unit/s；需 > 玩家 dash 速度才追得上；≤20 防 tunneling，決策 21976cd）。 */
  grabberSpeedUnits: 10,
} as const;

/** grabber 速度（像素/秒）。 */
export const GRABBER_SPEED_PX = GRAB.grabberSpeedUnits * PPU;

/**
 * idle 累加規則（每幀，Unity idleAccumulated）：
 * - 進場重置：justEntered → 回 0。
 * - 命中敵人扣 Credit → 歸 0（有在打怪就重置）。
 * - 戰鬥階段（場上有活敵人）→ 累加 dt。
 * - 非戰鬥階段（波次間隙/沒怪/木樁）→ 凍結（保留當前值，不加不清，跨波累積）。
 * @param current 目前累積秒數。
 * @param dt 幀時間。
 * @param inCombat 是否戰鬥階段（場上有活的、非-grabber、非-dummy 敵人）。
 * @param hitThisFrame 本幀是否命中敵人（扣 Credit）。
 * @param justEntered 本幀是否剛投幣進場。
 * @returns 更新後的累積秒數。
 */
export function accumulateIdle(
  current: number,
  dt: number,
  inCombat: boolean,
  hitThisFrame: boolean,
  justEntered: boolean,
): number {
  if (justEntered) return 0; // 進場重置
  if (hitThisFrame) return 0; // 打到怪重置
  if (inCombat) return current + dt; // 戰鬥累加
  return current; // 非戰鬥凍結（保留）
}

/** idle 是否已達觸發抓人門檻。 */
export function shouldTriggerGrab(idleAccumulated: number): boolean {
  return idleAccumulated >= GRAB.idleTriggerSeconds;
}

/**
 * grabber 追擊位移：朝玩家方向前進 grabberSpeed×dt（不超過剩餘距離，避免衝過頭 tunneling）。
 * @param grabberPos grabber 位置。
 * @param playerPos 玩家位置。
 * @param dt 幀時間。
 * @param speedPx grabber 速度（像素/秒，預設 GRABBER_SPEED_PX）。
 * @returns grabber 新位置。
 */
export function grabberChaseStep(
  grabberPos: Vec2,
  playerPos: Vec2,
  dt: number,
  speedPx: number = GRABBER_SPEED_PX,
): Vec2 {
  const dx = playerPos.x - grabberPos.x;
  const dy = playerPos.y - grabberPos.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 1e-6) return { x: grabberPos.x, y: grabberPos.y };
  const step = Math.min(speedPx * dt, dist); // 不超過剩餘距離（防 tunneling）
  return { x: grabberPos.x + (dx / dist) * step, y: grabberPos.y + (dy / dist) * step };
}

/**
 * grabber 是否觸碰到玩家（中心距 <= grabberRadius + playerRadius）。
 * @param grabberPos grabber 中心。
 * @param playerPos 玩家中心。
 * @param touchDistPx 觸碰距離（grabber 半徑 + 玩家半徑，像素）。
 */
export function grabberTouchesPlayer(
  grabberPos: Vec2,
  playerPos: Vec2,
  touchDistPx: number,
): boolean {
  return Math.hypot(playerPos.x - grabberPos.x, playerPos.y - grabberPos.y) <= touchDistPx;
}

/**
 * 被抓倒數（每幀）：remaining -= dt；<=0 表示倒數到（自動掙脫）。
 * @returns { remaining, autoEscape }。
 */
export function tickGrabCountdown(remaining: number, dt: number): { remaining: number; autoEscape: boolean } {
  const next = remaining - dt;
  return { remaining: Math.max(0, next), autoEscape: next <= 0 };
}
