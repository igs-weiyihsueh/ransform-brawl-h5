import { describe, expect, it } from 'vitest';
import { FOOT_GLOW, footGlowCenter } from '@/config/playerConfig';

/**
 * 真空環對齊（#6 修）測試。sprite origin=(0.5,0.5) 畫布中心，美術在畫布內非置中，
 * footGlowCenter 校正 offset 到腳部視覺中心。含壞版必紅。
 */
describe('footGlowCenter — 真空環對齊角色腳部', () => {
  it('環中心 = sprite + 校正 offset（x 往左修、y 往下到腳部）', () => {
    const c = footGlowCenter(500, 500);
    expect(c.x).toBe(500 + FOOT_GLOW.offsetXPx);
    expect(c.y).toBe(500 + FOOT_GLOW.offsetYPx);
  });

  it('offsetX = 0（水平置中於 sprite、flip-safe，修用戶新#1 圈沒在正下方）', () => {
    expect(FOOT_GLOW.offsetXPx).toBe(0);
  });

  it('offsetY 為正（H5 Y 下為正 → 從畫布中心往下到腳部，非 Unity 往上 -50）', () => {
    expect(FOOT_GLOW.offsetYPx).toBeGreaterThan(0);
  });

  it('自訂 offset 參數可覆蓋', () => {
    expect(footGlowCenter(100, 100, 5, 20)).toEqual({ x: 105, y: 120 });
  });

  // 🔴 壞版對照：若沿用 Unity 的 -50（往上），環會偏到頭上（y < sprite）；正確是往下（y > sprite）。
  it('壞版對照：環在角色下方（y > spriteY），非頭上', () => {
    const c = footGlowCenter(500, 500);
    expect(c.y).toBeGreaterThan(500); // 往下到腳，非往上到頭
  });

  // 🔴 壞版對照：環 x 水平置中於 sprite（flip-safe，面左右都在正下方；offsetX≠0 會偏）。
  it('壞版對照：環 x = spriteX（水平置中、不偏；offsetX=0 flip-safe）', () => {
    expect(footGlowCenter(500, 500).x).toBe(500); // 圈中心 x = sprite x
    expect(footGlowCenter(300, 100).x).toBe(300); // 任意 x 都置中於 sprite
  });
});
