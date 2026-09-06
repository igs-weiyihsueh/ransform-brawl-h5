// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateUiLayout, DEFAULT_UI_LAYOUT, isVisible } from '@/config/uiLayoutSchema';

/**
 * #6 元素顯示開關 visible（用戶五輪最後一項，翼騎整合波騎 290f49a）。
 * 12 元素共用 base HasVisible{visible?:boolean}；isVisible(el)=!!el && el.visible!==false 單一真相(讀取端+editor 共用)。
 * 語意：省略/undefined/true=顯示、false=隱藏；additive 相容舊 JSON(無 visible=顯示)。
 * 簽章(讀 src 290f49a)：isVisible(el:HasVisible|null|undefined)→boolean；validate 各元素 checkOptionalBoolean(visible)。
 * A 純函式 isVisible / B 經公開 validateUiLayout 驗 visible。維度3 斷 bool/過擋。含壞版必紅。
 * ⚠️ ui-editor 勾選框/隱藏預覽屬互動(波騎)、讀取端 12 元素 if(!isVisible)跳過繪製屬狀態機(需 boot,翼騎 headless 驗 foot/waveMessage visible=false 生效)——不補;isVisible + validate visible 補足。
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

describe('A. isVisible — 單一真相（預設顯示，false 才隱藏）', () => {
  it('★ false → false（隱藏）', () => {
    expect(isVisible({ visible: false })).toBe(false);
  });

  it('true → true；★ undefined/省略 → true（預設顯示，#6 核心：省略不被誤判隱藏）', () => {
    expect(isVisible({ visible: true })).toBe(true);
    expect(isVisible({ visible: undefined })).toBe(true); // 顯式 undefined
    expect(isVisible({})).toBe(true); // 省略欄位
  });

  it('★ null / undefined 元素 → false（防呆，不對不存在元素當顯示）', () => {
    expect(isVisible(null)).toBe(false);
    expect(isVisible(undefined)).toBe(false);
  });

  it('只有明確 false 才隱藏（其餘皆顯示）— 真值表', () => {
    expect(isVisible({ visible: false })).toBe(false);
    for (const el of [{ visible: true }, { visible: undefined }, {}] as const) {
      expect(isVisible(el)).toBe(true);
    }
  });
});

describe('B. validate visible — checkOptionalBoolean（省略合法、存在必 boolean）', () => {
  it('visible=true / false / 省略 → 過（screen.waveMessage 與 foot 各處）', () => {
    const fTrue = base();
    (fTrue.screen as { waveMessage: Record<string, unknown> }).waveMessage.visible = true;
    (fTrue.foot as Record<string, unknown>).visible = false;
    expect(validateUiLayout(fTrue).ok).toBe(true);
    const fOmit = base(); // 預設無 visible
    expect(validateUiLayout(fOmit).ok).toBe(true);
  });

  it('★ 無 visible（舊 JSON）→ 過（additive 相容，續守凍結）', () => {
    const f = base(); // DEFAULT 各元素本就無 visible
    expect(validateUiLayout(f).ok).toBe(true);
    expect(mentions(errorsOf(f), 'visible')).toBe(false);
  });

  it("★ 非 boolean（'yes'）→ 擋（screen.waveMessage）", () => {
    const f = base();
    (f.screen as { waveMessage: Record<string, unknown> }).waveMessage.visible = 'yes';
    expect(mentions(errorsOf(f), 'visible')).toBe(true);
  });

  it('非 boolean（數字 1 / 字串 "x"）→ 擋（foot）', () => {
    const f1 = base();
    (f1.foot as Record<string, unknown>).visible = 1;
    expect(mentions(errorsOf(f1), 'visible')).toBe(true);
    const fx = base();
    (fx.foot as Record<string, unknown>).visible = 'x';
    expect(mentions(errorsOf(fx), 'visible')).toBe(true);
  });
});
