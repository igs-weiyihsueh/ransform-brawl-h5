import { describe, expect, it } from 'vitest';
import { MAP_BOUNDS, clampToBounds } from '@/config/mapConfig';

/**
 * 地圖邊界夾限測試（項目 1）。含壞版必紅：超界修正、界內不動(changed=false)、四邊都夾。
 * 進場旁路(isJumping)在系統層(PlayerControlSystem)判斷、非純函式，這裡只測夾限本身。
 */
describe('clampToBounds — 地圖邊界夾限', () => {
  it('邊界值：畫面中央 1600×800（160~1760, 140~940）', () => {
    expect(MAP_BOUNDS.minX).toBe(160);
    expect(MAP_BOUNDS.maxX).toBe(1760);
    expect(MAP_BOUNDS.minY).toBe(140);
    expect(MAP_BOUNDS.maxY).toBe(940);
  });

  it('界內不夾（changed=false、座標不變）', () => {
    const c = clampToBounds(960, 540);
    expect(c.x).toBe(960);
    expect(c.y).toBe(540);
    expect(c.changed).toBe(false);
  });

  it('超左界 → 夾到 minX、changed=true', () => {
    const c = clampToBounds(0, 540);
    expect(c.x).toBe(160);
    expect(c.changed).toBe(true);
  });

  it('超右界 → 夾到 maxX', () => {
    expect(clampToBounds(5000, 540).x).toBe(1760);
  });

  it('超上界 → 夾到 minY', () => {
    expect(clampToBounds(960, -100).y).toBe(140);
  });

  it('超下界 → 夾到 maxY', () => {
    expect(clampToBounds(960, 5000).y).toBe(940);
  });

  it('對角超界 → x/y 各自夾、changed=true', () => {
    const c = clampToBounds(-50, 2000);
    expect(c.x).toBe(160);
    expect(c.y).toBe(940);
    expect(c.changed).toBe(true);
  });

  it('剛好在邊界上 → 不算超界（changed=false）', () => {
    expect(clampToBounds(160, 140).changed).toBe(false);
    expect(clampToBounds(1760, 940).changed).toBe(false);
  });

  // 🔴 壞版對照：若沒夾限（回傳原值），超界點的座標不會被修正。
  it('壞版對照：超界點確實被修正（非原值）', () => {
    const c = clampToBounds(9999, 540);
    expect(c.x).not.toBe(9999);
    expect(c.x).toBe(1760);
  });

  // 🔴 壞版對照：界內點的 changed 必為 false（避免每幀強設位置跟物理打架）。
  it('壞版對照：界內 changed 必 false（不觸發寫回）', () => {
    expect(clampToBounds(500, 500).changed).toBe(false);
  });
});
