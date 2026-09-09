// @vitest-environment jsdom
/**
 * 2 新事件（整套改造版）：地雷/魔尖塔併進「事件（Event）」底下（eventType 分派，跟守護波/火雨並列）。
 * - schema：Event 節點依 eventType 驗證（guard/fireRain/mineTrap/towerWave）。
 * - 地雷：火雨式自動撒（count/radiusPx/delaySec/paralyzeSec）；WaveSystem 撒好 points 傳 onMineTrap。
 * - 魔尖塔：守護波勝敗（towerWave 參數 + ringSkill）；onTowerWave 帶參、勝敗雙結束、失敗不 GameOver。
 * - 向後相容：無 eventType 舊 Event（守護波）＝guard。
 */
import { describe, expect, it } from 'vitest';
import { validateLevels, LEVELS_SCHEMA_VERSION, NODE_TYPES, EVENT_TYPES } from '@/config/levelSchema';
import { WaveSystem } from '@/systems/WaveSystem';
import type { GameContext } from '@/systems/GameContext';
import type { LevelData, LevelsFile, ResolvedMineTrap, TowerWaveParams } from '@/systems/WaveSystem';

const wrap = (node: unknown): LevelsFile => ({
  version: LEVELS_SCHEMA_VERSION,
  levels: [{ id: 'L', nodes: [node] } as unknown as LevelData],
});
const MINE = { nodeType: 'Event', eventType: 'mineTrap', mineTrap: { count: 8, radiusPx: 120, delaySec: 3, paralyzeSec: 3 } };
const TOWER = { nodeType: 'Event', eventType: 'towerWave', towerWave: { towerCount: 4, timeLimitSec: 60, towerHp: 100, ringSkill: { ringCount: 3, baseRadiusPx: 60, radiusStepPx: 40, ringIntervalSec: 0.6, ringThicknessPx: 20, energyCost: 2 } } };
const GUARD = { nodeType: 'Event', eventPresetName: 'Guard60' }; // 無 eventType＝guard（向後相容）

function makeWave(levels: LevelData[]): WaveSystem {
  const sys = new WaveSystem(levels);
  sys.init({
    players: [{ playerId: 0 }],
    player: { getPosition: () => ({ x: 0, y: 0 }) },
    getEnemies: () => [],
    spawner: { spawn: () => ({ isDead: () => false }), clearAllEnemies: () => {} },
    effects: { waveMessage: () => {} },
  } as unknown as GameContext);
  return sys;
}
const nodeIdx = (sys: WaveSystem): number => (sys as unknown as { getNodeIndex: () => number }).getNodeIndex();

describe('事件整套 schema — Event eventType 分派', () => {
  it('NODE_TYPES 不再含 MineTrap/TowerWave（併進 Event）；EVENT_TYPES 含 4 種', () => {
    expect(NODE_TYPES).not.toContain('MineTrap');
    expect(NODE_TYPES).not.toContain('TowerWave');
    expect(EVENT_TYPES).toEqual(['guard', 'fireRain', 'mineTrap', 'towerWave']);
  });

  it('★ 合法地雷事件放行（火雨式撒佈參數，無座標）', () => {
    expect(validateLevels(wrap(MINE)).ok).toBe(true);
  });
  it('壞地雷：count<1 / 半徑負 / 延遲負 / mineTrap 缺 → 擋', () => {
    expect(validateLevels(wrap({ ...MINE, mineTrap: { ...MINE.mineTrap, count: 0 } })).ok).toBe(false);
    expect(validateLevels(wrap({ ...MINE, mineTrap: { ...MINE.mineTrap, radiusPx: -1 } })).ok).toBe(false);
    expect(validateLevels(wrap({ ...MINE, mineTrap: { ...MINE.mineTrap, delaySec: -1 } })).ok).toBe(false);
    expect(validateLevels(wrap({ nodeType: 'Event', eventType: 'mineTrap' })).ok).toBe(false);
  });

  it('★ 合法魔尖塔事件放行（含新 ringSkill 欄位）', () => {
    expect(validateLevels(wrap(TOWER)).ok).toBe(true);
  });
  it('壞魔尖塔：towerCount<1 / limit<=0 / ringSkill 欄位壞 → 擋', () => {
    expect(validateLevels(wrap({ ...TOWER, towerWave: { ...TOWER.towerWave, towerCount: 0 } })).ok).toBe(false);
    expect(validateLevels(wrap({ ...TOWER, towerWave: { ...TOWER.towerWave, timeLimitSec: 0 } })).ok).toBe(false);
    expect(validateLevels(wrap({ ...TOWER, towerWave: { ...TOWER.towerWave, ringSkill: { ...TOWER.towerWave.ringSkill, ringCount: 0 } } })).ok).toBe(false);
    expect(validateLevels(wrap({ ...TOWER, towerWave: { ...TOWER.towerWave, ringSkill: { ...TOWER.towerWave.ringSkill, ringIntervalSec: 0 } } })).ok).toBe(false);
  });

  it('★ 向後相容：無 eventType 舊 Event（守護波）仍合法', () => {
    expect(validateLevels(wrap(GUARD)).ok).toBe(true);
  });
});

describe('事件整套 WaveSystem — 地雷觸發（火雨式撒好 points）', () => {
  it('★ 走到地雷事件 → onMineTrap 一次，帶「已撒好的 points」+ 參數 → 保持後前進', () => {
    const level = { id: 'L', nodes: [MINE, { nodeType: 'Reward', rewardTickets: 5 }] } as unknown as LevelData;
    const sys = makeWave([level]);
    let calls = 0;
    let received: ResolvedMineTrap | null = null;
    sys.onMineTrap = (r) => { calls += 1; received = r; };
    for (let i = 0; i < 5; i += 1) sys.update(1 / 60);
    expect(calls).toBe(1);
    expect(received!.points.length).toBeGreaterThan(0); // WaveSystem 已自動撒好座標（火雨式）
    expect(received!.points.length).toBeLessThanOrEqual(8); // <= count
    expect(received!.delaySec).toBe(3);
    expect(received!.paralyzeSec).toBe(3);
    expect(received!.radiusPx).toBe(120);
    for (let i = 0; i < 60 * 7; i += 1) sys.update(1 / 60);
    expect(calls).toBe(1);
    expect(nodeIdx(sys)).toBeGreaterThanOrEqual(1);
  });
});

describe('事件整套 WaveSystem — 魔尖塔守護波勝敗（雙結束，失敗不 GameOver）', () => {
  it('★ 限時內打完全部尖塔 → 過關（提前 advance + result true）', () => {
    const level = { id: 'L', nodes: [{ ...TOWER, towerWave: { ...TOWER.towerWave, towerCount: 3, timeLimitSec: 100 } }, { nodeType: 'Reward' }] } as unknown as LevelData;
    const sys = makeWave([level]);
    let result: boolean | null = null;
    let params: TowerWaveParams | null = null;
    sys.onTowerWave = (p) => { params = p; };
    sys.onTowerWaveResult = (won) => { result = won; };
    sys.update(1 / 60);
    expect(params!.towerCount).toBe(3);
    expect(params!.ringSkill.energyCost).toBe(2);
    sys.notifyTowerDestroyed(); sys.notifyTowerDestroyed(); sys.notifyTowerDestroyed();
    sys.update(1 / 60);
    expect(result).toBe(true);
    expect(nodeIdx(sys)).toBeGreaterThanOrEqual(1);
  });

  it('★ 限時到沒打完 → 失敗（result false）但不 GameOver、仍 advance', () => {
    const level = { id: 'L', nodes: [{ ...TOWER, towerWave: { ...TOWER.towerWave, towerCount: 4, timeLimitSec: 2 } }, { nodeType: 'Reward' }] } as unknown as LevelData;
    const sys = makeWave([level]);
    let result: boolean | null = null;
    sys.onTowerWaveResult = (won) => { result = won; };
    sys.update(1 / 60);
    sys.notifyTowerDestroyed(); // 只打 1/4
    for (let i = 0; i < 60 * 3; i += 1) sys.update(1 / 60);
    expect(result).toBe(false);
    expect(nodeIdx(sys)).toBeGreaterThanOrEqual(1); // 失敗仍前進（不卡不 GameOver）
  });

  it('getNodeProgress 魔尖塔＝摧毀數/towerCount', () => {
    const level = { id: 'L', nodes: [{ ...TOWER, towerWave: { ...TOWER.towerWave, towerCount: 4, timeLimitSec: 100 } }] } as unknown as LevelData;
    const sys = makeWave([level]);
    sys.update(1 / 60);
    expect(sys.getNodeProgress()).toBeCloseTo(0);
    sys.notifyTowerDestroyed(); sys.notifyTowerDestroyed();
    expect(sys.getNodeProgress()).toBeCloseTo(0.5);
  });
});
