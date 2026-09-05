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
