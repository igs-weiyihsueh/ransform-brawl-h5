import { describe, expect, it } from 'vitest';
import { hitTier, hitTierByRatio, DEFAULT_HIT_TIER_THRESHOLDS } from '@/systems/hitTierMath';

/**
 * 命中分級純函式測試（第 3 塊）。含壞版對照。★純表現層分類器，不碰傷害/判定。
 */

describe('hitTier — 絕對傷害分級（預設 light≤1/mid≤3/heavy>3）', () => {
  it('dmg 1 → light（邊界含上界）', () => {
    expect(hitTier(1)).toBe('light');
    expect(hitTier(0)).toBe('light');
  });
  it('dmg 2/3 → mid（>light 上界、<=mid 上界）', () => {
    expect(hitTier(2)).toBe('mid');
    expect(hitTier(3)).toBe('mid');
  });
  it('dmg 4+ → heavy（>mid 上界）', () => {
    expect(hitTier(4)).toBe('heavy');
    expect(hitTier(99)).toBe('heavy');
  });
  it('★釘邊界：3=mid 非 heavy（<= 含上界，非 <）', () => {
    expect(hitTier(3)).toBe('mid');
    expect(hitTier(3)).not.toBe('heavy');
  });
  it('自訂閾值：light≤5/mid≤10 → dmg 7=mid', () => {
    expect(hitTier(7, { light: 5, mid: 10 })).toBe('mid');
    expect(hitTier(5, { light: 5, mid: 10 })).toBe('light');
    expect(hitTier(11, { light: 5, mid: 10 })).toBe('heavy');
  });
  it('預設閾值常數 = {light:1, mid:3}', () => {
    expect(DEFAULT_HIT_TIER_THRESHOLDS).toEqual({ light: 1, mid: 3 });
  });
});

describe('hitTierByRatio — 比例分級（備用，Boss 大傷）', () => {
  it('傷害佔比 <=0.15 → light、<=0.4 → mid、否則 heavy', () => {
    expect(hitTierByRatio(10, 100)).toBe('light'); // 0.1
    expect(hitTierByRatio(30, 100)).toBe('mid'); // 0.3
    expect(hitTierByRatio(80, 100)).toBe('heavy'); // 0.8
  });
  it('maxRef<=0 → 一律 light（防除零）', () => {
    expect(hitTierByRatio(50, 0)).toBe('light');
  });
  it('邊界 0.15=light、0.4=mid（含上界）', () => {
    expect(hitTierByRatio(15, 100)).toBe('light');
    expect(hitTierByRatio(40, 100)).toBe('mid');
  });
});
