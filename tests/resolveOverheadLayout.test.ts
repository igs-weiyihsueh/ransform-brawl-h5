// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveOverheadLayout, OVERHEAD_LAYOUT } from '@/config/uiConfig';

/**
 * resolveOverheadLayout — overhead override 讀取端補接（用戶「頭上 UI 動了遊戲沒反映」真因，翼騎 c1852a3）。
 * 真因：PlayerOverheadUI 硬讀 OVERHEAD_LAYOUT 靜態 const，無視 UISystem 載入的 layout.overhead override(六輪#6 只接 visible、座標漏接)。
 * 修：resolveOverheadLayout(ov) 逐項 `ov?.xxx ?? OVERHEAD_LAYOUT.xxx` 合併 override 進打包預設。
 * 簽章(讀 src c1852a3)：resolveOverheadLayout(ov?) → typeof OVERHEAD_LAYOUT；全用 ?? (0-safe)、樣式欄靠 spread 保留。
 * 維度3 斷合併(無 ov 預設/提供欄覆蓋/缺欄 fallback/樣式欄不污染/★0-nullish)。含壞版必紅。
 * ⚠️ PlayerOverheadUI 建構子傳參 + UISystem 接線屬狀態機(需 boot,翼騎 headless 驗 ringImg.x=14)——不補;resolveOverheadLayout 純函式補足。
 */
describe('resolveOverheadLayout — override 逐項合併進 OVERHEAD_LAYOUT', () => {
  it('無 ov（null/undefined）→ 回打包預設（回歸保存，行為不變）', () => {
    for (const ov of [undefined, null as unknown as undefined, {}]) {
      const r = resolveOverheadLayout(ov);
      expect(r.badge.cx).toBe(OVERHEAD_LAYOUT.badge.cx); // -66
      expect(r.credit.x).toBe(OVERHEAD_LAYOUT.credit.x); // 4
      expect(r.offsetY).toBe(OVERHEAD_LAYOUT.offsetY); // -140
    }
  });

  it('★ ov 提供某欄 → 該欄用 override 值（ov.badge.cx=14 → 回傳 badge.cx=14）', () => {
    const r = resolveOverheadLayout({ badge: { cx: 14 } });
    expect(r.badge.cx).toBe(14); // override 生效
  });

  it('ov 缺某欄 → 該欄 fallback OVERHEAD_LAYOUT（只覆蓋提供的、其餘保留）', () => {
    const r = resolveOverheadLayout({ badge: { cx: 14 } });
    expect(r.badge.cx).toBe(14); // 提供 → override
    expect(r.badge.cy).toBe(OVERHEAD_LAYOUT.badge.cy); // 未提供 → fallback -2
    expect(r.badge.ringRadius).toBe(OVERHEAD_LAYOUT.badge.ringRadius); // fallback 26
    expect(r.credit.x).toBe(OVERHEAD_LAYOUT.credit.x); // 其他子物件不受影響
  });

  it('多欄 override：badge/credit/energy/combo/offsetY 各自覆蓋', () => {
    const r = resolveOverheadLayout({
      offsetY: -200,
      badge: { cx: 10, ringRadius: 30 },
      credit: { x: 8 },
      energy: { y: 40 },
      combo: { x: 5, maxOffsetY: -60 },
    });
    expect(r.offsetY).toBe(-200);
    expect(r.badge.cx).toBe(10);
    expect(r.badge.ringRadius).toBe(30);
    expect(r.credit.x).toBe(8);
    expect(r.energy.y).toBe(40);
    expect(r.combo.x).toBe(5);
    expect(r.combo.max.offsetY).toBe(-60);
    // 未提供的仍 fallback。
    expect(r.credit.y).toBe(OVERHEAD_LAYOUT.credit.y);
  });

  it('★ 樣式欄（fontSize/text/placeholder）不在 override 範圍 → 恆打包預設（即使有位置 override）', () => {
    const r = resolveOverheadLayout({ badge: { cx: 14 }, credit: { x: 8 } });
    expect(r.badge.fontSize).toBe(OVERHEAD_LAYOUT.badge.fontSize); // '20px'
    expect(r.badge.text).toBe(OVERHEAD_LAYOUT.badge.text); // 'P1'
    expect(r.credit.fontSize).toBe(OVERHEAD_LAYOUT.credit.fontSize); // '22px'
    expect(r.credit.placeholder).toBe(OVERHEAD_LAYOUT.credit.placeholder); // '00000'
  });

  it('★ 0-nullish：座標 override 為 0 是合法值 → 用 0（?? 非 ||，別被 fallback）', () => {
    const r = resolveOverheadLayout({
      offsetY: 0,
      badge: { cx: 0, cy: 0 },
      credit: { x: 0 },
      energy: { x: 0 },
      combo: { x: 0 },
    });
    expect(r.offsetY).toBe(0); // 非 fallback -140
    expect(r.badge.cx).toBe(0); // 非 fallback -66
    expect(r.badge.cy).toBe(0);
    expect(r.credit.x).toBe(0);
    expect(r.energy.x).toBe(0);
    expect(r.combo.x).toBe(0);
  });
});
