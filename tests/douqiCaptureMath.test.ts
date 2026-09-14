import { describe, it, expect } from 'vitest';
import { randomPointInCircle, inCircle, captureProgressDelta, captureRingColor } from '@/systems/douqiCaptureMath';

describe('douqiCaptureMath', () => {
  describe('inCircle', () => {
    it('inside / on edge / outside', () => {
      expect(inCircle(100, 100, 100, 100, 50)).toBe(true);
      expect(inCircle(150, 100, 100, 100, 50)).toBe(true); // on edge
      expect(inCircle(151, 100, 100, 100, 50)).toBe(false);
    });
  });

  describe('randomPointInCircle', () => {
    it('always within radius', () => {
      for (let i = 0; i < 200; i += 1) {
        const p = randomPointInCircle(500, 500, 100, Math.random);
        expect(Math.hypot(p.x - 500, p.y - 500)).toBeLessThanOrEqual(100 + 1e-6);
      }
    });
    it('deterministic with injected rng (center at rng=0)', () => {
      const p = randomPointInCircle(0, 0, 100, () => 0);
      expect(p.x).toBeCloseTo(0);
      expect(p.y).toBeCloseTo(0);
    });
  });

  describe('captureProgressDelta (雙條件門控)', () => {
    it('在圈 且 無怪 → 推進 progressPerSec×dt', () => {
      expect(captureProgressDelta(true, 0, 12, 0.5)).toBeCloseTo(6);
    });
    it('在圈 但 有怪 → 停(0)', () => {
      expect(captureProgressDelta(true, 3, 12, 0.5)).toBe(0);
    });
    it('不在圈 → 停(0)', () => {
      expect(captureProgressDelta(false, 0, 12, 0.5)).toBe(0);
    });
    it('不倒退（永遠 >=0）', () => {
      expect(captureProgressDelta(false, 5, 12, 1)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('captureRingColor', () => {
    it('綠=在圈+無怪、黃=在圈有怪、灰=不在圈', () => {
      expect(captureRingColor(true, 0)).toBe('green');
      expect(captureRingColor(true, 2)).toBe('yellow');
      expect(captureRingColor(false, 0)).toBe('gray');
      expect(captureRingColor(false, 3)).toBe('gray');
    });
  });
});
