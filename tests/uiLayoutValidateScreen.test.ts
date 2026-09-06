// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateUiLayout, DEFAULT_UI_LAYOUT } from '@/config/uiLayoutSchema';

/**
 * uiLayoutSchema validateScreen — 波次訊息螢幕級位置（用戶#5，翼騎 f9aaa5e 整合波騎）。
 * 新增頂層 screen?: ScreenLayout（optional，additive），內含 waveMessage{x,y,width,height,align?}。
 * validateScreen module-private → 透過公開 validateUiLayout(整檔) 入口測（以 DEFAULT_UI_LAYOUT 為合法基準改壞）。
 * 維度3 斷驗證過/擋。含壞版必紅（強制 screen 破舊相容 / align 白名單漏）。
 * ⚠️ EffectSystem.waveMessage 讀 layout 定位屬顯示層(需 boot,翼騎 headless 驗 x960 y225)、
 *    ui-editor 屬波騎互動層——皆不補;validateScreen 純驗證補足。
 */

/** 深拷貝合法基準檔（含合法 screen.waveMessage）。 */
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
/** 取 screen.waveMessage 引用（改壞用）。 */
function wm(file: Record<string, unknown>): Record<string, unknown> {
  return (file.screen as { waveMessage: Record<string, unknown> }).waveMessage;
}

describe('uiLayoutSchema validateScreen — 波次訊息螢幕位置（additive optional）', () => {
  it('基準檔（DEFAULT_UI_LAYOUT，含合法 screen.waveMessage）→ 過（陽性對照）', () => {
    expect(validateUiLayout(base()).ok).toBe(true);
  });

  it('有 screen + 合法 waveMessage（x/y/width/height 齊、align∈{left,center,right}）→ 過', () => {
    const f = base();
    (f.screen as { waveMessage: unknown }).waveMessage = {
      x: 960,
      y: 225,
      width: 700,
      height: 100,
      align: 'left',
    };
    expect(validateUiLayout(f).ok).toBe(true);
  });

  it('align 省略（optional）→ 過（align 非必填）', () => {
    const f = base();
    delete wm(f).align;
    expect(validateUiLayout(f).ok).toBe(true);
  });

  it('★ 無 screen（舊 JSON，screen=undefined）→ 過（additive optional、舊資料相容，不破凍結核心）', () => {
    const f = base();
    delete f.screen; // 舊 JSON 無 screen
    expect(validateUiLayout(f).ok).toBe(true);
  });

  it('缺 width → 擋（x/y/width/height 皆必填）', () => {
    const f = base();
    delete wm(f).width;
    expect(mentions(errorsOf(f), 'width')).toBe(true);
  });

  it('缺 x / y / height → 擋（各必填）', () => {
    for (const key of ['x', 'y', 'height']) {
      const f = base();
      delete wm(f)[key];
      expect(mentions(errorsOf(f), key)).toBe(true);
    }
  });

  it('width / height 非正 → 擋（positive）', () => {
    const f = base();
    wm(f).width = 0;
    expect(mentions(errorsOf(f), 'width')).toBe(true);
  });

  // 🔴 壞版對照：align 白名單外（'middle'/亂字）→ 擋。
  it('★ 壞版對照：bad align（非 left/center/right，如 "middle"）→ 擋', () => {
    const f = base();
    wm(f).align = 'middle';
    const errs = errorsOf(f);
    expect(errs.length).toBeGreaterThan(0);
    expect(mentions(errs, 'align')).toBe(true);
  });

  // 🔴 壞版對照：additive 相容——無 screen 必須放行（若強制要 screen，舊 JSON 全掛）。
  it('★ 壞版對照：無 screen 必須 ok（強制要 screen 會破舊資料相容）', () => {
    const f = base();
    delete f.screen;
    expect(validateUiLayout(f).ok).toBe(true);
    // 且不因缺 screen 產生任何 screen/waveMessage 相關錯誤。
    expect(mentions(errorsOf(f), 'waveMessage')).toBe(false);
  });
});
