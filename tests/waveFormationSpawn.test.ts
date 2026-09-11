// @vitest-environment jsdom
/**
 * 陣型波次生成端接線（怪物 AI 第 2 塊閉環）：WaveSystem Spawn 節點有 node.formation →
 * 進節點呼一次 ctx.spawner.spawnFormation(config, anchor)（一次生齊、不 drip）；無 → 現有散兵 drip。
 * ★anchor offset-aware（可走區中心+levelOffsetX）；killQuota 照掃 getEnemies 判過關。
 * spawnFormation/EnemyFormation 是征騎執行系統，此處 stub 攔截驗「呼一次+參數+不 drip」。
 */
import { describe, expect, it } from 'vitest';
import { WaveSystem } from '@/systems/WaveSystem';
import type { LevelData, FormationConfig } from '@/config/levelSchema';
import type { GameContext } from '@/systems/GameContext';

const FORMATION: FormationConfig = { type: 'Line', count: 6, distance: 1.2, facingDeg: 90, enemyType: 'Enemy_Rush' };

describe('陣型波次生成端接線', () => {
  it('★ node.formation 有 → 進節點呼一次 spawnFormation(config, anchor)、不 drip', () => {
    const formationCalls: { config: unknown; anchor: { x: number; y: number } }[] = [];
    let dripSpawns = 0;
    const live: { isDead: () => boolean }[] = [];
    const level: LevelData[] = [{
      id: 'L0',
      nodes: [
        { nodeType: 'Spawn', killQuota: 3, maxAlive: 6, spawnThreshold: 6, spawnInterval: 0.1,
          spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }], formation: FORMATION } as LevelData['nodes'][number],
      ],
    }];
    const sys = new WaveSystem(level);
    sys.init({
      players: [{ playerId: 0 }],
      player: { getPosition: () => ({ x: 500, y: 500 }) },
      getEnemies: () => live,
      spawner: {
        spawn: () => { dripSpawns += 1; const e = { isDead: () => false }; live.push(e); return e; },
        clear: () => {}, clearAllEnemies: () => { live.length = 0; },
        spawnFormation: (config: unknown, anchor: { x: number; y: number }) => { formationCalls.push({ config, anchor }); return {}; },
      },
      effects: { waveMessage: () => {} },
    } as unknown as GameContext);
    for (let i = 0; i < 60 * 2; i += 1) sys.update(1 / 60);
    expect(formationCalls.length).toBe(1); // 只呼一次
    expect(formationCalls[0].config).toBe(FORMATION); // 直接傳 node.formation
    expect(typeof formationCalls[0].anchor.x).toBe('number'); // anchor Vec2
    expect(dripSpawns).toBe(0); // ★不 drip（有 formation 不跑 spawnOne）
  });

  it('★ node.formation 無 → 現有散兵 drip（不呼 spawnFormation）', () => {
    const formationCalls: unknown[] = [];
    let dripSpawns = 0;
    const live: { isDead: () => boolean }[] = [];
    const level: LevelData[] = [{
      id: 'L0',
      nodes: [
        { nodeType: 'Spawn', killQuota: 999, maxAlive: 4, spawnThreshold: 4, spawnInterval: 0.1,
          spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }] } as LevelData['nodes'][number],
      ],
    }];
    const sys = new WaveSystem(level);
    sys.init({
      players: [{ playerId: 0 }],
      player: { getPosition: () => ({ x: 500, y: 500 }) },
      getEnemies: () => live,
      spawner: {
        spawn: () => { dripSpawns += 1; const e = { isDead: () => false }; live.push(e); return e; },
        clear: () => {}, clearAllEnemies: () => { live.length = 0; },
        spawnFormation: () => { formationCalls.push(1); return {}; },
      },
      effects: { waveMessage: () => {} },
    } as unknown as GameContext);
    for (let i = 0; i < 60 * 2; i += 1) sys.update(1 / 60);
    expect(formationCalls.length).toBe(0); // 散兵不呼 spawnFormation
    expect(dripSpawns).toBeGreaterThan(0); // 現有 drip 照生
  });
});
