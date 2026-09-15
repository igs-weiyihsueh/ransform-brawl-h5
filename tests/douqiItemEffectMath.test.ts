import { describe, it, expect } from 'vitest';
import {
  dotTickCount,
  lightningStrikeAngles,
  orbitPoint,
  circleAoeHit,
  pathSamplePoints,
  hasVulnerableInRange,
  pickComboTargets,
  orbitLandingPoint,
  comboStepMs,
} from '@/systems/douqiItemEffectMath';

describe('douqiItemEffectMath', () => {
  describe('dotTickCount (A 旋風 DOT 跳數)', () => {
    it('3000/200=15 跳', () => expect(dotTickCount(3000, 200)).toBe(15));
    it('tick<=0→0', () => expect(dotTickCount(3000, 0)).toBe(0));
  });

  describe('lightningStrikeAngles (B 6 道環繞順時針)', () => {
    it('6 道、60°間隔、從 -90 起', () => {
      expect(lightningStrikeAngles(6, -90)).toEqual([-90, -30, 30, 90, 150, 210]);
    });
    it('count<=0→空', () => expect(lightningStrikeAngles(0)).toEqual([]));
    it('4 道 90°間隔', () => expect(lightningStrikeAngles(4, 0)).toEqual([0, 90, 180, 270]));
  });

  describe('orbitPoint (極座標落點)', () => {
    it('中心右 (0°)', () => {
      const p = orbitPoint(100, 100, 50, 0);
      expect(p.x).toBeCloseTo(150); expect(p.y).toBeCloseTo(100);
    });
    it('正上 (-90°)', () => {
      const p = orbitPoint(100, 100, 50, -90);
      expect(p.x).toBeCloseTo(100); expect(p.y).toBeCloseTo(50);
    });
  });

  describe('circleAoeHit (圓形 AOE 命中含目標半徑)', () => {
    it('圈內命中', () => expect(circleAoeHit(0, 0, 100, 0, 90, 20)).toBe(true)); // 100<=110
    it('圈外不中', () => expect(circleAoeHit(0, 0, 120, 0, 90, 20)).toBe(false)); // 120>110
    it('邊界=radius+targetR 命中', () => expect(circleAoeHit(0, 0, 110, 0, 90, 20)).toBe(true));
  });

  describe('pathSamplePoints (C 居合直線取樣)', () => {
    it('水平路徑每 stepPx 一點（含起訖）', () => {
      const pts = pathSamplePoints(0, 0, 100, 0, 40); // len100/40→ceil2.5=3 段→4 點
      expect(pts.length).toBe(4);
      expect(pts[0]).toEqual({ x: 0, y: 0 });
      expect(pts[pts.length - 1].x).toBeCloseTo(100);
    });
    it('零長度→單點', () => {
      const pts = pathSamplePoints(5, 5, 5, 5, 40);
      expect(pts).toEqual([{ x: 5, y: 5 }]);
    });
    it('取樣間距 ≤ stepPx（膠囊不漏）', () => {
      const pts = pathSamplePoints(0, 0, 200, 0, 50);
      for (let i = 1; i < pts.length; i += 1) {
        expect(pts[i].x - pts[i - 1].x).toBeLessThanOrEqual(50 + 1e-6);
      }
    });
  });

  describe('hasVulnerableInRange (T 時停空放判定)', () => {
    it('範圍內有敵→true', () => expect(hasVulnerableInRange([{ x: 100, y: 0 }], 0, 0, 900)).toBe(true));
    it('範圍外無敵→false', () => expect(hasVulnerableInRange([{ x: 1000, y: 0 }], 0, 0, 900)).toBe(false));
    it('空陣列→false', () => expect(hasVulnerableInRange([], 0, 0, 900)).toBe(false));
    it('邊界 900→true', () => expect(hasVulnerableInRange([{ x: 900, y: 0 }], 0, 0, 900)).toBe(true));
  });

  describe('pickComboTargets (連斬9下依距離、不足循環)', () => {
    const enemies = [{ x: 300, y: 0, id: 0 }, { x: 100, y: 0, id: 1 }, { x: 200, y: 0, id: 2 }];
    it('依距離近→遠排序', () => {
      const t = pickComboTargets(enemies, 0, 0, 3, 900);
      expect(t).toEqual([1, 2, 0]); // 100,200,300
    });
    it('★不足9下循環同一批', () => {
      const t = pickComboTargets(enemies, 0, 0, 9, 900);
      expect(t.length).toBe(9);
      expect(t).toEqual([1, 2, 0, 1, 2, 0, 1, 2, 0]); // 3 個循環
    });
    it('範圍外排除', () => {
      const t = pickComboTargets([{ x: 1000, y: 0, id: 0 }, { x: 50, y: 0, id: 1 }], 0, 0, 2, 900);
      expect(t).toEqual([1, 1]); // 只 id1 在範圍、循環
    });
    it('全空→空陣列', () => expect(pickComboTargets([{ x: 2000, y: 0, id: 0 }], 0, 0, 9, 900)).toEqual([]));
  });

  describe('orbitLandingPoint (左右交替落點)', () => {
    it('偶=右(+offset)、奇=左(-offset)', () => {
      expect(orbitLandingPoint(100, 100, 70, 0)).toEqual({ x: 170, y: 100 });
      expect(orbitLandingPoint(100, 100, 70, 1)).toEqual({ x: 30, y: 100 });
      expect(orbitLandingPoint(100, 100, 70, 2)).toEqual({ x: 170, y: 100 });
    });
  });

  describe('comboStepMs (連斬節奏 duration/(targets+1))', () => {
    it('2000/(9+1)=200', () => expect(comboStepMs(2000, 9)).toBe(200));
    it('2000/(4+1)=400', () => expect(comboStepMs(2000, 4)).toBe(400));
  });
});
