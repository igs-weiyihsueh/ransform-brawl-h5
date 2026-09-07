import { describe, expect, it } from 'vitest';
import {
  TWO_PI,
  darkSweepAngle,
  darkWedgeArc,
  isDashRecharging,
} from '@/systems/dashChargeDisplay';

/**
 * dashChargeDisplay — 衝刺「衝」圖示冷卻壓黑動畫純幾何（用戶新系統）。
 * 逆時針徑向消去壓黑：progress 0=全壓黑整圈、1=壓黑消完。含壞版對照。
 */
describe('darkSweepAngle — 剩餘壓黑掃掠角', () => {
  it('progress 0 → 全壓黑（整圈 2π）', () => {
    expect(darkSweepAngle(0)).toBeCloseTo(TWO_PI, 6);
  });
  it('progress 1 → 壓黑消完（0）', () => {
    expect(darkSweepAngle(1)).toBeCloseTo(0, 6);
  });
  it('progress 0.5 → 半圈壓黑（π）', () => {
    expect(darkSweepAngle(0.5)).toBeCloseTo(Math.PI, 6);
  });
  it('progress 越大壓黑越少（單調遞減）', () => {
    expect(darkSweepAngle(0.2)).toBeGreaterThan(darkSweepAngle(0.8));
  });
  it('超範圍 clamp（<0 當 0 全黑、>1 當 1 無黑）', () => {
    expect(darkSweepAngle(-1)).toBeCloseTo(TWO_PI, 6);
    expect(darkSweepAngle(2)).toBeCloseTo(0, 6);
  });
});

describe('darkWedgeArc — 壓黑楔形逆時針消去', () => {
  it('從正上方(-90°)起、逆時針(anticlockwise)掃', () => {
    const a = darkWedgeArc(0.3);
    expect(a.startAngle).toBeCloseTo(-Math.PI / 2, 6);
    expect(a.anticlockwise).toBe(true);
  });
  it('progress 0（全黑）→ 掃滿整圈（起訖差 = 2π）', () => {
    const a = darkWedgeArc(0);
    expect(Math.abs(a.startAngle - a.endAngle)).toBeCloseTo(TWO_PI, 6);
  });
  it('progress 1（消完）→ 掃 0（起=訖）', () => {
    const a = darkWedgeArc(1);
    expect(Math.abs(a.startAngle - a.endAngle)).toBeCloseTo(0, 6);
  });
  it('🔴 壞版對照：progress↑ 壓黑掃角必須變小（消去而非增加）', () => {
    const lo = darkWedgeArc(0.2);
    const hi = darkWedgeArc(0.8);
    expect(Math.abs(lo.startAngle - lo.endAngle)).toBeGreaterThan(
      Math.abs(hi.startAngle - hi.endAngle),
    );
  });
});

describe('isDashRecharging — 是否有格在回充', () => {
  it('charges < max → 回充中（true）', () => {
    expect(isDashRecharging(0, 3)).toBe(true);
    expect(isDashRecharging(2, 3)).toBe(true);
  });
  it('charges == max → 滿格不回充（false）', () => {
    expect(isDashRecharging(3, 3)).toBe(false);
  });
});
