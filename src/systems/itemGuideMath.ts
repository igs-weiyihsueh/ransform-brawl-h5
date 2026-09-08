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
  /** 六輪#9：箭頭「底邊」離搜索圈邊緣的額外距離(px)。錨搜索圈中心(腳部)+此 margin=底邊位置，
   *  三角往指向延伸(尾不觸身體)、又貼近搜索圈不飄遠。 */
  edgeMarginPx: 28,
  /** 七輪#9：箭頭尖端與道具的最小間距(px)。道具近時尖端頂到道具 sprite(被道具擋)→尖端退到保持此間距。 */
  itemClearancePx: 44,
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
 * 六輪#9：指引箭頭錨點（純函式，抽給測騎）。
 * 箭頭中心 = 搜索圈中心 + (cos,sin)angle × (vacuumRadius + marginPx)，落在「搜索圈邊緣附近、指向道具那側」。
 * 真因修正：舊版錨在角色身體中心 + 大 outPx → 箭頭浮身體上方離搜索圈遠；改錨搜索圈中心、貼邊，讓箭頭在圈邊指向道具。
 * @param vacuumCenter 搜索圈中心（getVacuumCenter，腳部）。
 * @param vacuumRadius 搜索圈半徑（getVacuumRadius）。
 * @param angle 指向道具的角度（guideArrowAngle）。
 * @param marginPx 圈邊外的額外距離（預設小值，貼近圈邊不推遠）。
 */
export function guideArrowAnchor(
  vacuumCenter: Vec2,
  vacuumRadius: number,
  angle: number,
  marginPx = GUIDE_ARROW.edgeMarginPx,
): Vec2 {
  const r = vacuumRadius + marginPx;
  return { x: vacuumCenter.x + Math.cos(angle) * r, y: vacuumCenter.y + Math.sin(angle) * r };
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

/** 道具來源（三輪#6 owner 依來源分配）。 */
export type ItemSource = 'initial' | 'kill' | 'random' | 'heroDrop';

/**
 * 依來源決定道具 owner（三輪#6）：
 * - 'initial'（登場初始擺放）→ 指定 ownerPlayerId（有主、標玩家色）。
 * - 'kill'（玩家擊落產生）→ 擊落的玩家 ownerPlayerId（有主、標玩家色）。
 * - 'random' / 'heroDrop'（場上隨機刷／怪掉英雄道具）→ null（無主、不標色框、不畫箭頭、不連牽引，自由撿）。
 * @param source 生成來源。
 * @param ownerPlayerId 初始/擊落來源時的擁有者（隨機/掉落來源忽略）。
 * @returns owner playerId 或 null（無主）。
 */
export function resolveItemOwner(source: ItemSource, ownerPlayerId?: number): number | null {
  if (source === 'random' || source === 'heroDrop') return null;
  return ownerPlayerId ?? null; // 初始/擊落但沒給 owner → 視為無主(不亂標)
}

/**
 * 初始變身道具生成位置（五輪#1，純函式可測）：放在玩家落點「上方一小段」（腳邊前上方），
 * 玩家一進場就在旁邊看到自己的初始道具。夾限在可走區內（不出界/不進面板）。
 * @param landing 玩家進場落點 {x,y}。
 * @param bounds 可走邊界 {minX,maxX,minY,maxY}（像素，通常 PLAYER_BOUNDS）。
 * @param offsetPx 距落點的偏移距離（px，七輪#10 用戶要離角色遠一點：90→180，明顯離開角色身邊）。
 * @returns 初始道具生成點（clamp 在界內）。
 */
export function initialItemPos(
  landing: Vec2,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  offsetPx = 180,
): Vec2 {
  // 放落點上方（y 減，H5 上為負方向）；clamp 在界內（上界不越 minY）。
  const rawY = landing.y - offsetPx;
  const y = Math.max(bounds.minY, Math.min(bounds.maxY, rawY));
  const x = Math.max(bounds.minX, Math.min(bounds.maxX, landing.x));
  return { x, y };
}
