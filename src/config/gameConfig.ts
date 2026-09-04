/**
 * 全域遊戲設定。
 *
 * 設計解析度採 1920x1080（橫式），符合實機橫式螢幕。
 * 使用 FIT + CENTER_BOTH 自動縮放置中。
 */
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

/** 主背景色（深藍紫）。 */
export const BACKGROUND_COLOR = '#1a1a2e';

/**
 * Pixels-Per-Unit：Unity 世界單位(unit) → H5 像素的換算基準。
 * Unity 的所有距離/尺寸數值 × PPU 得到像素值，方便對照 Unity 規格。
 */
export const PPU = 100;

/** 將 Unity unit 轉成像素。 */
export function toPixels(units: number): number {
  return units * PPU;
}
