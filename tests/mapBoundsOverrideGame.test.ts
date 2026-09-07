// @vitest-environment jsdom
/**
 * mapBounds override → mapConfig 重算整合（用戶第十五輪：地圖邊界編輯器 遊戲端套用）。
 * 設 localStorage mapBounds override → mapConfig 模組初始化讀 getResolvedMapBoundsUnits → MAP_BOUNDS 換算跟著變，
 *   PLAYER_BOUNDS/ENEMY_PLAY_BOUNDS（依 MAP_BOUNDS 衍生 + 面板感知下界）也跟著重算。
 * ⚠️ mapConfig 是模組初始化讀一次 → 用 vi.resetModules + 先寫 localStorage 再動態 import 驗不同 override 的結果。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

const KEY = 'transformbrawl:mapBounds';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules(); // 讓 mapConfig 重新初始化讀最新 localStorage
});

async function loadMapConfig() {
  return await import('@/config/mapConfig');
}

describe('mapBounds override → MAP_BOUNDS/PLAYER_BOUNDS 重算', () => {
  it('無 override → 打包預設（minX 160 / maxX 1760，行為不變）', async () => {
    const m = await loadMapConfig();
    expect(m.MAP_BOUNDS.minX).toBe(160); // 960 + (-8)*100
    expect(m.MAP_BOUNDS.maxX).toBe(1760); // 960 + 8*100
  });

  it('override 拉大 X（-12..12）→ MAP_BOUNDS.minX/maxX 跟著變', async () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, bounds: { minX: -12, maxX: 12, minY: -4, maxY: 4 } }));
    const m = await loadMapConfig();
    expect(m.MAP_BOUNDS.minX).toBe(960 - 1200); // -240
    expect(m.MAP_BOUNDS.maxX).toBe(960 + 1200); // 2160
    // PLAYER_BOUNDS X 跟著 MAP_BOUNDS（下界仍面板感知）。
    expect(m.PLAYER_BOUNDS.minX).toBe(m.MAP_BOUNDS.minX);
    expect(m.PLAYER_BOUNDS.maxX).toBe(m.MAP_BOUNDS.maxX);
  });

  it('★保留 live 面板感知下界：override 把 maxY 拉很大，PLAYER_BOUNDS.maxY 仍收在面板上緣之上', async () => {
    // maxY=8 → MAP_BOUNDS.maxY = 540+800 = 1340（超過面板）；PLAYER_BOUNDS.maxY 應被面板下界夾住（<1340）。
    localStorage.setItem(KEY, JSON.stringify({ version: 1, bounds: { minX: -8, maxX: 8, minY: -4, maxY: 8 } }));
    const m = await loadMapConfig();
    expect(m.MAP_BOUNDS.maxY).toBe(1340);
    expect(m.PLAYER_BOUNDS.maxY).toBeLessThan(m.MAP_BOUNDS.maxY); // 面板感知下界仍生效（沒被破壞）
    expect(m.ENEMY_PLAY_BOUNDS.maxY).toBeLessThanOrEqual(m.PANEL_TOP_Y); // 敵人下界收面板頂
  });

  it('壞 override（min>=max）→ 退回打包預設（不炸、行為不變）', async () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, bounds: { minX: 8, maxX: 8, minY: -4, maxY: 4 } }));
    const m = await loadMapConfig();
    expect(m.MAP_BOUNDS.minX).toBe(160); // 退回打包 -8
    expect(m.MAP_BOUNDS.maxX).toBe(1760);
  });
});
