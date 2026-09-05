import { describe, expect, it } from 'vitest';
import {
  MAP_BOUNDS,
  PANEL_TOP_Y,
  PLAYER_BOUNDS,
  insetBounds,
} from '@/config/mapConfig';

/**
 * 地圖邊界嚴謹化測試（bug 修）：玩家下界不進下方面板、body 內縮確保整個 body 在界內。
 * 含壞版必紅。
 */
describe('mapConfig 邊界嚴謹化', () => {
  it('玩家下界收到面板上緣之上（maxY < 面板頂緣）', () => {
    expect(PLAYER_BOUNDS.maxY).toBeLessThan(PANEL_TOP_Y); // 不越過面板頂緣
    expect(PLAYER_BOUNDS.maxY).toBeLessThanOrEqual(MAP_BOUNDS.maxY); // 不超過場地下界
  });

  it('玩家 X/上界同 MAP_BOUNDS（只收下界）', () => {
    expect(PLAYER_BOUNDS.minX).toBe(MAP_BOUNDS.minX);
    expect(PLAYER_BOUNDS.maxX).toBe(MAP_BOUNDS.maxX);
    expect(PLAYER_BOUNDS.minY).toBe(MAP_BOUNDS.minY);
  });

  it('insetBounds：各邊內縮 r（body 半徑），整個 body 在界內', () => {
    const b = insetBounds({ minX: 0, maxX: 100, minY: 0, maxY: 100 }, 10);
    expect(b.minX).toBe(10);
    expect(b.maxX).toBe(90);
    expect(b.minY).toBe(10);
    expect(b.maxY).toBe(90);
  });

  it('insetBounds：inset 過大不反轉（夾到中線）', () => {
    const b = insetBounds({ minX: 0, maxX: 100, minY: 0, maxY: 100 }, 999);
    expect(b.minX).toBeLessThanOrEqual(b.maxX);
    expect(b.minY).toBeLessThanOrEqual(b.maxY);
  });

  // 🔴 壞版對照：玩家下界若沒收（=場地 940），角色 body 會穿進面板；收好後 < 場地下界。
  it('壞版對照：玩家下界嚴格小於場地下界 MAP_BOUNDS.maxY（有收下界）', () => {
    expect(PLAYER_BOUNDS.maxY).toBeLessThan(MAP_BOUNDS.maxY);
    expect(PANEL_TOP_Y - PLAYER_BOUNDS.maxY).toBeGreaterThanOrEqual(50); // 留 body 半徑級距的間隙
  });

  // 🔴 壞版對照：inset 必須真的內縮（非原值），否則 body 半徑會露出界外。
  it('壞版對照：inset 確實內縮（非原邊界）', () => {
    const b = insetBounds({ minX: 0, maxX: 100, minY: 0, maxY: 100 }, 10);
    expect(b.maxX).not.toBe(100);
    expect(b.maxX).toBeLessThan(100);
  });
});
