/**
 * mapConfig — 地圖邊界（對應 Unity MapConfig.cs singleton「統一管理邊界」）。
 *
 * Unity 邊界為中心原點世界單位矩形 boundsMinX=-8/Max=8、minY=-4/Max=4（16×8 unit）。
 * H5 座標為螢幕左上原點（畫面 1920×1080、中心 960,540），unit×PPU(100) = px：
 *   X: 960 ± 8×100 = 160 ~ 1760
 *   Y: 540 ± 4×100 = 140 ~ 940
 * 即場地是畫面正中央 1600×800 的矩形、四周留邊。玩家/敵人/生成共用這一份。
 */
import { GAME_HEIGHT, GAME_WIDTH, PPU } from '@/config/gameConfig';
import { FOOT_GLOW } from '@/config/playerConfig';
import { getResolvedMapBoundsUnits } from '@/config/mapBoundsSchema';

/** Unity 世界單位邊界（中心原點）打包預設。改數值請對照 Unity MapConfig；地圖邊界編輯器可 override。 */
export const MAP_BOUNDS_UNITS = {
  minX: -8,
  maxX: 8,
  minY: -4,
  maxY: 4,
} as const;

/**
 * 生效的地圖邊界（unit）：localStorage override 優先，無則打包 MAP_BOUNDS_UNITS（第十五輪 地圖邊界編輯器）。
 * 模組初始化讀一次（cache）；「套用→重開遊戲生效」。★座標可負可 0（resolveMapBounds 用 ??）。
 */
const RESOLVED_MAP_BOUNDS_UNITS = getResolvedMapBoundsUnits(MAP_BOUNDS_UNITS);

/** H5 螢幕像素邊界（左上原點）：由 Unity 中心原點邊界換算（用生效的 resolved units）。 */
export const MAP_BOUNDS = {
  minX: GAME_WIDTH / 2 + RESOLVED_MAP_BOUNDS_UNITS.minX * PPU, // 預設 160
  maxX: GAME_WIDTH / 2 + RESOLVED_MAP_BOUNDS_UNITS.maxX * PPU, // 預設 1760
  minY: GAME_HEIGHT / 2 + RESOLVED_MAP_BOUNDS_UNITS.minY * PPU, // 預設 140
  maxY: GAME_HEIGHT / 2 + RESOLVED_MAP_BOUNDS_UNITS.maxY * PPU, // 預設 940
} as const;

/**
 * 下方面板頂緣 Y（螢幕座標）：BottomPanel y = GAME_HEIGHT - bottomOffset(16) - slotHeight(120) = 944。
 * 玩家可走區域下界不得越過此線（否則角色會穿進下方面板）。此處對齊 uiLayoutSchema 預設值。
 */
export const PANEL_TOP_Y = GAME_HEIGHT - 16 - 120; // 944

/**
 * 遊玩可走區下界 Y（第四輪#1，純函式可測）：面板上緣往上留 bottomMargin。
 * = panelTopY − bottomMargin。讓角色「腳底（中心+bottomMargin）」剛好停在面板頂、不進面板。
 * @param panelTopY 下方面板上緣 Y（螢幕座標）。
 * @param bottomMargin 角色中心到腳底/底邊的距離（px）。
 */
export function playAreaMaxY(panelTopY: number, bottomMargin: number): number {
  return panelTopY - bottomMargin;
}

/**
 * 玩家遊玩可走邊界：X/上界同 MAP_BOUNDS；**下界收到面板上緣之上**（避免角色腳底穿進下方面板）。
 * 第四輪#1 修：下邊距改用「腳底偏移 FOOT_GLOW.offsetYPx」（原 hitRadius=60 < 腳底 75.6 → 腳底穿面板 16px）。
 * 別寫死：margin 從 FOOT_GLOW.offsetYPx 算、下界從 PANEL_TOP_Y 算（#5 foot.offsetY 或面板高變動→自動跟）。
 */
const PLAYER_BOTTOM_MARGIN = FOOT_GLOW.offsetYPx; // ≈75.6：角色中心到腳底
export const PLAYER_BOUNDS = {
  minX: MAP_BOUNDS.minX,
  maxX: MAP_BOUNDS.maxX,
  minY: MAP_BOUNDS.minY,
  maxY: Math.min(MAP_BOUNDS.maxY, playAreaMaxY(PANEL_TOP_Y, PLAYER_BOTTOM_MARGIN)), // min(940, 944-75.6≈868)
} as const;

/**
 * ★關卡推進 step2（camera-follow 過場）用：玩家左界的「臨時放寬」override（runtime，非改常數）。
 *   通道開啟時把左界往左延伸（讓玩家能走出原 playfield 進通道延伸區、鏡頭有東西跟隨），
 *   走到盡頭觸發重置後 setLeftBoundOverride(null) 還原。PLAYER_BOUNDS 常數本身永不改。
 *   ★單一 seam：PlayerControlSystem 夾限一律走 effectivePlayerBounds()，變身-leader review 此處。
 */
let _playerLeftBoundOverride: number | null = null;
/** 設玩家左界臨時 override（px）；傳 null 還原成 PLAYER_BOUNDS.minX。 */
export function setPlayerLeftBoundOverride(minX: number | null): void {
  _playerLeftBoundOverride = minX;
}
/** 現行玩家左界 override（null＝無、用常數）。 */
export function getPlayerLeftBoundOverride(): number | null {
  return _playerLeftBoundOverride;
}
/** 生效的玩家夾限邊界：套用左界 override（其餘同 PLAYER_BOUNDS）。夾限端一律用此。 */
export function effectivePlayerBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: _playerLeftBoundOverride ?? PLAYER_BOUNDS.minX,
    maxX: PLAYER_BOUNDS.maxX,
    minY: PLAYER_BOUNDS.minY,
    maxY: PLAYER_BOUNDS.maxY,
  };
}

/**
 * 敵人遊玩可走邊界（第四輪#1）：X/上界同 MAP_BOUNDS；**下界面板感知**（用 PANEL_TOP_Y，非只 MAP_BOUNDS.maxY）。
 * Enemy 再 insetBounds(此, radiusPx) → 怪底邊(中心+radiusPx)停在面板上緣、不擦進面板。
 * 別寫死：從 PANEL_TOP_Y 算，面板高變動自動跟。
 */
export const ENEMY_PLAY_BOUNDS = {
  minX: MAP_BOUNDS.minX,
  maxX: MAP_BOUNDS.maxX,
  minY: MAP_BOUNDS.minY,
  maxY: Math.min(MAP_BOUNDS.maxY, PANEL_TOP_Y), // 面板感知下界(怪底邊停面板頂)
} as const;

/** 依 inset（各邊內縮 px，如敵人 body 半徑）收縮邊界，讓「整個 body」都在界內而非只中心。 */
export function insetBounds(
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  inset: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  // 內縮不得反轉（inset 過大時夾到中線）。
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    minX: Math.min(bounds.minX + inset, cx),
    maxX: Math.max(bounds.maxX - inset, cx),
    minY: Math.min(bounds.minY + inset, cy),
    maxY: Math.max(bounds.maxY - inset, cy),
  };
}

/** 夾限結果：修正後座標 + 是否真的有超界（呼應 Unity「只在真超界才寫回」）。 */
export interface ClampResult {
  x: number;
  y: number;
  changed: boolean;
}

/**
 * 把位置夾限在地圖邊界內（純函式，可測）。
 * changed 只在真的超界（clampedX !== x || clampedY !== y）時為 true，
 * 呼叫端據此決定是否寫回位置，避免每幀強設位置跟物理移動打架。
 */
export function clampToBounds(
  x: number,
  y: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number } = MAP_BOUNDS,
): ClampResult {
  const cx = Math.min(Math.max(x, bounds.minX), bounds.maxX);
  const cy = Math.min(Math.max(y, bounds.minY), bounds.maxY);
  return { x: cx, y: cy, changed: cx !== x || cy !== y };
}
