/**
 * comboRewardDisplay — COMBO 結算報獎表演的純呈現邏輯（第3項）。
 * 報獎文字/華麗度參數抽純函式方便測試。⚠️ 純視覺；不涉及 combo 數值。
 */

/** COMBO 報獎表演參數（一般 vs 滿檔）。 */
export const COMBO_REWARD_FX = {
  durationSec: 1.2,
  risePx: 100,
  /** 一般結算文字大小 / 滿檔更大。 */
  fontSizeNormal: 32,
  fontSizeMax: 56,
  /** 起手放大彈跳的峰值 scale。 */
  popScale: 1.4,
  popSec: 0.25,
  /** 文字上方偏移（相對玩家位置往上，H5 Y 下為正 → 減）。 */
  offsetYPx: 90,
} as const;

/**
 * COMBO 報獎文字：「COMBO xN  +M」。滿檔加驚嘆點綴。
 */
export function comboRewardLabel(count: number, tickets: number, isMax: boolean): string {
  const base = `COMBO x${count}  +${tickets}`;
  return isMax ? `MAX ${base}!` : base;
}

/** 依是否滿檔取字級（滿檔更華麗）。 */
export function comboRewardFontSize(isMax: boolean): number {
  return isMax ? COMBO_REWARD_FX.fontSizeMax : COMBO_REWARD_FX.fontSizeNormal;
}
