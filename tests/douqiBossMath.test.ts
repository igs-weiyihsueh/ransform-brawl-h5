import { describe, it, expect } from 'vitest';
import { bossFillProgress, circleHit, fanHit, halfFieldHit, halfFieldFills, bossMaxHp } from '@/systems/douqiBossMath';

describe('douqiBossMath', () => {
  describe('bossFillProgress', () => {
    it('clamps 0→1', () => {
      expect(bossFillProgress(0, 4000)).toBe(0);
      expect(bossFillProgress(2000, 4000)).toBe(0.5);
      expect(bossFillProgress(5000, 4000)).toBe(1);
    });
  });

  describe('circleHit (招 a)', () => {
    const boss = { x: 500, y: 500 };
    it('圈內命中 / 圈外不中', () => {
      expect(circleHit(boss, { x: 600, y: 500 }, 20, 260)).toBe(true); // 距100<260
      expect(circleHit(boss, { x: 800, y: 500 }, 20, 260)).toBe(false); // 距300>260+20
      expect(circleHit(boss, { x: 500 + 275, y: 500 }, 20, 260)).toBe(true); // 275<=260+20 邊界
    });
  });

  describe('fanHit (招 c, 250° 大扇形留 110° 缺口)', () => {
    const boss = { x: 500, y: 500 };
    it('瞄右(0°)扇形內命中、缺口(180°背面)不中', () => {
      // aimDeg=0, arc250 → ±125°；玩家在 0° 命中、在 180°(diff 180>125)不中
      expect(fanHit(boss, { x: 700, y: 500 }, 20, 0, 250, 500)).toBe(true);
      expect(fanHit(boss, { x: 300, y: 500 }, 20, 0, 250, 500)).toBe(false); // 正背面缺口
    });
    it('距離外不中', () => {
      expect(fanHit(boss, { x: 500 + 600, y: 500 }, 20, 0, 250, 500)).toBe(false);
    });
    it('缺口寬 110°：偏離瞄準 >125° 才安全', () => {
      // 130° 方向→diff 130>125→缺口安全
      const a = (130 * Math.PI) / 180;
      expect(fanHit(boss, { x: 500 + Math.cos(a) * 200, y: 500 + Math.sin(a) * 200 }, 20, 0, 250, 500)).toBe(false);
      // 120°→diff 120<=125→命中
      const a2 = (120 * Math.PI) / 180;
      expect(fanHit(boss, { x: 500 + Math.cos(a2) * 200, y: 500 + Math.sin(a2) * 200 }, 20, 0, 250, 500)).toBe(true);
    });
  });

  describe('halfFieldHit (招 d)', () => {
    it('左半 / 右半判定', () => {
      expect(halfFieldHit(500, 400, 'left')).toBe(true);
      expect(halfFieldHit(500, 600, 'left')).toBe(false);
      expect(halfFieldHit(500, 600, 'right')).toBe(true);
      expect(halfFieldHit(500, 400, 'right')).toBe(false);
    });
  });

  describe('halfFieldFills (d 左右接力, overlap0.5)', () => {
    it('左半先 fill、右半延遲 fillMs×overlap 才起', () => {
      // fillMs4000 overlap0.5 → 右半在 2000ms 才開始
      const at2000 = halfFieldFills(2000, 4000, 0.5);
      expect(at2000.leftFill).toBeCloseTo(0.5);
      expect(at2000.rightFill).toBeCloseTo(0); // 2000-2000=0
      const at4000 = halfFieldFills(4000, 4000, 0.5);
      expect(at4000.leftFill).toBe(1); // 左滿
      expect(at4000.rightFill).toBeCloseTo(0.5); // 右到一半
      const at6000 = halfFieldFills(6000, 4000, 0.5);
      expect(at6000.rightFill).toBe(1); // 右滿
    });
  });

  describe('bossMaxHp', () => {
    it('base×序號成長×等級 scale', () => {
      expect(bossMaxHp(3000, 1, 0.15, 1)).toBe(3000); // 第1隻 Lv 滿
      expect(bossMaxHp(3000, 2, 0.15, 1)).toBe(Math.round(3000 * 1.15)); // 第2隻 +15%
      expect(bossMaxHp(3000, 1, 0.15, 0.35)).toBe(Math.round(3000 * 0.35)); // Lv1 scale
    });
  });
});
