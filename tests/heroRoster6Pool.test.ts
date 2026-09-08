// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { HERO_ROSTER, pickHero } from '@/config/heroRoster';

/**
 * heroRoster 6 池 sync（測騎，配合翼騎 d4dcaea：HERO_ROSTER 1→6 隻，pickHero 邏輯未動）。
 * pickHero 核心分段/clamp/fallback 邏輯已由 heroRoster.test.ts 用合成 roster 鎖（與池大小無關，仍全綠）。
 * 此檔專鎖「真實 6 隻池」的內容 + 各 index 可達 + rng 近 1 clamp 不越界（6 池的 idx5，非 undefined）。
 * 池大小變動時只需維護此檔的 EXPECTED 常數。
 */
const EXPECTED_ROSTER = ['SunWukong', 'devil1', 'elf1', 'elf2', 'human2', 'legacy1'];

describe('HERO_ROSTER 6 池 sync — 內容/覆蓋/邊界', () => {
  it('池 = 6 隻指定英雄、無重複、不含凡人 Human', () => {
    expect([...HERO_ROSTER]).toEqual(EXPECTED_ROSTER);
    expect(HERO_ROSTER.length).toBe(6);
    expect(new Set(HERO_ROSTER).size).toBe(HERO_ROSTER.length); // 無重複 key
    expect(HERO_ROSTER).not.toContain('Human');
  });

  it('★rng 掃 [0,1) → 6 index 各段各抽中對應英雄（均勻分段，不漏不越界）', () => {
    const len = HERO_ROSTER.length; // 6
    // 每段中點 (i+0.5)/6 → floor(mid×6)=i → 抽中 roster[i]
    for (let i = 0; i < len; i++) {
      const mid = (i + 0.5) / len;
      expect(pickHero(HERO_ROSTER, () => mid)).toBe(HERO_ROSTER[i]);
    }
    // 掃整個 [0,1)（步進細）→ 抽中的 key 集合 == 全池（每隻都可達）
    const hit = new Set<string>();
    for (let r = 0; r < 1; r += 0.01) hit.add(pickHero(HERO_ROSTER, () => r)!);
    expect(hit.size).toBe(len); // 6 隻全被抽到（無死角 index）
    for (const k of HERO_ROSTER) expect(hit.has(k)).toBe(true);
  });

  it('★rng=0 → 第一隻(SunWukong)；rng 近 1 / =1 → 最後一隻(legacy1)，clamp 不越界不 undefined', () => {
    expect(pickHero(HERO_ROSTER, () => 0)).toBe('SunWukong'); // idx0
    expect(pickHero(HERO_ROSTER, () => 0.999999)).toBe('legacy1'); // idx5
    expect(pickHero(HERO_ROSTER, () => 1)).toBe('legacy1'); // clamp → idx5，非 undefined
    expect(pickHero(HERO_ROSTER, () => 0.9999999999)).toBe('legacy1'); // 極近 1 仍 idx5
  });
});
