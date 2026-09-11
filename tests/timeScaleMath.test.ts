import { describe, expect, it } from 'vitest';
import { multiplyScales, shakeDecay, type TimeScaleLayer } from '@/systems/timeScaleMath';

/**
 * 全域時間縮放 + shake 衰減純函式測試（第 4 塊）。含壞版對照。
 * ★核心：預設無層＝1.0（byte 同現況、不破測）。
 */

describe('multiplyScales — 加性乘法層', () => {
  it('空 map → 1.0（★現況：無層＝原速、不破測）', () => {
    expect(multiplyScales(new Map())).toBe(1);
  });
  it('單層 0.5 → 0.5（半速）', () => {
    expect(multiplyScales(new Map<TimeScaleLayer, number>([['code', 0.5]]))).toBe(0.5);
  });
  it('多層相乘：0.5×0.5 = 0.25', () => {
    expect(multiplyScales(new Map<TimeScaleLayer, number>([['system', 0.5], ['code', 0.5]]))).toBe(0.25);
  });
  it('任一層 0 → 0（全凍，如 hitstop/Stop）', () => {
    expect(multiplyScales(new Map<TimeScaleLayer, number>([['director', 1], ['code', 0]]))).toBe(0);
  });
  it('全 1.0 層 → 1.0（★等同現況，不影響 dt）', () => {
    expect(multiplyScales(new Map<TimeScaleLayer, number>([['system', 1], ['director', 1], ['code', 1]]))).toBe(1);
  });
});

describe('shakeDecay — shake 衰減 [0,1]', () => {
  it('t=0 → 1（滿強度）', () => {
    expect(shakeDecay(0, 0.25)).toBe(1);
  });
  it('t=dur → 0（結束）', () => {
    expect(shakeDecay(0.25, 0.25)).toBe(0);
  });
  it('t=半程 → 0.5（線性）', () => {
    expect(shakeDecay(0.125, 0.25)).toBeCloseTo(0.5);
  });
  it('t>dur → 0（不為負）', () => {
    expect(shakeDecay(0.5, 0.25)).toBe(0);
  });
  it('dur<=0 → 0（防除零）', () => {
    expect(shakeDecay(0, 0)).toBe(0);
  });
});
