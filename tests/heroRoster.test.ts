import { describe, expect, it } from 'vitest';
import { HERO_ROSTER, pickHero } from '@/config/heroRoster';

/**
 * heroRoster — 英雄池隨機抽（階段1 角色狀態機）。
 * pickHero(roster, rng) 純函式、rng 可注入 → 用固定 rng 鎖定抽哪個（決定性測）。
 * 凡人 Human 不在池；roster 空 → null。
 */
describe('pickHero — 英雄池隨機抽（rng 可注入）', () => {
  it('HERO_ROSTER 目前含 SunWukong、不含凡人 Human（框架先到位）', () => {
    expect(HERO_ROSTER).toContain('SunWukong');
    expect(HERO_ROSTER).not.toContain('Human');
  });

  it('rng 固定 → 決定性抽中對應 index（多英雄池鎖各分段）', () => {
    const roster = ['A', 'B', 'C', 'D'];
    expect(pickHero(roster, () => 0)).toBe('A'); // 0 → idx0
    expect(pickHero(roster, () => 0.24)).toBe('A'); // <0.25 → idx0
    expect(pickHero(roster, () => 0.25)).toBe('B'); // 0.25 → idx1
    expect(pickHero(roster, () => 0.5)).toBe('C'); // idx2
    expect(pickHero(roster, () => 0.75)).toBe('D'); // idx3
    expect(pickHero(roster, () => 0.999)).toBe('D'); // 接近 1 仍 idx3（不越界）
  });

  it('★rng 回 1（邊界）→ clamp 不越界，回最後一個（非 undefined）', () => {
    const roster = ['A', 'B'];
    expect(pickHero(roster, () => 1)).toBe('B'); // clamp 0.999999 → idx1
  });

  it('★rng 回 NaN/負（壞）→ fallback idx0（不炸不 undefined）', () => {
    const roster = ['A', 'B'];
    expect(pickHero(roster, () => NaN)).toBe('A');
    expect(pickHero(roster, () => -0.5)).toBe('A');
  });

  it('★roster 空 → null（呼叫端 fallback）', () => {
    expect(pickHero([], () => 0.5)).toBeNull();
  });

  it('單一英雄池（現況）→ 任何 rng 都抽中該英雄', () => {
    expect(pickHero(['SunWukong'], () => 0)).toBe('SunWukong');
    expect(pickHero(['SunWukong'], () => 0.5)).toBe('SunWukong');
    expect(pickHero(['SunWukong'], () => 0.999)).toBe('SunWukong');
  });

  it('預設 roster = HERO_ROSTER（省略參數）', () => {
    expect(pickHero(undefined, () => 0)).toBe(HERO_ROSTER[0]);
  });
});
