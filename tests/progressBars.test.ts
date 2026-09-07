import { describe, expect, it } from 'vitest';
import {
  NODE_COLORS,
  PROGRESS_BAR,
  PROGRESS_HIDE_MARGIN,
  barLeftX,
  barWidth,
  guardTimeRatio,
  levelProgressRatio,
  nodeIconKind,
  nodeMarkerState,
  nodeMarkerX,
  progressHideLocalY,
  segmentFill,
  shouldPulse,
} from '@/systems/progressBars';
import { resolveProgressTransform } from '@/config/uiConfig';

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

  it('nodeMarkerX：兩端分佈（首=barLeftX最左、尾=barLeftX+barWidth最右、等距 barWidth/(total-1)）', () => {
    // #2 公式改：barLeftX + i/(total-1)×barWidth（i=0 最左、i=total-1 最右）。
    const total = 4;
    const left = barLeftX(total, 960);
    const w = barWidth(total);
    const xs = [0, 1, 2, 3].map((i) => nodeMarkerX(i, total, 960));
    // 遞增。
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    // 首節點 = barLeftX（最左端）、尾節點 = barLeftX + barWidth（最右端）。
    expect(xs[0]).toBeCloseTo(left);
    expect(xs[3]).toBeCloseTo(left + w);
    // 等距 = barWidth/(total-1)。
    const step = w / (total - 1);
    expect(xs[1] - xs[0]).toBeCloseTo(step);
    expect(xs[3] - xs[2]).toBeCloseTo(step);
    // 整體對稱於 centerX（首+尾中點=centerX）。
    expect((xs[0] + xs[3]) / 2).toBeCloseTo(960);
  });

  it('nodeMarkerX：單節點(total<=1) 置中防除0（回 barLeftX + barWidth/2）', () => {
    expect(nodeMarkerX(0, 1, 960)).toBeCloseTo(barLeftX(1, 960) + barWidth(1) / 2);
    expect(Number.isNaN(nodeMarkerX(0, 1, 960))).toBe(false); // 不除0爆 NaN
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

  it('★ #6 NODE_COLORS 字面值：past=黃(0xfff24d)、current=白(0xffffff)、future=暗(0x595959)', () => {
    // 用戶#6：觸發過的節點「一直維持黃」→ past 硬斷黃(0xfff24d)，別回青(0x4dd9ff)。
    expect(NODE_COLORS.past).toBe(0xfff24d); // 已過維持黃
    expect(NODE_COLORS.current).toBe(0xffffff); // 當前白
    expect(NODE_COLORS.future).toBe(0x595959); // 未到暗
  });

  it('★ #6 節點染色：i<cur→黃、i==cur→白、i>cur→暗（nodeMarkerState→NODE_COLORS 對應）', () => {
    const cur = 2;
    const colorOf = (i: number) => {
      const st = nodeMarkerState(i, cur);
      return st === 'past' ? NODE_COLORS.past : st === 'current' ? NODE_COLORS.current : NODE_COLORS.future;
    };
    expect(colorOf(1)).toBe(0xfff24d); // 已過→黃
    expect(colorOf(2)).toBe(0xffffff); // 當前→白
    expect(colorOf(3)).toBe(0x595959); // 未到→暗
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

describe('progressBars — shouldPulse（#7 脈動「下一顆」cur+1 預告即將觸發）', () => {
  // 六輪#7(781c58a) behavior change：脈動從「當前節點 index===cur」改為「下一顆 index===cur+1」
  //（對照 Unity LevelProgressUI，預告即將觸發的下一節點）。cur=2 → 脈動格 = index 3。
  it('★ 下一顆（index===cur+1）且 段進度 > 0.75 → true（預告即將觸發）', () => {
    expect(shouldPulse(3, 2, 0.8)).toBe(true); // cur+1=3
    expect(shouldPulse(3, 2, 0.76)).toBe(true);
  });

  it('下一顆 但 段進度 <= 0.75 → false（未快滿不預告）', () => {
    expect(shouldPulse(3, 2, 0.3)).toBe(false);
    expect(shouldPulse(3, 2, 0.75)).toBe(false); // 邊界不含
  });

  it('★ 當前節點（index===cur）→ false（不再脈動當前，改脈動下一顆）', () => {
    expect(shouldPulse(2, 2, 0.9)).toBe(false); // 當前不脈動
    expect(shouldPulse(2, 2, 0.8)).toBe(false);
  });

  it('非「下一顆」的其他 index → false（已過/更遠都不脈動）', () => {
    expect(shouldPulse(1, 2, 0.9)).toBe(false); // 已過
    expect(shouldPulse(4, 2, 0.9)).toBe(false); // cur+2 更遠
    expect(shouldPulse(0, 2, 0.9)).toBe(false);
  });
});

/**
 * bug 修：進度條套整體變換(scale/offset)後，守護波滑走收起要「完整」移出畫面頂端
 * ——不論調到哪個位置/縮放，收起目標的螢幕最低點都要 ≤ 0（不殘留半條）。
 * screenY(收起) = posY + (hideLocalY + nodeRadiusCurrent) * scale，須 ≤ -PROGRESS_HIDE_MARGIN。
 */
describe('progressHideLocalY — 收起完整移出畫面（xform 反推）', () => {
  const bottomScreenY = (scale: number, posY: number) =>
    posY + (progressHideLocalY(scale, posY) + PROGRESS_BAR.nodeRadiusCurrent) * scale;

  it('★預設（scale1/offset0）收起後 bar 最低點螢幕 Y ≤ -margin（完整移出頂端）', () => {
    const t = resolveProgressTransform(undefined);
    expect(bottomScreenY(t.scale, t.posY)).toBeLessThanOrEqual(-PROGRESS_HIDE_MARGIN + 1e-6);
  });

  it('★移到下方（offsetY 大正值）仍完整收起（原固定滑走會殘留，這裡不能殘留）', () => {
    // 進度條往下挪 +400：舊固定 160 上滑遠不夠；反推版本必須仍收乾淨。
    const t = resolveProgressTransform({ progressOffsetY: 400 });
    expect(bottomScreenY(t.scale, t.posY)).toBeLessThanOrEqual(-PROGRESS_HIDE_MARGIN + 1e-6);
  });

  it('★縮小（scale 0.5）+挪位仍完整收起', () => {
    const t = resolveProgressTransform({ progressScale: 0.5, progressOffsetX: -300, progressOffsetY: 200 });
    expect(bottomScreenY(t.scale, t.posY)).toBeLessThanOrEqual(-PROGRESS_HIDE_MARGIN + 1e-6);
  });

  it('★放大（scale 1.5）也完整收起', () => {
    const t = resolveProgressTransform({ progressScale: 1.5, progressOffsetY: 100 });
    expect(bottomScreenY(t.scale, t.posY)).toBeLessThanOrEqual(-PROGRESS_HIDE_MARGIN + 1e-6);
  });

  it('scale 0（極端）不炸（夾正防除零）', () => {
    expect(Number.isFinite(progressHideLocalY(0, 96))).toBe(true);
  });

  it('🔴 壞版對照：舊固定滑走（shownY - slideHideOffsetY）在移到下方時收不乾淨', () => {
    // 舊邏輯 localY 固定，套 offsetY+400 後 bar 螢幕最低點仍 > 0（殘留）→ 證明需要反推修正。
    const posY = resolveProgressTransform({ progressOffsetY: 400 }).posY;
    const oldLocalY = PROGRESS_BAR.shownY - PROGRESS_BAR.slideHideOffsetY;
    const oldBottom = posY + (oldLocalY + PROGRESS_BAR.nodeRadiusCurrent) * 1;
    expect(oldBottom).toBeGreaterThan(0); // 舊版殘留（bug）
  });
});
