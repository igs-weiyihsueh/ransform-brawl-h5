import { describe, expect, it } from 'vitest';
import { FOOT_GLOW, PLAYER_COLORS, footGlowCenter, playerColor } from '@/config/playerConfig';
import { SPRITE_SCALE } from '@/config/combatConfig';

/**
 * 腳下真空環（搜索圈）設定測試（項目 2）。
 * 環的 Phaser 繪製在 Player entity（jsdom/Phaser 相依），這裡測純設定：
 * 半徑/偏移/線寬換算、多人各自識別色。含壞版必紅。
 */
describe('playerConfig — 真空環設定 + 玩家識別色', () => {
  it('真空環數值對照：半徑50/線寬5/alpha0.5(同 Unity)；offset 改為 #6 校正值(非 Unity 50)', () => {
    expect(FOOT_GLOW.radiusPx).toBe(50); // vacuumRadius 0.5×PPU
    expect(FOOT_GLOW.ringWidthPx).toBe(5); // ringWidth 0.05×PPU
    expect(FOOT_GLOW.alpha).toBe(0.5); // footGlowAlpha
    // #6 修:offset 不再沿用 Unity 腳底 pivot 的 -50/50，改校正畫布中心 pivot 的美術偏移。
    // offsetX 負(往左修美術偏左)、offsetY 正(H5 Y 下為正 → 往下到腳部)。
    expect(FOOT_GLOW.offsetXPx).toBeCloseTo(-12 * SPRITE_SCALE); // 往左校正
    expect(FOOT_GLOW.offsetYPx).toBeCloseTo(72 * SPRITE_SCALE); // 往下到腳部
    expect(FOOT_GLOW.offsetYPx).not.toBe(50); // 非 Unity 舊值
  });

  it('depth = -10（壓角色腳下不擋，對應 sortingOrder=-10）', () => {
    expect(FOOT_GLOW.depth).toBe(-10);
  });

  it('多人各自識別色：P1~P4 四色互異', () => {
    expect(PLAYER_COLORS.length).toBe(4);
    const uniq = new Set(PLAYER_COLORS);
    expect(uniq.size).toBe(4); // 四色不重複，才能分辨誰是誰
  });

  it('playerColor(id) 取對應色、超出 P4 循環', () => {
    expect(playerColor(0)).toBe(PLAYER_COLORS[0]);
    expect(playerColor(3)).toBe(PLAYER_COLORS[3]);
    expect(playerColor(4)).toBe(PLAYER_COLORS[0]); // 循環
  });

  // 🔴 壞版對照：#6 修後環中心在玩家【下方】(腳部 y+offsetY)、x 往左校正。若沿用 Unity -50 往上→頭上(錯)。
  it('壞版對照：環中心在玩家下方(y+offsetY 到腳部)、x 往左校正、非頭上', () => {
    const c = footGlowCenter(500, 500);
    expect(c.y).toBeGreaterThan(500); // 往下到腳部(非頭上)
    expect(c.y).toBeCloseTo(500 + FOOT_GLOW.offsetYPx);
    expect(c.x).toBeLessThan(500); // x 往左校正(修偏右)
    expect(FOOT_GLOW.offsetYPx).toBeGreaterThan(0); // offsetY 正=往下
    expect(FOOT_GLOW.offsetXPx).toBeLessThan(0); // offsetX 負=往左
  });

  // 🔴 壞版對照：半徑=吸取範圍，不可為 0（否則環不可見/無範圍）。
  it('壞版對照：半徑 > 0（吸取範圍非空）', () => {
    expect(FOOT_GLOW.radiusPx).toBeGreaterThan(0);
  });
});
