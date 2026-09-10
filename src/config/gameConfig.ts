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

/**
 * 貼地圓盤俯視壓扁 Y 係數（魔尖塔環/火雨預警共用）：貼圖/Graphics 沿 Y 壓扁成俯視橢圓（0.5＝高度對半）。
 * ★單一真源：EffectSystem 視覺 + towerRingSkill 判定都讀此值，讓「判定橢圓」跟「視覺橢圓」一致（上下對稱，Bug4）。
 */
export const GROUND_SQUASH_Y = 0.5;

/** 將 Unity unit 轉成像素。 */
export function toPixels(units: number): number {
  return units * PPU;
}
