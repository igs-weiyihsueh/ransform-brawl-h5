// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BOTTOM_PANEL_LAYOUT,
  DASH_DISPLAY_DEFAULT,
  resolveDashDisplay,
} from '@/config/uiConfig';

/**
 * resolveDashDisplay — 衝刺「衝」圖示位置/大小可調（用戶要編輯器可調，同 JP/進度 override 範式）。
 * override 優先無則 BOTTOM_PANEL_LAYOUT.dash 打包預設；dashScale 等比縮放半徑/字級/數字偏移。含壞版對照。
 */
describe('resolveDashDisplay — override 優先 / 預設 fallback', () => {
  const d = BOTTOM_PANEL_LAYOUT.dash;

  it('無 override → 用打包預設（cx/cy/radius = config，scale 1）', () => {
    const r = resolveDashDisplay(undefined);
    expect(r.cx).toBe(d.cx);
    expect(r.cy).toBe(d.cy);
    expect(r.radius).toBe(d.radius);
    expect(r.countOffsetX).toBe(d.countOffsetX);
    expect(r.countOffsetY).toBe(d.countOffsetY);
  });

  it('DASH_DISPLAY_DEFAULT 為 0 位移 / scale 1（不動預設位置）', () => {
    expect(DASH_DISPLAY_DEFAULT.dashOffsetX).toBe(0);
    expect(DASH_DISPLAY_DEFAULT.dashOffsetY).toBe(0);
    expect(DASH_DISPLAY_DEFAULT.dashScale).toBe(1);
  });

  it('offset → cx/cy 平移該量', () => {
    const r = resolveDashDisplay({ dashOffsetX: 40, dashOffsetY: -20 });
    expect(r.cx).toBe(d.cx + 40);
    expect(r.cy).toBe(d.cy - 20);
  });

  it('★ scale → 半徑/字級/數字偏移等比縮放（圖示整體變大小，動畫/數字跟隨）', () => {
    const r = resolveDashDisplay({ dashScale: 2 });
    expect(r.radius).toBe(d.radius * 2);
    expect(r.countOffsetX).toBe(d.countOffsetX * 2);
    expect(r.countOffsetY).toBe(d.countOffsetY * 2);
    expect(r.labelFontPx).toBeGreaterThan(0);
    expect(r.countFontPx).toBeGreaterThan(0);
  });

  it('scale 下限夾 0.2（防過小/負）', () => {
    const r = resolveDashDisplay({ dashScale: 0 });
    expect(r.radius).toBeCloseTo(d.radius * 0.2, 6);
    const rNeg = resolveDashDisplay({ dashScale: -5 });
    expect(rNeg.radius).toBeCloseTo(d.radius * 0.2, 6);
  });

  it('🔴 壞版對照：scale 越大半徑越大（單調），非固定/反向', () => {
    const small = resolveDashDisplay({ dashScale: 0.5 });
    const big = resolveDashDisplay({ dashScale: 1.5 });
    expect(big.radius).toBeGreaterThan(small.radius);
  });

  it('部分 override（只給 offsetX）→ 其餘用預設', () => {
    const r = resolveDashDisplay({ dashOffsetX: 10 });
    expect(r.cx).toBe(d.cx + 10);
    expect(r.cy).toBe(d.cy); // offsetY 未給 → 0
    expect(r.radius).toBe(d.radius); // scale 未給 → 1
  });
});
