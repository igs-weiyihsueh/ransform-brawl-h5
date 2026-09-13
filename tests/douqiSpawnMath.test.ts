import { describe, it, expect } from 'vitest';
import {
  clampNum,
  lerpByLevel,
  computeWaveQuota,
  currentSpawnIntervalMs,
  currentMaxAlive,
  filterUnlockedEntries,
  isBossWave,
  isEventWave,
} from '@/systems/douqiSpawnMath';

describe('douqiSpawnMath', () => {
  describe('clampNum', () => {
    it('clamps to range', () => {
      expect(clampNum(5, 1, 10)).toBe(5);
      expect(clampNum(-3, 1, 10)).toBe(1);
      expect(clampNum(99, 1, 10)).toBe(10);
    });
  });

  describe('lerpByLevel', () => {
    it('returns lv1 at level 1, cap at level cap, midpoint between', () => {
      expect(lerpByLevel(1.6, 1.0, 1, 10)).toBeCloseTo(1.6);
      expect(lerpByLevel(1.6, 1.0, 10, 10)).toBeCloseTo(1.0);
      expect(lerpByLevel(1.6, 1.0, 5.5, 10)).toBeCloseTo(1.3); // 中點
    });
    it('clamps level to [1,cap]', () => {
      expect(lerpByLevel(1.6, 1.0, 0, 10)).toBeCloseTo(1.6);
      expect(lerpByLevel(1.6, 1.0, 20, 10)).toBeCloseTo(1.0);
    });
    it('cap<=1 returns capVal', () => {
      expect(lerpByLevel(1.6, 1.0, 5, 1)).toBe(1.0);
    });
  });

  describe('computeWaveQuota', () => {
    // v45: base10 growth8 preBoss1.5 cap90 total10 → [10,18,26,34,42,50,58,90(×1.5=99→cap90),90(×1.5→cap90),BOSS]
    it('matches v45 10-wave table', () => {
      const q = (w: number) => computeWaveQuota(w, 10, 8, 1.5, 90, 10);
      expect(q(1)).toBe(10);
      expect(q(2)).toBe(18);
      expect(q(3)).toBe(26);
      expect(q(4)).toBe(34);
      expect(q(5)).toBe(42);
      expect(q(6)).toBe(50);
      expect(q(7)).toBe(58);
      expect(q(8)).toBe(90); // 66×1.5=99→cap90
      expect(q(9)).toBe(90); // 74×1.5=111→cap90
      expect(q(10)).toBe(82); // BOSS 關：raw 10+9×8=82（<cap90，未加 preBoss mult）；實際 quota 由 BOSS 定
    });
  });

  describe('currentSpawnIntervalMs', () => {
    const cfg = { initialIntervalMs: 1700, intervalDecayPerSec: 16, minIntervalMs: 650, intervalMultLv1: 1.6, intervalMultCap: 1.0 };
    it('lv1 fresh = initial × 1.6', () => {
      expect(currentSpawnIntervalMs(0, 1, cfg, 10)).toBeCloseTo(1700 * 1.6);
    });
    it('decays with alive time (floored at min) then ×levelMult', () => {
      // aliveSec 100 → 1700−1600=100 <650 → clamp 650; lv10 mult 1.0
      expect(currentSpawnIntervalMs(100, 10, cfg, 10)).toBeCloseTo(650);
    });
    it('lv10 faster than lv1', () => {
      expect(currentSpawnIntervalMs(10, 10, cfg, 10)).toBeLessThan(currentSpawnIntervalMs(10, 1, cfg, 10));
    });
  });

  describe('currentMaxAlive', () => {
    const cfg = { maxAliveBase: 416, maxAliveMultLv1: 0.5, maxAliveMultCap: 1.0 };
    it('lv1 solo = base×0.5×0.4', () => {
      expect(currentMaxAlive(1, 1, cfg, 10)).toBe(Math.floor(416 * 0.5 * 0.4));
    });
    it('lv10 4-player = base×1.0×1.0', () => {
      expect(currentMaxAlive(10, 4, cfg, 10)).toBe(416);
    });
    it('more players raises cap', () => {
      expect(currentMaxAlive(5, 4, cfg, 10)).toBeGreaterThan(currentMaxAlive(5, 1, cfg, 10));
    });
  });

  describe('filterUnlockedEntries', () => {
    // ★byWave 解鎖過濾（douqi 語意）；加權輪盤本身走波騎 waveMath.pickWeightedType（單一來源、waveMath.test 已測）。
    const entries = [
      { enemyType: 'normal', weight: 75, unlockWave: 1 },
      { enemyType: 'tank', weight: 12, unlockWave: 2 },
      { enemyType: 'shooter', weight: 10, unlockWave: 6 },
      { enemyType: 'zeroWeight', weight: 0, unlockWave: 1 },
    ];
    it('wave1 only unlocks normal (weight>0 且 unlockWave<=1)', () => {
      const got = filterUnlockedEntries(entries, 1).map((e) => e.enemyType);
      expect(got).toEqual(['normal']);
    });
    it('wave2 unlocks normal+tank', () => {
      const got = filterUnlockedEntries(entries, 2).map((e) => e.enemyType);
      expect(got).toEqual(['normal', 'tank']);
    });
    it('wave6 unlocks normal+tank+shooter', () => {
      const got = filterUnlockedEntries(entries, 6).map((e) => e.enemyType);
      expect(got).toEqual(['normal', 'tank', 'shooter']);
    });
    it('drops zero/negative weight entries', () => {
      expect(filterUnlockedEntries(entries, 10).some((e) => e.enemyType === 'zeroWeight')).toBe(false);
    });
  });

  describe('isBossWave / isEventWave', () => {
    it('boss every 10th wave', () => {
      expect(isBossWave(10, 10)).toBe(true);
      expect(isBossWave(20, 10)).toBe(true);
      expect(isBossWave(5, 10)).toBe(false);
    });
    it('event on cycle-relative 3/5/7, boss takes precedence', () => {
      const ev = [3, 5, 7];
      expect(isEventWave(3, 10, ev)).toBe(true);
      expect(isEventWave(5, 10, ev)).toBe(true);
      expect(isEventWave(7, 10, ev)).toBe(true);
      expect(isEventWave(1, 10, ev)).toBe(false);
      expect(isEventWave(10, 10, ev)).toBe(false); // boss 優先
      expect(isEventWave(13, 10, ev)).toBe(true); // 循環內序 3 → 事件
    });
  });
});
