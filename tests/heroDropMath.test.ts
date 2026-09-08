import { describe, expect, it } from 'vitest';
import { shouldDropHeroItem, HERO_DROP_RATE } from '@/config/heroDropMath';

/**
 * heroDropMath — 怪掉英雄變身道具掉落判定（階段2）。純函式 rng 可注入 → 決定性測。
 */
describe('shouldDropHeroItem — 掉落判定（rng 可注入）', () => {
  it('rng < rate → 掉落；>= rate → 不掉', () => {
    expect(shouldDropHeroItem(() => 0.1, 0.15)).toBe(true); // 0.1 < 0.15
    expect(shouldDropHeroItem(() => 0.14, 0.15)).toBe(true);
    expect(shouldDropHeroItem(() => 0.15, 0.15)).toBe(false); // 邊界 0.15 不 < 0.15
    expect(shouldDropHeroItem(() => 0.9, 0.15)).toBe(false);
  });

  it('rate<=0 → 恆不掉；rate>=1 → 恆掉', () => {
    expect(shouldDropHeroItem(() => 0, 0)).toBe(false); // 0 不 < 0
    expect(shouldDropHeroItem(() => 0.99, 1)).toBe(true); // 0.99 < 1
    expect(shouldDropHeroItem(() => 0, 1)).toBe(true);
  });

  it('★壞 rng（NaN）→ 保守視為不掉（safe=1，1<rate 恆 false）', () => {
    expect(shouldDropHeroItem(() => NaN, 0.15)).toBe(false);
    expect(shouldDropHeroItem(() => NaN, 0.99)).toBe(false);
  });

  it('預設 rate = HERO_DROP_RATE、預設 rng（省略參數不炸）', () => {
    expect(HERO_DROP_RATE).toBeGreaterThan(0);
    expect(HERO_DROP_RATE).toBeLessThan(1);
    // rng 固定驗預設 rate 分界
    expect(shouldDropHeroItem(() => HERO_DROP_RATE - 0.001)).toBe(true);
    expect(shouldDropHeroItem(() => HERO_DROP_RATE + 0.001)).toBe(false);
  });
});
