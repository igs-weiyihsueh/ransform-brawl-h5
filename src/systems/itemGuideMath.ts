/**
 * itemGuideMath.ts — 道具指引/牽引線純邏輯（用戶 #7，搬 Unity TransformItem guideArrow + PlayerController TetherLine）。
 * 抽純函式方便測試（壞版必紅）。零 Phaser 依賴。
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** 指引箭頭參數（對照 Unity guideArrow）。 */
export const GUIDE_ARROW = {
  /** 顯示時長（秒，Unity arrowShowDuration）。 */
  showDurationSec: 3,
  /** 淡出時長（秒，Unity fadeDuration）。 */
  fadeDurationSec: 0.5,
  /** owner 到道具距離 < 此（unit）→ 隱藏（Unity arrowHideDistance）。 */
  hideDistanceUnits: 1.5,
  /** 脈動幅度 / 速度（Unity pulseScale / pulseSpeed）。 */
  pulseScale: 0.2,
  pulseSpeed: 4,
  /** 基礎大小 / 黑描邊放大 / 腳邊偏移（Unity baseScale/outlineScale/footOffset）。 */
  baseScale: 0.5,
  outlineScale: 1.15,
  footOffsetYUnits: -0.3,
} as const;

/** 牽引線參數（對照 Unity TetherLine）。 */
export const TETHER = {
  /** 玩家色線半透明（Unity tetherAlpha）。 */
  alpha: 0.4,
  /** 線寬（px）。 */
  widthPx: 4,
} as const;

/**
 * 指引箭頭朝向（弧度）：從 owner 指向道具（Unity CreateGuideArrow 方向）。
 * @param ownerPos owner 角色位置。
 * @param itemPos 專屬道具位置。
 */
export function guideArrowAngle(ownerPos: Vec2, itemPos: Vec2): number {
  return Math.atan2(itemPos.y - ownerPos.y, itemPos.x - ownerPos.x);
}

/**
 * 是否隱藏指引箭頭（owner 已靠近道具，Unity arrowHideDistance）。
 * @param distUnits owner 到道具距離（unit）。
 * @param hideDistanceUnits 隱藏門檻（預設 GUIDE_ARROW.hideDistanceUnits）。
 */
export function shouldHideArrow(
  distUnits: number,
  hideDistanceUnits = GUIDE_ARROW.hideDistanceUnits,
): boolean {
  return distUnits < hideDistanceUnits;
}

/**
 * 排隊制：同 owner 的專屬道具一次只顯一個箭頭（依掉落先後 FIFO）。
 * 從該 owner 的道具佇列挑「當前該顯的」= 第一個未撿的（先掉落的先指）。
 * @param queue 該 owner 的專屬道具 id 佇列（掉落先後）。
 * @param isPicked 判斷某 id 是否已撿（已撿的跳過）。
 * @returns 當前該顯箭頭的道具 id；佇列空/全撿 → null。
 */
export function nextGuideTarget(
  queue: readonly number[],
  isPicked: (id: number) => boolean,
): number | null {
  for (const id of queue) {
    if (!isPicked(id)) return id;
  }
  return null;
}

/**
 * 牽引線終點：從 anchor 連到角色真空圈邊緣「靠 anchor 那側」（不穿進圈到腳底，Unity 終點停真空圈邊緣）。
 * = 角色圓心往 anchor 方向退 radius。
 * @param anchor 面板 TetherAnchor 位置。
 * @param charCenter 角色真空圈圓心。
 * @param radiusPx 真空圈半徑。
 */
export function tetherEndPoint(anchor: Vec2, charCenter: Vec2, radiusPx: number): Vec2 {
  const dx = anchor.x - charCenter.x;
  const dy = anchor.y - charCenter.y;
  const d = Math.hypot(dx, dy);
  if (d <= radiusPx || d === 0) return { x: charCenter.x, y: charCenter.y }; // 太近直接圓心
  return { x: charCenter.x + (dx / d) * radiusPx, y: charCenter.y + (dy / d) * radiusPx };
}
