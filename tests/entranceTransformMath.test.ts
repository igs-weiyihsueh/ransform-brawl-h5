import { describe, expect, it } from 'vitest';
import {
  floatOffsetY,
  isFloatDone,
  shouldTransformDuringFloat,
  isInKnockbackRange,
  ENTRANCE_TRANSFORM,
  ENTRANCE_KNOCKBACK_RADIUS_PX,
} from '@/systems/entranceTransformMath';
import { PPU } from '@/config/gameConfig';

/**
 * entranceTransformMath — 投幣變身進場表演純邏輯（浮起時序/變身時機/落地震退範圍）。
 */
describe('floatOffsetY — 浮起 Y 位移（往上 ease-out）', () => {
  it('elapsed=0 → 0（起點不動）', () => {
    expect(floatOffsetY(0, 0.6, 0.6)).toBeCloseTo(0, 6);
  });
  it('elapsed>=floatSec → 停最高點 -riseUnits×PPU（往上）', () => {
    expect(floatOffsetY(0.6, 0.6, 0.6)).toBeCloseTo(-0.6 * PPU, 3);
    expect(floatOffsetY(999, 0.6, 0.6)).toBeCloseTo(-0.6 * PPU, 3);
  });
  it('中途單調往上（負且遞減）+ ease-out（前段升快）', () => {
    const a = floatOffsetY(0.15, 0.6, 0.6);
    const b = floatOffsetY(0.3, 0.6, 0.6);
    const c = floatOffsetY(0.45, 0.6, 0.6);
    expect(a).toBeLessThan(0);
    expect(b).toBeLessThan(a); // 越晚位移越大（更往上）
    expect(c).toBeLessThan(b);
    // ease-out：前 25% 時間的升幅 > 後 25%（減速）。
    const first = Math.abs(a - floatOffsetY(0, 0.6, 0.6));
    const last = Math.abs(floatOffsetY(0.6, 0.6, 0.6) - floatOffsetY(0.45, 0.6, 0.6));
    expect(first).toBeGreaterThan(last);
  });
  it('floatSec<=0 → 直接最高點（防除零）', () => {
    expect(floatOffsetY(0, 0, 0.6)).toBeCloseTo(-0.6 * PPU, 3);
  });
});

describe('isFloatDone / shouldTransformDuringFloat — 時序', () => {
  it('isFloatDone：elapsed>=floatSec', () => {
    expect(isFloatDone(0.6, 0.6)).toBe(true);
    expect(isFloatDone(0.59, 0.6)).toBe(false);
  });
  it('★shouldTransformDuringFloat：進度達 transformAtProgress 才變身', () => {
    // at=0.85, floatSec=0.6 → 0.51s
    expect(shouldTransformDuringFloat(0.5, 0.6, 0.85)).toBe(false);
    expect(shouldTransformDuringFloat(0.51, 0.6, 0.85)).toBe(true);
    expect(shouldTransformDuringFloat(0.6, 0.6, 0.85)).toBe(true);
  });
  it('floatSec<=0 → 立即變身', () => {
    expect(shouldTransformDuringFloat(0, 0, 0.85)).toBe(true);
  });
});

describe('isInKnockbackRange — 落地震退範圍', () => {
  const land = { x: 500, y: 300 };
  it('範圍內 → true；範圍外 → false', () => {
    const r = ENTRANCE_KNOCKBACK_RADIUS_PX; // 2.0×PPU=200
    expect(isInKnockbackRange({ x: 500 + r - 1, y: 300 }, land, r)).toBe(true);
    expect(isInKnockbackRange({ x: 500 + r + 1, y: 300 }, land, r)).toBe(false);
    expect(isInKnockbackRange({ x: 500, y: 300 }, land, r)).toBe(true); // 同點
  });
  it('對角距離用歐氏（非曼哈頓）', () => {
    const r = 100;
    // (60,80) 距離=100=邊界(不>r→true)
    expect(isInKnockbackRange({ x: 560, y: 380 }, land, r)).toBe(true);
    // (80,80) 距離≈113>100→false
    expect(isInKnockbackRange({ x: 580, y: 380 }, land, r)).toBe(false);
  });
  it('config 健全：floatSec>0、rise/radius/dist>0', () => {
    expect(ENTRANCE_TRANSFORM.floatSec).toBeGreaterThan(0);
    expect(ENTRANCE_TRANSFORM.floatRiseUnits).toBeGreaterThan(0);
    expect(ENTRANCE_TRANSFORM.knockbackRadiusUnits).toBeGreaterThan(0);
    expect(ENTRANCE_TRANSFORM.knockbackDistUnits).toBeGreaterThan(0);
    expect(ENTRANCE_TRANSFORM.transformAtProgress).toBeGreaterThan(0);
    expect(ENTRANCE_TRANSFORM.transformAtProgress).toBeLessThanOrEqual(1);
  });
});
