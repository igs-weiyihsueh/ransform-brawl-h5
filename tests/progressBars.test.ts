import { describe, expect, it } from 'vitest';
import {
  NODE_COLORS,
  PROGRESS_BAR,
  barLeftX,
  barWidth,
  guardTimeRatio,
  levelProgressRatio,
  nodeIconKind,
  nodeMarkerState,
  nodeMarkerX,
  segmentFill,
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

  it('佈局參數合理（珠串結構：perNodeWidth/nodeRadius/barHeight/guard.height > 0，#2 重組）', () => {
    // #2 結構從 {level:{x,y,width,height}} 改成珠串佈局 — 驗新結構欄位。
    expect(PROGRESS_BAR.perNodeWidth).toBeGreaterThan(0);
    expect(PROGRESS_BAR.centerX).toBeGreaterThan(0);
    expect(PROGRESS_BAR.nodeRadius).toBeGreaterThan(0);
    expect(PROGRESS_BAR.nodeRadiusCurrent).toBeGreaterThan(PROGRESS_BAR.nodeRadius); // 當前放大
    expect(PROGRESS_BAR.barHeight).toBeGreaterThan(0);
    expect(PROGRESS_BAR.guard.width).toBeGreaterThan(0);
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

// ===========================================================================
// #2 珠子串繩節點條佈局純函式（barWidth/barLeftX/nodeMarkerX/segmentFill/state/iconKind）。
// 維度3 斷實際數值/分類（座標、狀態、icon key），非 call-count。純視覺畫 marker/染色不補。
// ===========================================================================
describe('progressBars — 珠串佈局座標', () => {
  it('barWidth = 節點數 × perNodeWidth（total<=0 → 0 防呆）', () => {
    expect(barWidth(4)).toBe(4 * PROGRESS_BAR.perNodeWidth);
    expect(barWidth(0)).toBe(0);
    expect(barWidth(-3)).toBe(0);
  });

  it('barLeftX = centerX - barWidth/2（以 centerX 置中）', () => {
    const total = 4;
    expect(barLeftX(total, 960)).toBe(960 - (4 * PROGRESS_BAR.perNodeWidth) / 2);
    // 對稱：左緣 + barWidth = 右緣，中點 = centerX。
    const mid = barLeftX(total, 960) + barWidth(total) / 2;
    expect(mid).toBeCloseTo(960);
  });

  it('nodeMarkerX：首節點最左、尾節點最右、等距遞增（(i+0.5)×perNodeWidth + left）', () => {
    const total = 4;
    const xs = [0, 1, 2, 3].map((i) => nodeMarkerX(i, total, 960));
    // 遞增。
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    // 等距 = perNodeWidth。
    expect(xs[1] - xs[0]).toBeCloseTo(PROGRESS_BAR.perNodeWidth);
    expect(xs[3] - xs[2]).toBeCloseTo(PROGRESS_BAR.perNodeWidth);
    // 首節點 = left + 0.5×perNodeWidth；尾 = left + (total-0.5)×perNodeWidth。
    const left = barLeftX(total, 960);
    expect(xs[0]).toBeCloseTo(left + 0.5 * PROGRESS_BAR.perNodeWidth);
    expect(xs[3]).toBeCloseTo(left + 3.5 * PROGRESS_BAR.perNodeWidth);
    // 整體對稱於 centerX（首+尾中點=centerX）。
    expect((xs[0] + xs[3]) / 2).toBeCloseTo(960);
  });
});

describe('progressBars — 節點狀態 / 段填充 / icon 類型', () => {
  it('nodeMarkerState：index<current=past、==current=current、>current=future；current 唯一', () => {
    const cur = 2;
    expect(nodeMarkerState(0, cur)).toBe('past');
    expect(nodeMarkerState(1, cur)).toBe('past');
    expect(nodeMarkerState(2, cur)).toBe('current');
    expect(nodeMarkerState(3, cur)).toBe('future');
    // current 唯一：0..4 中只有一個 == cur。
    const states = [0, 1, 2, 3, 4].map((i) => nodeMarkerState(i, cur));
    expect(states.filter((s) => s === 'current').length).toBe(1);
    // 三態各有對應色（結構完整）。
    expect(NODE_COLORS.past).not.toBe(NODE_COLORS.future);
    expect(NODE_COLORS.current).not.toBe(NODE_COLORS.past);
  });

  it('segmentFill：已過段=1、未來段=0、當前段=segmentRatio（隨進度）', () => {
    const cur = 2;
    expect(segmentFill(0, cur, 0.5)).toBe(1); // 段0(節點0→1)完全已過
    expect(segmentFill(1, cur, 0.5)).toBe(1); // 段1(節點1→2)已過
    expect(segmentFill(2, cur, 0.4)).toBeCloseTo(0.4); // 當前段隨進度
    expect(segmentFill(3, cur, 0.9)).toBe(0); // 未來段
  });

  it('segmentFill 當前段隨 segmentRatio 遞增（走越多填越亮）+ clamp 0..1', () => {
    const cur = 1;
    expect(segmentFill(1, cur, 0.2)).toBeLessThan(segmentFill(1, cur, 0.8)); // 遞增
    expect(segmentFill(1, cur, -1)).toBe(0); // clamp 下限
    expect(segmentFill(1, cur, 2)).toBe(1); // clamp 上限
  });

  it('nodeIconKind：Reward→reward、Event→event、其他/未定義→spawn', () => {
    expect(nodeIconKind('Reward')).toBe('reward');
    expect(nodeIconKind('Event')).toBe('event');
    expect(nodeIconKind('Spawn')).toBe('spawn');
    expect(nodeIconKind(undefined)).toBe('spawn'); // 防呆預設
    expect(nodeIconKind('隨便')).toBe('spawn');
  });
});
