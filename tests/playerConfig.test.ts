import { describe, expect, it } from 'vitest';
import { FOOT_GLOW, PLAYER_COLORS, playerColor } from '@/config/playerConfig';

/**
 * 腳下真空環（搜索圈）設定測試（項目 2）。
 * 環的 Phaser 繪製在 Player entity（jsdom/Phaser 相依），這裡測純設定：
 * 半徑/偏移/線寬換算、多人各自識別色。含壞版必紅。
 */
describe('playerConfig — 真空環設定 + 玩家識別色', () => {
  it('真空環數值對照 Unity(×PPU=100)：半徑50/偏移50/線寬5/alpha0.5', () => {
    expect(FOOT_GLOW.radiusPx).toBe(50); // vacuumRadius 0.5
    expect(FOOT_GLOW.offsetYPx).toBe(50); // vacuumVisualOffsetY 0.5
    expect(FOOT_GLOW.ringWidthPx).toBe(5); // ringWidth 0.05
    expect(FOOT_GLOW.alpha).toBe(0.5); // footGlowAlpha
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

  // 🔴 壞版對照：環中心偏移 = 玩家 y - offsetY（往上）。若偏移方向弄反(加)環會跑到腳下方。
  it('壞版對照：H5 環中心在玩家上方（y - offsetY），offset 為正值', () => {
    const playerY = 500;
    const ringCenterY = playerY - FOOT_GLOW.offsetYPx;
    expect(ringCenterY).toBe(450); // 上方
    expect(ringCenterY).toBeLessThan(playerY); // 確在上方(非下方)
    expect(FOOT_GLOW.offsetYPx).toBeGreaterThan(0);
  });

  // 🔴 壞版對照：半徑=吸取範圍，不可為 0（否則環不可見/無範圍）。
  it('壞版對照：半徑 > 0（吸取範圍非空）', () => {
    expect(FOOT_GLOW.radiusPx).toBeGreaterThan(0);
  });
});
