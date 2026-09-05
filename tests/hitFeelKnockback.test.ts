import { describe, expect, it } from 'vitest';
import { HIT_FEEL, knockbackDistancePx } from '@/config/hitFeelConfig';
import { PPU } from '@/config/gameConfig';

/**
 * hitFeel knockbackDistancePx 純函式（hitFeel 第1步，翼騎 b0c3e5e）。
 * dist = clamp(force×forceScale, 0, knockbackDistance) × PPU。含壞版必紅。
 * ⚠️ 純視覺（白閃/punch/火花/死亡粒子）不測（需 boot、headless 造不出穩定命中、低價值）。
 */
describe('knockbackDistancePx — 擊退距離（快進快出總位移）', () => {
  const S = HIT_FEEL.knockbackForceScale; // 0.15
  const MAX = HIT_FEEL.knockbackDistance; // 1.5

  it('小 force 按比例：force×forceScale×PPU（未達上限）', () => {
    // force=5 → 5×0.15=0.75 unit < 1.5 → 0.75×PPU。
    expect(knockbackDistancePx(5, PPU)).toBeCloseTo(5 * S * PPU);
    expect(knockbackDistancePx(5, PPU)).toBeCloseTo(0.75 * PPU);
  });

  it('大 force 被 clamp 到 knockbackDistance(1.5) 上限 ×PPU', () => {
    // force=100 → 100×0.15=15 unit → clamp 到 1.5 → 1.5×PPU。
    expect(knockbackDistancePx(100, PPU)).toBeCloseTo(MAX * PPU);
    // 恰好達上限的 force = 1.5/0.15 = 10：force=10 → 剛好 1.5×PPU（邊界）。
    expect(knockbackDistancePx(10, PPU)).toBeCloseTo(MAX * PPU);
    // 略超（11）仍 clamp 到上限（不超過）。
    expect(knockbackDistancePx(11, PPU)).toBeCloseTo(MAX * PPU);
  });

  it('×PPU 正確：同 force 不同 PPU 成比例', () => {
    expect(knockbackDistancePx(5, 100)).toBeCloseTo(0.75 * 100);
    expect(knockbackDistancePx(5, 200)).toBeCloseTo(0.75 * 200);
  });

  it('邊界：force=0 → 0；負 force clamp 到 0（不反向）', () => {
    expect(knockbackDistancePx(0, PPU)).toBe(0);
    expect(knockbackDistancePx(-5, PPU)).toBe(0);
  });

  // 🔴 壞版對照：沒 clamp → 大 force 會超過 knockbackDistance×PPU 上限。
  it('壞版對照：大 force 不得超過 1.5×PPU（有 clamp）', () => {
    expect(knockbackDistancePx(100, PPU)).toBeLessThanOrEqual(MAX * PPU + 1e-6);
    expect(knockbackDistancePx(100, PPU)).not.toBeGreaterThan(MAX * PPU); // 非線性放大
  });

  // 🔴 壞版對照：必須 ×PPU（unit→px），否則距離錯一個數量級。
  it('壞版對照：結果是 px（×PPU）非 unit', () => {
    expect(knockbackDistancePx(5, PPU)).toBe(0.75 * PPU); // 75，非 0.75
    expect(knockbackDistancePx(5, PPU)).not.toBe(0.75);
  });
});
