// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveGuardStatueUi, GUARD_STATUE_UI_DEFAULTS } from '@/config/guardConfig';
import { validateGuard, GUARD_SCHEMA_VERSION } from '@/config/guardSchema';

/**
 * resolveGuardStatueUi / validateGuard — 雕像血條 UI 的「同函式兩種相反 0-語意」鑑別補強
 *   （用戶第十輪#1#4，征騎 763da57 已補 8+3 測；本檔補征騎未涵蓋的鑑別缺口，背書見回報）。
 * ★核心辨析（異靈點名、我這輪主題）：同一組 UI 欄位內——
 *   - 尺寸欄 statueHeightPx/barWidthPx/barHeightPx：0/負 = 雕像消失/血條崩，validateGuard checkNumOptional{min:1} 擋。
 *   - 位移欄 barOffsetYPx/labelOffsetYPx：0=不偏移合法、負=往上合法，checkNumOptional{} 任意有限值過；resolve ?? 保留 0。
 * 征騎已測 barOffsetYPx=0 保留 + statueHeightPx<=0/barWidthPx 非數字擋。本檔補：
 *   - 每個尺寸欄各自 <=0 擋（barHeightPx、barWidthPx=0 征騎只測 statueHeight=0 + barWidth 非數字）。
 *   - 位移欄負值在 validate 明確過（跟尺寸負擋對照）。
 *   - resolve: labelOffsetYPx=0 也保留（征騎測 barOffset=0，補 label=0）。
 * 維度3 斷 validate ok/擋 + resolve 0 保留。
 */

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
function withUi(ui: Record<string, unknown>): unknown {
  const p = structuredClone(base);
  Object.assign(p.presets.G, ui);
  return p;
}

describe('resolveGuardStatueUi — 位移欄 0 保留補強（labelOffsetYPx=0）', () => {
  it('★ labelOffsetYPx=0 保留（?? 非 ||，0=不偏移合法，非退回預設 -80）', () => {
    const ui = resolveGuardStatueUi({ labelOffsetYPx: 0 });
    expect(ui.labelOffsetYPx).toBe(0); // ★ 0 保留（征騎測 barOffset=0，此補 label=0）
    expect(ui.barOffsetYPx).toBe(GUARD_STATUE_UI_DEFAULTS.barOffsetYPx); // 未覆蓋沿用
  });

  it('barOffsetYPx=負（往上）保留', () => {
    expect(resolveGuardStatueUi({ barOffsetYPx: -50 }).barOffsetYPx).toBe(-50);
  });
});

describe('validateGuard — ★同函式相反 0-語意：尺寸欄 0 擋 / 位移欄 0·負 過', () => {
  it('尺寸欄 barHeightPx=0 → 擋（征騎只測 statueHeight=0，補 barHeight）', () => {
    expect(validateGuard(withUi({ barHeightPx: 0 })).ok).toBe(false);
  });

  it('尺寸欄 barWidthPx=0 → 擋（min1；征騎測 barWidth 非數字，補 =0 邊界）', () => {
    expect(validateGuard(withUi({ barWidthPx: 0 })).ok).toBe(false);
  });

  it('尺寸欄 statueHeightPx=負 → 擋', () => {
    expect(validateGuard(withUi({ statueHeightPx: -10 })).ok).toBe(false);
  });

  it('尺寸欄 =1（剛好 min 下限）→ 過（min 含等於）', () => {
    expect(validateGuard(withUi({ statueHeightPx: 1, barWidthPx: 1, barHeightPx: 1 })).ok).toBe(true);
  });

  it('★ 位移欄 barOffsetYPx=0 → 過（跟尺寸 0 擋相反！0 是合法位移）', () => {
    expect(validateGuard(withUi({ barOffsetYPx: 0 })).ok).toBe(true);
  });

  it('★ 位移欄 labelOffsetYPx=負(-300) → 過（負位移合法，跟尺寸負擋相反）', () => {
    expect(validateGuard(withUi({ labelOffsetYPx: -300 })).ok).toBe(true);
  });

  it('★ 對照鎖死：同一 preset 尺寸=0 擋 vs 位移=0 過（同函式兩種相反 0-語意並存）', () => {
    // 尺寸 0 → 擋。
    expect(validateGuard(withUi({ barWidthPx: 0 })).ok).toBe(false);
    // 位移 0 → 過。兩者若共用同一 min 規則就會有一邊錯 → 證明尺寸/位移各用不同 checkNumOptional opts。
    expect(validateGuard(withUi({ barOffsetYPx: 0, labelOffsetYPx: 0 })).ok).toBe(true);
  });
});
