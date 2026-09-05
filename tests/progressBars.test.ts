import { describe, expect, it } from 'vitest';
import {
  PROGRESS_BAR,
  guardTimeRatio,
  levelProgressRatio,
} from '@/systems/progressBars';

/**
 * 進度條純比例（#7）測試：關卡進度 done/total、守護波倒數 remaining/timeLimit。含壞版必紅。
 */
describe('progressBars — 進度/倒數比例', () => {
  it('關卡進度：nodeIndex/total，0..1 clamp', () => {
    expect(levelProgressRatio(0, 4)).toBe(0);
    expect(levelProgressRatio(2, 4)).toBe(0.5);
    expect(levelProgressRatio(4, 4)).toBe(1);
    expect(levelProgressRatio(5, 4)).toBe(1); // clamp 上限
  });

  it('關卡進度：total<=0 → 0（防呆）', () => {
    expect(levelProgressRatio(1, 0)).toBe(0);
  });

  it('守護波倒數：remaining/timeLimit，0..1 clamp', () => {
    expect(guardTimeRatio(60, 60)).toBe(1);
    expect(guardTimeRatio(30, 60)).toBe(0.5);
    expect(guardTimeRatio(0, 60)).toBe(0);
    expect(guardTimeRatio(-5, 60)).toBe(0); // clamp 下限
  });

  it('守護波倒數：timeLimit<=0 → 0（防呆）', () => {
    expect(guardTimeRatio(10, 0)).toBe(0);
  });

  it('佈局參數合理（兩條 width/height > 0）', () => {
    expect(PROGRESS_BAR.level.width).toBeGreaterThan(0);
    expect(PROGRESS_BAR.guard.height).toBeGreaterThan(0);
  });

  // 🔴 壞版對照：進度必須隨 nodeIndex 遞增（不同進度不同比例）。
  it('壞版對照：進度隨完成節點遞增', () => {
    expect(levelProgressRatio(1, 4)).toBeLessThan(levelProgressRatio(3, 4));
  });

  // 🔴 壞版對照：倒數比例隨 remaining 遞減（時間扣 → 條變短）。
  it('壞版對照：倒數隨剩餘時間遞減', () => {
    expect(guardTimeRatio(50, 60)).toBeGreaterThan(guardTimeRatio(10, 60));
  });
});
