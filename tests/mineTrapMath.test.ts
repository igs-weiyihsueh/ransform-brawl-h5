import { describe, expect, it } from 'vitest';
import { isInBlastRange, tickMineDelay } from '@/systems/mineTrapMath';

/** mineTrapMath — 地雷範圍命中 + 延遲倒數純邏輯。 */
describe('isInBlastRange — 爆炸範圍（歐氏）', () => {
  const mine = { x: 500, y: 300 };
  it('範圍內/邊界 → true；範圍外 → false', () => {
    expect(isInBlastRange({ x: 500, y: 300 }, mine, 100)).toBe(true); // 同點
    expect(isInBlastRange({ x: 599, y: 300 }, mine, 100)).toBe(true); // 距 99<100
    expect(isInBlastRange({ x: 600, y: 300 }, mine, 100)).toBe(true); // 距 100=邊界(<=)
    expect(isInBlastRange({ x: 601, y: 300 }, mine, 100)).toBe(false); // 距 101>100
  });
  it('對角用歐氏距離', () => {
    expect(isInBlastRange({ x: 560, y: 380 }, mine, 100)).toBe(true); // (60,80)=100 邊界
    expect(isInBlastRange({ x: 580, y: 380 }, mine, 100)).toBe(false); // (80,80)≈113>100
  });
  it('radiusPx=0 → 只同點命中', () => {
    expect(isInBlastRange({ x: 500, y: 300 }, mine, 0)).toBe(true);
    expect(isInBlastRange({ x: 501, y: 300 }, mine, 0)).toBe(false);
  });
});

describe('tickMineDelay — 延遲倒數', () => {
  it('倒數中未歸零 → exploded false、remaining 遞減', () => {
    expect(tickMineDelay(3, 0.5)).toEqual({ remaining: 2.5, exploded: false });
  });
  it('★這幀跨越 0 → exploded true、remaining clamp 0', () => {
    expect(tickMineDelay(0.3, 0.5)).toEqual({ remaining: 0, exploded: true });
    expect(tickMineDelay(0.5, 0.5)).toEqual({ remaining: 0, exploded: true }); // 恰好到 0
  });
  it('已 0（remaining<=0）→ 不重複 exploded（只在跨越那幀爆一次）', () => {
    expect(tickMineDelay(0, 0.5)).toEqual({ remaining: 0, exploded: false });
    expect(tickMineDelay(-0.1, 0.5)).toEqual({ remaining: 0, exploded: false });
  });
});
