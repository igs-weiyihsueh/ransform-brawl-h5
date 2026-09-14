import { describe, it, expect } from 'vitest';
import {
  normalizeDeg,
  angleDiffDeg,
  fanCenterDeg,
  fanGroupCenters,
  fanHitIndex,
  gapDeg,
  fillProgress,
  telegraphRadiusPx,
} from '@/systems/douqiTowerFanMath';

describe('douqiTowerFanMath', () => {
  describe('normalizeDeg / angleDiffDeg', () => {
    it('normalizes to [0,360)', () => {
      expect(normalizeDeg(370)).toBe(10);
      expect(normalizeDeg(-10)).toBe(350);
    });
    it('min angle diff', () => {
      expect(angleDiffDeg(10, 350)).toBe(20);
      expect(angleDiffDeg(0, 180)).toBe(180);
      expect(angleDiffDeg(90, 90)).toBe(0);
    });
  });

  describe('fanCenterDeg / fanGroupCenters (v45 count4 正斜交替)', () => {
    it('group0 正十字 0/90/180/270', () => {
      expect(fanGroupCenters(0, 4)).toEqual([0, 90, 180, 270]);
    });
    it('group1 斜十字 45/135/225/315', () => {
      expect(fanGroupCenters(1, 4)).toEqual([45, 135, 225, 315]);
    });
    it('fanCenterDeg single', () => {
      expect(fanCenterDeg(0, 2, 4)).toBe(180);
      expect(fanCenterDeg(1, 0, 4)).toBe(45);
    });
  });

  describe('gapDeg (v45 arcDeg48 → 42° 縫)', () => {
    it('count4 arc48 → gap 42', () => {
      expect(gapDeg(4, 48)).toBe(42);
    });
    it('arc too big → no gap (<=0)', () => {
      expect(gapDeg(4, 90)).toBeLessThanOrEqual(0);
    });
  });

  describe('fanHitIndex (角度落扇形內 + 距離內)', () => {
    const tower = { x: 500, y: 500 };
    const centers = [0, 90, 180, 270]; // 正十字
    const arc = 48; // ±24
    const radius = 520;
    it('站扇形中心(右, 0°) 距內 → 命中', () => {
      const hit = fanHitIndex(tower, { x: 700, y: 500 }, 20, centers, arc, radius); // 正右
      expect(hit).toBe(0);
    });
    it('站縫隙(45°) → 未命中(正十字留斜縫)', () => {
      const d = 200 / Math.SQRT2;
      const hit = fanHitIndex(tower, { x: 500 + d, y: 500 + d }, 20, centers, arc, radius); // 45°
      expect(hit).toBe(-1);
    });
    it('距離外(>radius) → 未命中', () => {
      const hit = fanHitIndex(tower, { x: 500 + 600, y: 500 }, 20, centers, arc, radius);
      expect(hit).toBe(-1);
    });
    it('扇形邊界內(中心±24 內, 20°) → 命中', () => {
      const a = (20 * Math.PI) / 180;
      const hit = fanHitIndex(tower, { x: 500 + Math.cos(a) * 200, y: 500 + Math.sin(a) * 200 }, 20, centers, arc, radius);
      expect(hit).toBe(0);
    });
    it('扇形外(中心±24 外, 30°) → 未命中', () => {
      const a = (30 * Math.PI) / 180;
      const hit = fanHitIndex(tower, { x: 500 + Math.cos(a) * 200, y: 500 + Math.sin(a) * 200 }, 20, centers, arc, radius);
      expect(hit).toBe(-1);
    });
  });

  describe('fillProgress / telegraphRadiusPx', () => {
    it('fill 0→1 clamped', () => {
      expect(fillProgress(0, 2000)).toBe(0);
      expect(fillProgress(1000, 2000)).toBe(0.5);
      expect(fillProgress(3000, 2000)).toBe(1);
    });
    it('radius grows with fill', () => {
      expect(telegraphRadiusPx(0, 2000, 520)).toBe(0);
      expect(telegraphRadiusPx(2000, 2000, 520)).toBe(520);
      expect(telegraphRadiusPx(1000, 2000, 520)).toBe(260);
    });
  });
});
