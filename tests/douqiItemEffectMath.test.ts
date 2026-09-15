import { describe, it, expect } from 'vitest';
import {
  dotTickCount,
  lightningStrikeAngles,
  orbitPoint,
  circleAoeHit,
  pathSamplePoints,
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
});
