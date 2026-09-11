/**
 * timeScaleMath — 全域時間縮放 + 鏡頭震動純邏輯（怪物 AI 移植第 4 塊，鬥破規格 12.1）。
 * 零 Phaser、offset-無關。交測騎。
 *
 * ★時間縮放＝加性乘法層：effective scale = ∏(各層值)；預設無層＝1.0（byte 同現況、不破測）。
 * ★shake 衰減曲線：供自訂 shake 用（若用 Phaser 內建 shake 則此為備用/可測基準）。
 */

/** 時間縮放層別（瓢蟲 ITimeScaler 分層：系統/編導/程式/自訂）。 */
export type TimeScaleLayer = 'system' | 'director' | 'code' | 'custom';

/**
 * 相乘所有層的縮放值 → 生效總縮放。空 map/全 1.0 → 回 1.0（現況）。
 * @param layers 各層縮放值（0=全凍、1=原速、0.5=半速…）。
 * @returns ∏ 各層值（無層＝1）。
 */
export function multiplyScales(layers: ReadonlyMap<TimeScaleLayer, number>): number {
  let s = 1;
  for (const v of layers.values()) s *= v;
  return s;
}

/**
 * shake 衰減：回 [0,1] 的強度係數（t=0 滿、t>=dur 為 0），線性衰減。
 * @param t 已過時間（秒）。
 * @param durSec 總時長（秒）；<=0 回 0。
 * @returns 0..1 衰減係數（乘 base 強度）。
 */
export function shakeDecay(t: number, durSec: number): number {
  if (durSec <= 0) return 0;
  const k = 1 - t / durSec;
  return k <= 0 ? 0 : k >= 1 ? 1 : k;
}
