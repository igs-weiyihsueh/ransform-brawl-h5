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
import { GLOBAL_CHARACTER_SCALE, PLAYER_HIT_RADIUS } from '@/config/combatConfig';

/** Unity 世界單位邊界（中心原點）。改數值請對照 Unity MapConfig。 */
export const MAP_BOUNDS_UNITS = {
  minX: -8,
  maxX: 8,
  minY: -4,
  maxY: 4,
} as const;

/** H5 螢幕像素邊界（左上原點）：由 Unity 中心原點邊界換算。 */
export const MAP_BOUNDS = {
  minX: GAME_WIDTH / 2 + MAP_BOUNDS_UNITS.minX * PPU, // 160
  maxX: GAME_WIDTH / 2 + MAP_BOUNDS_UNITS.maxX * PPU, // 1760
  minY: GAME_HEIGHT / 2 + MAP_BOUNDS_UNITS.minY * PPU, // 140
  maxY: GAME_HEIGHT / 2 + MAP_BOUNDS_UNITS.maxY * PPU, // 940
} as const;

/**
 * 下方面板頂緣 Y（螢幕座標）：BottomPanel y = GAME_HEIGHT - bottomOffset(16) - slotHeight(120) = 944。
 * 玩家可走區域下界不得越過此線（否則角色會穿進下方面板）。此處對齊 uiLayoutSchema 預設值。
 */
export const PANEL_TOP_Y = GAME_HEIGHT - 16 - 120; // 944

/**
 * 玩家遊玩可走邊界：X/上界同 MAP_BOUNDS；**下界收到面板上緣之上**（避免角色穿進下方面板）。
 * 下邊距 = 玩家 body 半徑(hitRadius×scale)，讓角色整個身體停在面板頂緣之上、不重疊面板。
 */
const PLAYER_BOTTOM_MARGIN = PLAYER_HIT_RADIUS * PPU * GLOBAL_CHARACTER_SCALE; // 0.4×100×1.5 = 60
export const PLAYER_BOUNDS = {
  minX: MAP_BOUNDS.minX,
  maxX: MAP_BOUNDS.maxX,
  minY: MAP_BOUNDS.minY,
  maxY: Math.min(MAP_BOUNDS.maxY, PANEL_TOP_Y - PLAYER_BOTTOM_MARGIN), // min(940, 884) = 884
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
