import { describe, expect, it } from 'vitest';
import { shouldDropHeroItem, HERO_DROP_RATE, HERO_DROP_ENABLED } from '@/config/heroDropMath';

/**
 * heroDropMath — 怪掉英雄變身道具掉落判定（階段2 + 新需求④總開關）。純函式 rng 可注入 → 決定性測。
 * ★HERO_DROP_ENABLED 預設 false（用戶關掉場上道具）→ 測 rate/rng 邏輯時顯式傳 enabled=true。
 */
describe('shouldDropHeroItem — 掉落判定（rng 可注入，enabled=true 測 rate 邏輯）', () => {
  it('rng < rate → 掉落；>= rate → 不掉（enabled=true）', () => {
    expect(shouldDropHeroItem(() => 0.1, 0.15, true)).toBe(true); // 0.1 < 0.15
    expect(shouldDropHeroItem(() => 0.14, 0.15, true)).toBe(true);
    expect(shouldDropHeroItem(() => 0.15, 0.15, true)).toBe(false); // 邊界 0.15 不 < 0.15
    expect(shouldDropHeroItem(() => 0.9, 0.15, true)).toBe(false);
  });

  it('rate<=0 → 恆不掉；rate>=1 → 恆掉（enabled=true）', () => {
    expect(shouldDropHeroItem(() => 0, 0, true)).toBe(false); // 0 不 < 0
    expect(shouldDropHeroItem(() => 0.99, 1, true)).toBe(true); // 0.99 < 1
    expect(shouldDropHeroItem(() => 0, 1, true)).toBe(true);
  });

  it('★壞 rng（NaN）→ 保守視為不掉（safe=1，1<rate 恆 false；enabled=true）', () => {
    expect(shouldDropHeroItem(() => NaN, 0.15, true)).toBe(false);
    expect(shouldDropHeroItem(() => NaN, 0.99, true)).toBe(false);
  });

  it('★總開關 HERO_DROP_ENABLED：現預設 false → 恆不掉（不看 rate/rng）', () => {
    expect(HERO_DROP_ENABLED).toBe(false); // 用戶關掉場上道具
    // 省略 enabled 參數走預設 false → 即使 rng<rate 也不掉。
    expect(shouldDropHeroItem(() => 0, 0.99)).toBe(false);
    expect(shouldDropHeroItem(() => 0.001, HERO_DROP_RATE)).toBe(false);
    // 顯式 enabled=false → 恆不掉。
    expect(shouldDropHeroItem(() => 0, 1, false)).toBe(false);
    // 顯式 enabled=true → 恢復看 rate/rng（開回效果）。
    expect(shouldDropHeroItem(() => 0, 1, true)).toBe(true);
  });

  it('rate 常數健全（開回後用）：0<HERO_DROP_RATE<1', () => {
    expect(HERO_DROP_RATE).toBeGreaterThan(0);
    expect(HERO_DROP_RATE).toBeLessThan(1);
  });
});
