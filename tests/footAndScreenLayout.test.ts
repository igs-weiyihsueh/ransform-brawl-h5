// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateUiLayout, DEFAULT_UI_LAYOUT } from '@/config/uiLayoutSchema';
import { resolveFoot, FOOT_GLOW } from '@/config/playerConfig';

/**
 * #5#8 開放調整（用戶三輪最後一項，翼騎整合波騎 c48061e）：
 *  A. validateScreen 擴充 — screen 加 eventMessage/fireRainMessage（皆 optional additive，存在才驗）。
 *  B. validateFoot（新 foot section）— 搜索圈=真空帶，searchRadiusPx>0、offset 數字，optional additive。
 *  C. resolveFoot（讀取端 fallback）— layout.foot 覆蓋、缺欄位 fallback FOOT_GLOW；★offsetY=0 用 ?? 不被吃(同#6 0-nullish)。
 * 皆經公開入口 validateUiLayout / 純函式 resolveFoot。維度3 斷過/擋/值。含壞版必紅。
 * ⚠️ ui-editor 互動屬波騎不補、EffectSystem 讀取定位屬狀態機不補(翼騎 headless 驗 foot=90 生效);
 *    validateScreen/validateFoot/resolveFoot 純驗證/純函式補足。
 */
function base(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(DEFAULT_UI_LAYOUT)) as Record<string, unknown>;
}
function errorsOf(file: unknown): string[] {
  const r = validateUiLayout(file);
  return r.ok ? [] : r.errors;
}
function mentions(errs: string[], token: string): boolean {
  return errs.some((e) => e.includes(token));
}
const goodEl = { x: 0, y: 100, width: 640, height: 90, align: 'center' as const };

describe('A. validateScreen 擴充 — eventMessage / fireRainMessage（optional additive）', () => {
  it('三訊息齊（waveMessage+eventMessage+fireRainMessage 皆合法）→ 過', () => {
    const f = base();
    f.screen = { waveMessage: { ...goodEl }, eventMessage: { ...goodEl }, fireRainMessage: { ...goodEl } };
    expect(validateUiLayout(f).ok).toBe(true);
  });

  it('只 waveMessage（event/fireRain 省略）→ 過（存在才驗）', () => {
    const f = base();
    f.screen = { waveMessage: { ...goodEl } };
    expect(validateUiLayout(f).ok).toBe(true);
  });

  it('★ 無 screen（舊 JSON）→ 過（additive 相容，續守凍結）', () => {
    const f = base();
    delete f.screen;
    expect(validateUiLayout(f).ok).toBe(true);
  });

  it('eventMessage 缺 width → 擋', () => {
    const f = base();
    const em: Record<string, unknown> = { ...goodEl };
    delete em.width;
    f.screen = { waveMessage: { ...goodEl }, eventMessage: em };
    expect(mentions(errorsOf(f), 'eventMessage')).toBe(true);
  });

  it('★ fireRainMessage bad align → 擋', () => {
    const f = base();
    f.screen = { waveMessage: { ...goodEl }, fireRainMessage: { ...goodEl, align: 'middle' } };
    const errs = errorsOf(f);
    expect(mentions(errs, 'fireRainMessage')).toBe(true);
    expect(mentions(errs, 'align')).toBe(true);
  });
});

describe('B. validateFoot — 搜索圈/真空帶 foot section（optional additive）', () => {
  it('合法 foot（searchRadiusPx>0、offset 數字）→ 過', () => {
    const f = base();
    f.foot = { searchRadiusPx: 90, offsetX: 0, offsetY: 75 };
    expect(validateUiLayout(f).ok).toBe(true);
  });

  it('★ 無 foot（舊 JSON）→ 過（additive 相容）', () => {
    const f = base();
    delete f.foot;
    expect(validateUiLayout(f).ok).toBe(true);
    expect(mentions(errorsOf(f), 'foot')).toBe(false);
  });

  it('searchRadiusPx <= 0 → 擋（0 或負，半徑必正）', () => {
    const f0 = base();
    (f0.foot as Record<string, unknown>).searchRadiusPx = 0;
    expect(mentions(errorsOf(f0), 'searchRadiusPx')).toBe(true);
    const fneg = base();
    (fneg.foot as Record<string, unknown>).searchRadiusPx = -10;
    expect(mentions(errorsOf(fneg), 'searchRadiusPx')).toBe(true);
  });

  it('foot 非物件 → 擋', () => {
    const f = base();
    f.foot = 123;
    expect(mentions(errorsOf(f), 'foot')).toBe(true);
  });

  it('offsetX/Y NaN → 擋', () => {
    const f = base();
    (f.foot as Record<string, unknown>).offsetY = NaN;
    expect(mentions(errorsOf(f), 'offsetY')).toBe(true);
  });
});

describe('C. resolveFoot — 讀取端 fallback（缺欄位用 FOOT_GLOW；0 不被吃）', () => {
  it('有 searchRadiusPx → 用它；無 foot → fallback FOOT_GLOW（radiusPx=50）', () => {
    expect(resolveFoot({ searchRadiusPx: 90 }).radiusPx).toBe(90);
    expect(resolveFoot(undefined).radiusPx).toBe(FOOT_GLOW.radiusPx); // 50
    expect(resolveFoot({}).radiusPx).toBe(FOOT_GLOW.radiusPx);
    expect(FOOT_GLOW.radiusPx).toBe(50);
  });

  it('offsetX/Y 缺 → fallback FOOT_GLOW（offsetX=0、offsetY≈75.6）', () => {
    const r = resolveFoot({ searchRadiusPx: 90 });
    expect(r.offsetX).toBe(FOOT_GLOW.offsetXPx); // 0
    expect(r.offsetY).toBe(FOOT_GLOW.offsetYPx); // ≈75.6
  });

  it('★ offsetY=0 用 ?? 不被吃（0 合法 offset，別被 || 當 falsy → fallback 75.6）', () => {
    // 同 #6 的 0-owner nullish 陷阱：?? 只對 null/undefined fallback，0 保留。
    expect(resolveFoot({ offsetY: 0 }).offsetY).toBe(0);
    expect(resolveFoot({ offsetY: 0 }).offsetY).not.toBe(FOOT_GLOW.offsetYPx);
    expect(resolveFoot({ offsetX: 0, offsetY: 0, searchRadiusPx: 0.0001 }).offsetX).toBe(0);
  });
});
