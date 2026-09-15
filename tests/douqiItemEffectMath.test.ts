import { describe, it, expect } from 'vitest';
import {
  healClampEnergy,
  dotTickCount,
  lightningStrikeAngles,
  orbitPoint,
  circleAoeHit,
} from '@/systems/douqiItemEffectMath';

describe('douqiItemEffectMath', () => {
  describe('healClampEnergy (H 補能量 clamp)', () => {
    it('補不超 cap', () => expect(healClampEnergy(0.8, 0.35, 1)).toBe(1)); // 1.15→clamp 1
    it('未滿正常加', () => expect(healClampEnergy(0.2, 0.35, 1)).toBeCloseTo(0.55));
    it('負不低於 0', () => expect(healClampEnergy(0.1, -0.5, 1)).toBe(0));
  });

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
});
