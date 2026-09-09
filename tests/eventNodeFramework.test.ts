// @vitest-environment jsdom
/**
 * 2 新事件 階段 A：事件節點框架（地雷陷阱 MineTrap + 魔尖塔 TowerWave）。
 * - schema：兩型節點 validateLevels 驗證（合法放行/壞欄擋）。
 * - WaveSystem：走到節點 → 觸發 onMineTrap/onTowerWave 入口一次（帶參數）→ 保持後前進。
 * - 向後相容：NODE_TYPES 含新型、舊關卡不受影響。
 * ★階段 A 只驗框架+觸發+參數；實體/爆炸/麻痺/尖塔勝敗＝階段 B（不在此測）。
 */
import { describe, expect, it } from 'vitest';
import { validateLevels, LEVELS_SCHEMA_VERSION, NODE_TYPES } from '@/config/levelSchema';
import { WaveSystem } from '@/systems/WaveSystem';
import type { GameContext } from '@/systems/GameContext';
import type { LevelData, LevelsFile, MineTrapNodeData, TowerWaveNodeData } from '@/config/levelSchema';

const wrap = (node: unknown): LevelsFile => ({
  version: LEVELS_SCHEMA_VERSION,
  levels: [{ id: 'L', nodes: [node] } as unknown as LevelData],
});
const MINE = { nodeType: 'MineTrap', points: [{ x: 100, y: 200 }], delaySec: 3, paralyzeSec: 3, radiusPx: 120 };
const TOWER = { nodeType: 'TowerWave', towerCount: 4, timeLimitSec: 60, towerHp: 100, ringSkill: { intervalSec: 3, expandPxPerRing: 40, energyCost: 2 } };

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

describe('階段 A schema — MineTrap / TowerWave 驗證', () => {
  it('NODE_TYPES 含 MineTrap / TowerWave（node 序列可放）', () => {
    expect(NODE_TYPES).toContain('MineTrap');
    expect(NODE_TYPES).toContain('TowerWave');
  });

  it('★ 合法地雷陷阱放行', () => {
    expect(validateLevels(wrap(MINE)).ok).toBe(true);
    expect(validateLevels(wrap({ ...MINE, points: [] })).ok).toBe(true); // 空點合法（框架階段可先空）
  });
  it('壞地雷：points 非陣列 / 座標缺 / 秒數負 → 擋', () => {
    expect(validateLevels(wrap({ ...MINE, points: 'x' })).ok).toBe(false);
    expect(validateLevels(wrap({ ...MINE, points: [{ x: 1 }] })).ok).toBe(false);
    expect(validateLevels(wrap({ ...MINE, delaySec: -1 })).ok).toBe(false);
    expect(validateLevels(wrap({ ...MINE, radiusPx: -5 })).ok).toBe(false);
  });

  it('★ 合法魔尖塔放行', () => {
    expect(validateLevels(wrap(TOWER)).ok).toBe(true);
  });
  it('壞魔尖塔：towerCount<1 / 限時<=0 / 血量<=0 / ringSkill 缺或欄位壞 → 擋', () => {
    expect(validateLevels(wrap({ ...TOWER, towerCount: 0 })).ok).toBe(false);
    expect(validateLevels(wrap({ ...TOWER, timeLimitSec: 0 })).ok).toBe(false);
    expect(validateLevels(wrap({ ...TOWER, towerHp: -1 })).ok).toBe(false);
    expect(validateLevels(wrap({ ...TOWER, ringSkill: undefined })).ok).toBe(false);
    expect(validateLevels(wrap({ ...TOWER, ringSkill: { intervalSec: 0, expandPxPerRing: 40, energyCost: 2 } })).ok).toBe(false);
  });

  it('★ 向後相容：舊扁平 Spawn 關卡不受影響仍合法', () => {
    const flat = { nodeType: 'Spawn', killQuota: 5, maxAlive: 5, spawnThreshold: 3, spawnInterval: 0.5, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }] };
    expect(validateLevels(wrap(flat)).ok).toBe(true);
  });
});

describe('階段 A WaveSystem — 觸發鉤子 + 前進', () => {
  it('★ 走到 MineTrap 節點 → 觸發 onMineTrap 一次（帶參數）→ 保持後前進', () => {
    const level = { id: 'L', nodes: [MINE, { nodeType: 'Reward', rewardTickets: 5 }] } as unknown as LevelData;
    const sys = makeWave([level]);
    let calls = 0;
    let received: MineTrapNodeData | null = null;
    sys.onMineTrap = (n) => { calls += 1; received = n; };
    // 跑到觸發
    for (let i = 0; i < 5; i += 1) sys.update(1 / 60);
    expect(calls).toBe(1); // 只觸發一次
    expect(received!.delaySec).toBe(3);
    expect(received!.points.length).toBe(1);
    // 保持 delaySec+paralyzeSec+0.5 = 6.5s 後前進
    for (let i = 0; i < 60 * 7; i += 1) sys.update(1 / 60);
    expect(calls).toBe(1); // 不重複觸發
    expect(nodeIdx(sys)).toBeGreaterThanOrEqual(1); // 已前進
  });

  it('★ 走到 TowerWave 節點 → 觸發 onTowerWave 一次（帶參數）→ 限時後前進', () => {
    const level = { id: 'L', nodes: [{ ...TOWER, timeLimitSec: 2 }, { nodeType: 'Reward', rewardTickets: 5 }] } as unknown as LevelData;
    const sys = makeWave([level]);
    let calls = 0;
    let received: TowerWaveNodeData | null = null;
    sys.onTowerWave = (n) => { calls += 1; received = n; };
    for (let i = 0; i < 5; i += 1) sys.update(1 / 60);
    expect(calls).toBe(1);
    expect(received!.towerCount).toBe(4);
    expect(received!.ringSkill.energyCost).toBe(2);
    for (let i = 0; i < 60 * 3; i += 1) sys.update(1 / 60); // >2s 限時
    expect(nodeIdx(sys)).toBeGreaterThanOrEqual(1);
  });

  it('無 onMineTrap/onTowerWave 回呼也不炸（optional，仍會前進）', () => {
    const level = { id: 'L', nodes: [{ ...MINE, delaySec: 0, paralyzeSec: 0 }, { nodeType: 'Reward' }] } as unknown as LevelData;
    const sys = makeWave([level]);
    expect(() => { for (let i = 0; i < 60 * 2; i += 1) sys.update(1 / 60); }).not.toThrow();
    expect(nodeIdx(sys)).toBeGreaterThanOrEqual(1);
  });
});
