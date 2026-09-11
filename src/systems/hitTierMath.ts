/**
 * hitTierMath — 命中特效分級純邏輯（怪物 AI 移植第 3 塊，瓢蟲 HitEffectPackage 規格 12.3/12.4）。
 * ★純表現層：只依「已結算的最終傷害值」算等級（light/mid/heavy）供選命中特效 package。
 *   零 Phaser、offset-無關、不碰任何傷害計算/命中判定/結算（守 a655c53d，本檔只是 hit 結果的分類器）。
 */

/** 命中等級（輕/中/重）。 */
export type HitTier = 'light' | 'mid' | 'heavy';

/** 絕對傷害閾值（含上界）：dmg<=light→light、<=mid→mid、否則 heavy。 */
export interface HitTierThresholds {
  /** light 上界（含）。 */
  light: number;
  /** mid 上界（含）。 */
  mid: number;
}

/** 預設閾值（敵傷小整數）：light≤1、mid≤3、heavy>3。 */
export const DEFAULT_HIT_TIER_THRESHOLDS: HitTierThresholds = { light: 1, mid: 3 };

/**
 * 依傷害絕對值分命中等級（純函式）。閾值可傳參 config 化。
 * @param damage 已結算的最終傷害值。
 * @param thresholds 閾值（省略用預設 light≤1/mid≤3/heavy>3）。
 * @returns 'light' | 'mid' | 'heavy'。
 */
export function hitTier(damage: number, thresholds: HitTierThresholds = DEFAULT_HIT_TIER_THRESHOLDS): HitTier {
  if (damage <= thresholds.light) return 'light';
  if (damage <= thresholds.mid) return 'mid';
  return 'heavy';
}

/**
 * 備用：依「傷害佔參考最大值的比例」分等級（Boss 大傷按比例用；第 3 塊敵傷用 hitTier 絕對版）。
 * @param damage 已結算傷害。
 * @param maxRef 參考最大傷害（如目標最大 HP 或該攻擊最大傷害）；<=0 → 一律 light。
 * @param ratios 比例上界（含）：ratio<=light→light、<=mid→mid、否則 heavy。預設 light 0.15 / mid 0.4。
 * @returns HitTier。
 */
export function hitTierByRatio(
  damage: number,
  maxRef: number,
  ratios: { light: number; mid: number } = { light: 0.15, mid: 0.4 },
): HitTier {
  if (maxRef <= 0) return 'light';
  const r = damage / maxRef;
  if (r <= ratios.light) return 'light';
  if (r <= ratios.mid) return 'mid';
  return 'heavy';
}
