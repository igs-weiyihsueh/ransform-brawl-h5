// @vitest-environment jsdom
/**
 * 波次 group 分層 階段①（用戶：多 group 並行 drip；蟲騎對照瓢蟲 Cultivarium）。
 * - 多 group 各自獨立維持場上數（各 maxConcurrent），並行不互相干擾。
 * - killQuota 仍 node 層全場過關（全場擊殺累積），group 不參與過關判定。
 * - ★向後相容：無 groups 的舊 Spawn node 走扁平單流、行為不變。
 * - minConcurrent optional：省略→門檻＝maxConcurrent（<max 即補）。
 */
import { describe, expect, it } from 'vitest';
import { WaveSystem } from '@/systems/WaveSystem';
import { validateLevels, LEVELS_SCHEMA_VERSION } from '@/config/levelSchema';
import type { GameContext } from '@/systems/GameContext';
import type { LevelData, LevelsFile } from '@/config/levelSchema';

class FakeEnemy {
  readonly type: string;
  private d = false;
  constructor(t: string) { this.type = t; }
  isDead(): boolean { return this.d; }
  kill(): void { this.d = true; }
}

function makeWave(levels: LevelData[]): { sys: WaveSystem; live: FakeEnemy[] } {
  const live: FakeEnemy[] = [];
  const ctx = {
    players: [{ playerId: 0 }],
    player: { getPosition: () => ({ x: 0, y: 0 }) },
    getEnemies: () => live.filter((e) => !e.isDead()),
    spawner: {
      spawn: (t: string) => { const e = new FakeEnemy(t); live.push(e); return e; },
      clearAllEnemies: () => { for (const e of live) e.kill(); },
    },
    effects: { waveMessage: () => {} }, // 無 spawnWarning → 即時生
  } as unknown as GameContext;
  const sys = new WaveSystem(levels);
  sys.init(ctx);
  return { sys, live };
}
const aliveOf = (live: FakeEnemy[], t: string): number => live.filter((e) => !e.isDead() && e.type === t).length;
const nodeIdx = (sys: WaveSystem): number => (sys as unknown as { getNodeIndex: () => number }).getNodeIndex();

describe('group 分層 — 多 group 並行 drip 各自維持', () => {
  it('★ 雜兵狂刷(max8)+遠程零星(max2)+菁英偶爾(max1) 各自維持在自己 maxConcurrent', () => {
    const level: LevelData = {
      id: 'g',
      nodes: [{
        nodeType: 'Spawn', killQuota: 999, maxAlive: 99, spawnThreshold: 99, spawnInterval: 1,
        spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }], // 相容欄位（有 groups 時不走）
        groups: [
          { label: '雜兵', spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }], spawnInterval: 0.2, maxConcurrent: 8 },
          { label: '遠程', spawns: [{ enemyType: 'Enemy_Ranged', weight: 1 }], spawnInterval: 1.5, maxConcurrent: 2 },
          { label: '菁英', spawns: [{ enemyType: 'Enemy_Elite', weight: 1 }], spawnInterval: 4, maxConcurrent: 1 },
        ],
      }],
    } as unknown as LevelData;
    const { sys, live } = makeWave([level]);
    for (let i = 0; i < 60 * 8; i += 1) sys.update(1 / 60); // 8s 充分補滿
    expect(aliveOf(live, 'Enemy_Rush')).toBe(8); // 各自到 maxConcurrent
    expect(aliveOf(live, 'Enemy_Ranged')).toBe(2);
    expect(aliveOf(live, 'Enemy_Elite')).toBe(1);
  });

  it('★ 某 group 被清光會自動補回自己 maxConcurrent（各自獨立維持，不影響他組）', () => {
    const level: LevelData = {
      id: 'g',
      nodes: [{
        nodeType: 'Spawn', killQuota: 999, maxAlive: 99, spawnThreshold: 99, spawnInterval: 1,
        spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }],
        groups: [
          { spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }], spawnInterval: 0.15, maxConcurrent: 5 },
          { spawns: [{ enemyType: 'Enemy_Ranged', weight: 1 }], spawnInterval: 0.15, maxConcurrent: 3 },
        ],
      }],
    } as unknown as LevelData;
    const { sys, live } = makeWave([level]);
    for (let i = 0; i < 60 * 3; i += 1) sys.update(1 / 60);
    expect(aliveOf(live, 'Enemy_Rush')).toBe(5);
    expect(aliveOf(live, 'Enemy_Ranged')).toBe(3);
    // 殺光 Rush → 應補回 5，Ranged 不受影響仍 3。
    live.filter((e) => !e.isDead() && e.type === 'Enemy_Rush').forEach((e) => e.kill());
    for (let i = 0; i < 60 * 3; i += 1) sys.update(1 / 60);
    expect(aliveOf(live, 'Enemy_Rush')).toBe(5); // 補回
    expect(aliveOf(live, 'Enemy_Ranged')).toBe(3); // 不受影響
  });

  it('killQuota 仍 node 層全場過關：擊殺累積達標 → 前進（group 不帶過關數）', () => {
    const level: LevelData = {
      id: 'g',
      nodes: [
        {
          nodeType: 'Spawn', killQuota: 6, maxAlive: 99, spawnThreshold: 99, spawnInterval: 1,
          spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }],
          groups: [{ spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }], spawnInterval: 0.1, maxConcurrent: 3 }],
        },
        { nodeType: 'Reward', rewardTickets: 5 } as unknown as LevelData['nodes'][number],
      ],
    } as unknown as LevelData;
    const { sys, live } = makeWave([level]);
    // 持續殺：每幀殺一隻活怪 → 累計擊殺推進 killQuota=6，達標且場清才進 Reward。
    for (let i = 0; i < 60 * 6; i += 1) {
      const a = live.filter((e) => !e.isDead());
      if (a.length > 0 && i % 6 === 0) a[0].kill();
      sys.update(1 / 60);
      if (nodeIdx(sys) >= 1) break;
    }
    expect(nodeIdx(sys)).toBeGreaterThanOrEqual(1); // 全場 killQuota 達標 → 已離開 Spawn 節點
  });
});

describe('group 分層 — 向後相容（無 groups 走扁平單流）', () => {
  it('★ 舊 Spawn node（無 groups）行為不變：補到 maxAlive 維持', () => {
    const level: LevelData = {
      id: 'flat',
      nodes: [{
        nodeType: 'Spawn', killQuota: 999, maxAlive: 6, spawnThreshold: 6, spawnInterval: 0.15,
        spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }],
        // 無 groups
      }],
    } as unknown as LevelData;
    const { sys, live } = makeWave([level]);
    for (let i = 0; i < 60 * 4; i += 1) sys.update(1 / 60);
    expect(live.filter((e) => !e.isDead()).length).toBe(6); // 扁平單流補到 maxAlive
  });

  it('空 groups[] 也走扁平（不因空陣列誤入 group 路徑）', () => {
    const level: LevelData = {
      id: 'flat2',
      nodes: [{
        nodeType: 'Spawn', killQuota: 999, maxAlive: 4, spawnThreshold: 4, spawnInterval: 0.15,
        spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }],
        groups: [],
      }],
    } as unknown as LevelData;
    const { sys, live } = makeWave([level]);
    for (let i = 0; i < 60 * 3; i += 1) sys.update(1 / 60);
    expect(live.filter((e) => !e.isDead()).length).toBe(4);
  });
});

describe('group 分層 — schema 驗證（validateLevels）', () => {
  const wrap = (node: unknown): LevelsFile => ({
    version: LEVELS_SCHEMA_VERSION,
    levels: [{ id: 'L', nodes: [node] } as unknown as LevelData],
  });
  const spawnBase = {
    nodeType: 'Spawn', killQuota: 5, maxAlive: 5, spawnThreshold: 3, spawnInterval: 0.5,
    spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }],
  };

  it('★ 合法多 group 放行（含 minConcurrent 選填）', () => {
    const r = validateLevels(wrap({
      ...spawnBase,
      groups: [
        { label: '雜兵', spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }], spawnInterval: 0.2, maxConcurrent: 8, minConcurrent: 4 },
        { spawns: [{ enemyType: 'Enemy_Ranged', weight: 1 }], spawnInterval: 1.5, maxConcurrent: 2 },
      ],
    }));
    expect(r.ok).toBe(true);
  });

  it('★ 舊扁平 node（無 groups）仍合法（向後相容）', () => {
    expect(validateLevels(wrap(spawnBase)).ok).toBe(true);
  });

  it('壞 group：maxConcurrent 非正 / spawnInterval 缺 / spawns 空 → 擋', () => {
    expect(validateLevels(wrap({ ...spawnBase, groups: [{ spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }], spawnInterval: 0.2, maxConcurrent: 0 }] })).ok).toBe(false);
    expect(validateLevels(wrap({ ...spawnBase, groups: [{ spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }], maxConcurrent: 3 }] })).ok).toBe(false);
    expect(validateLevels(wrap({ ...spawnBase, groups: [{ spawns: [], spawnInterval: 0.2, maxConcurrent: 3 }] })).ok).toBe(false);
  });

  it('壞 group：minConcurrent > maxConcurrent → 擋', () => {
    expect(validateLevels(wrap({ ...spawnBase, groups: [{ spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }], spawnInterval: 0.2, maxConcurrent: 3, minConcurrent: 5 }] })).ok).toBe(false);
  });
});
