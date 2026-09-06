// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveGuardStatueUi, GUARD_STATUE_UI_DEFAULTS } from '@/config/guardConfig';
import { validateGuard, GUARD_SCHEMA_VERSION } from '@/config/guardSchema';

/**
 * 雕像/血條 UI 開放（用戶第十輪#1#4，additive）：
 *  1. resolveGuardStatueUi(preset)：optional 欄位 ?? 預設（0-nullish 安全，offset 可 0/負）。
 *  2. #1 血條放大＝預設值調大（barWidthPx 160、barHeightPx 16；原 hardcode 100/12-10）。
 *  3. validateGuard — 新 optional 欄位（省略合法用預設、有給檢型別/範圍；尺寸>0、offset 任意）。
 * 維度3 斷解析值/預設/validate 過擋。含壞版必紅（★0-nullish / 覆蓋生效 / 省略沿用 / 尺寸<=0 擋）。
 */
describe('resolveGuardStatueUi — 雕像/血條 UI 逐欄 ?? 預設', () => {
  it('全省略 → 全用打包預設（#1 血條放大：barWidth 160、barHeight 16）', () => {
    const ui = resolveGuardStatueUi({});
    expect(ui).toEqual({
      statueHeightPx: 150,
      barWidthPx: 160,
      barHeightPx: 16,
      barOffsetYPx: 90,
      labelOffsetYPx: -80,
    });
    expect(ui.barWidthPx).toBe(GUARD_STATUE_UI_DEFAULTS.barWidthPx);
  });

  it('#1 血條放大：預設 barWidthPx(160) > 舊 hardcode 100', () => {
    expect(GUARD_STATUE_UI_DEFAULTS.barWidthPx).toBeGreaterThan(100);
    expect(GUARD_STATUE_UI_DEFAULTS.barHeightPx).toBeGreaterThan(12);
  });

  it('#4 雕像大小可 override：statueHeightPx 調大 → 解析值跟著大', () => {
    expect(resolveGuardStatueUi({ statueHeightPx: 300 }).statueHeightPx).toBe(300);
  });

  it('逐欄覆蓋、未覆蓋沿用預設', () => {
    const ui = resolveGuardStatueUi({ barWidthPx: 240, labelOffsetYPx: -120 });
    expect(ui.barWidthPx).toBe(240);
    expect(ui.labelOffsetYPx).toBe(-120);
    expect(ui.statueHeightPx).toBe(150); // 未覆蓋沿用
    expect(ui.barHeightPx).toBe(16);
  });

  it('★0-nullish 安全：barOffsetYPx=0 / labelOffsetYPx=負 不被 || 吃掉', () => {
    const ui = resolveGuardStatueUi({ barOffsetYPx: 0, labelOffsetYPx: -200 });
    expect(ui.barOffsetYPx).toBe(0); // 0 是合法值，非退回預設 90
    expect(ui.labelOffsetYPx).toBe(-200);
  });
});

describe('validateGuard — 雕像/血條 UI optional 欄位', () => {
  const base = {
    version: GUARD_SCHEMA_VERSION,
    presets: {
      G: {
        timeLimit: 60, targetHP: 100, rewardTickets: 10, maxAlive: 6,
        spawnThreshold: 4, spawnInterval: 1, spawnRadiusPx: 350,
        cornerOffsetXPx: 150, cornerOffsetYPx: 150, introFocusSec: 1.6,
        maxWalkSec: 3.5, spotlightRadiusPx: 200,
        spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }],
      },
    },
  };

  it('省略 UI 欄位 → 驗證通過（用預設）', () => {
    expect(validateGuard(base).ok).toBe(true);
  });

  it('有給合法 UI 欄位（含 offset=0/負）→ 通過', () => {
    const p = structuredClone(base);
    Object.assign(p.presets.G, { statueHeightPx: 300, barWidthPx: 200, barHeightPx: 20, barOffsetYPx: 0, labelOffsetYPx: -100 });
    expect(validateGuard(p).ok).toBe(true);
  });

  it('★壞版：statueHeightPx<=0 / barWidthPx 非數字 → 擋', () => {
    const p1 = structuredClone(base);
    Object.assign(p1.presets.G, { statueHeightPx: 0 });
    expect(validateGuard(p1).ok).toBe(false);
    const p2 = structuredClone(base);
    Object.assign(p2.presets.G, { barWidthPx: 'big' });
    expect(validateGuard(p2).ok).toBe(false);
  });
});
