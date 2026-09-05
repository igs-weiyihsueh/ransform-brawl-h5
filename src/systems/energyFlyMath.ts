/**
 * energyFlyMath — 能量飛寶盒表演的純數學（第4項）。
 * 對應 Unity RewardFlowUI 飛光：起點 lerp 到終點 + 縮放脈動。純函式方便測試。
 * ⚠️ 純視覺參數；不涉及 chest 數值（addCharge 維持即時加值、與此解耦）。
 */

/** 飛光參數（對照 Unity RewardFlowUI FlyDuration≈0.7s）。 */
export const ENERGY_FLY = {
  durationSec: 0.7,
  /** 縮放脈動：基準 + 幅度 × sin。 */
  scaleBase: 1.0,
  scaleAmp: 0.35,
  scalePulseHz: 3, // 每秒脈動次數
  /** 光點基準像素半徑。 */
  radiusPx: 10,
} as const;

/** 線性插值。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 飛光第 t（0..1）幀的位置（起點直線 lerp 到終點）。
 */
export function flyPosition(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  t: number,
): { x: number; y: number } {
  return { x: lerp(startX, endX, t), y: lerp(startY, endY, t) };
}

/**
 * 縮放脈動：base + amp × sin(2π × hz × elapsed)。t=進度、totalSec=總時長。
 * 用進度換算 elapsed 秒，讓脈動頻率與 duration 無關。
 */
export function flyScale(t: number, totalSec: number = ENERGY_FLY.durationSec): number {
  const elapsed = t * totalSec;
  return (
    ENERGY_FLY.scaleBase +
    ENERGY_FLY.scaleAmp * Math.sin(2 * Math.PI * ENERGY_FLY.scalePulseHz * elapsed)
  );
}

/**
 * 透明脈動（可選）：接近終點漸淡出。t∈[0,1]，最後 20% 線性淡出。
 */
export function flyAlpha(t: number): number {
  const fadeStart = 0.8;
  if (t <= fadeStart) return 1;
  return Math.max(0, 1 - (t - fadeStart) / (1 - fadeStart));
}
