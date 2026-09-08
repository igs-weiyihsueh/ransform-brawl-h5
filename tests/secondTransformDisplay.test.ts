import { describe, expect, it } from 'vitest';
import { resolveSecondTransformDisplay } from '@/systems/ui/secondTransformDisplay';

/**
 * secondTransformDisplay — 二段變身能量條 UI 純顯示決策（用戶新大功能）。
 * 規格：available=false 且 active=false（含 flag 關）→ 不顯二段條（走現有魂力環）；
 * available=true → 顯二段條 charging（累積）；active=true → 顯二段條 active（消退/滿格特效）。
 * ratio 夾限 [0,1]。含 flag 關現況不受影響的關鍵斷言。
 */
describe('resolveSecondTransformDisplay — 二段能量條顯示決策', () => {
  it('★flag 關（available=false, active=false, ratio=0）→ 不顯二段條（走現有魂力環）', () => {
    const d = resolveSecondTransformDisplay(false, false, 0);
    expect(d.show).toBe(false);
    expect(d.ratio).toBe(0);
  });

  it('available=true, 未 active → 顯二段條、charging 樣式、ratio 帶入', () => {
    const d = resolveSecondTransformDisplay(true, false, 0.42);
    expect(d.show).toBe(true);
    expect(d.style).toBe('charging');
    expect(d.ratio).toBeCloseTo(0.42, 6);
  });

  it('active=true → 顯二段條、active 樣式（二段變身中消退/滿格）', () => {
    const d = resolveSecondTransformDisplay(true, true, 0.8);
    expect(d.show).toBe(true);
    expect(d.style).toBe('active');
    expect(d.ratio).toBeCloseTo(0.8, 6);
  });

  it('active=true 但 available=false（二段中已離開可累積階段）→ 仍顯示 active', () => {
    const d = resolveSecondTransformDisplay(false, true, 1);
    expect(d.show).toBe(true);
    expect(d.style).toBe('active');
    expect(d.ratio).toBe(1);
  });

  it('ratio 夾限 [0,1]（負→0、超過→1）', () => {
    expect(resolveSecondTransformDisplay(true, false, -0.5).ratio).toBe(0);
    expect(resolveSecondTransformDisplay(true, false, 1.7).ratio).toBe(1);
  });

  it('ratio NaN → 0（不炸）', () => {
    expect(resolveSecondTransformDisplay(true, false, Number.NaN).ratio).toBe(0);
  });

  it('★壞版對照：flag 關卻誤顯二段條會被此測抓到（show 必為 false）', () => {
    // 若日後誤把 available=false 也回 show=true，此斷言會紅 → 保護「flag 關走現有魂力環」。
    expect(resolveSecondTransformDisplay(false, false, 0).show).toBe(false);
  });
});
