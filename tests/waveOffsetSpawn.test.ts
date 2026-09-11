// @vitest-environment jsdom
/**
 * 關卡推進 step2 block-offset：WaveSystem 生怪 offset-aware（怪生在玩家當前 levelOffsetX 區塊，非原點）。
 * pickSpawnPosition 讀 effectiveEnemyPlayBounds()（＝ENEMY_PLAY_BOUNDS 平移當前 levelOffsetX，征騎 seam）。
 * ★連過多關 offset 累積 → 生怪 X 一直落在正確當前區塊（絕對累積 offset，非增量錯位，變身-leader flag）。
 * 依賴征騎 mapConfig seam：getLevelOffsetX / advanceLevelOffsetX / effectiveEnemyPlayBounds。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { WaveSystem } from '@/systems/WaveSystem';
import type { LevelData } from '@/config/levelSchema';
import type { GameContext } from '@/systems/GameContext';
import {
  MAP_BOUNDS, ENEMY_PLAY_BOUNDS, insetBounds,
  effectiveEnemyPlayBounds, getLevelOffsetX, advanceLevelOffsetX,
} from '@/config/mapConfig';
import { ENEMY_BODY_RADIUS_PX } from '@/config/enemyConfig';

const SPAWN_LEVEL: LevelData[] = [
  {
    id: 'L0',
    nodes: [
      { nodeType: 'Spawn', killQuota: 999, maxAlive: 3, spawnThreshold: 3, spawnInterval: 0.1,
        spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }] } as LevelData['nodes'][number],
    ],
  },
];

function makeWave(playerX: number): { sys: WaveSystem; spawns: { x: number; y: number }[] } {
  const spawns: { x: number; y: number }[] = [];
  const live: { isDead: () => boolean }[] = [];
  const sys = new WaveSystem(SPAWN_LEVEL);
  const ctx = {
    players: [{ playerId: 0 }],
    player: { getPosition: () => ({ x: playerX, y: 540 }) }, // 玩家在當前區塊
    getEnemies: () => live,
    spawner: {
      spawn: (_t: string, x: number, y: number) => { spawns.push({ x, y }); const e = { isDead: () => false }; live.push(e); return e; },
      clear: () => {}, clearAllEnemies: () => {},
    },
    effects: { waveMessage: () => {} }, // 無 spawnWarning → 即時生
  } as unknown as GameContext;
  sys.init(ctx);
  return { sys, spawns };
}

// 還原 offset（測試間不互相污染）：advanceLevelOffsetX 是累加，測完歸零。
beforeEach(() => { advanceLevelOffsetX(-getLevelOffsetX()); });

describe('WaveSystem 生怪 offset-aware（block-offset）', () => {
  it('offset=0（第一關）：生怪 X 落在原點 ENEMY_PLAY_BOUNDS inset 範圍內', () => {
    const b = insetBounds(ENEMY_PLAY_BOUNDS, ENEMY_BODY_RADIUS_PX);
    const { sys, spawns } = makeWave((b.minX + b.maxX) / 2);
    for (let i = 0; i < 60 * 2; i += 1) sys.update(1 / 60);
    expect(spawns.length).toBeGreaterThan(0);
    for (const s of spawns) {
      expect(s.x).toBeGreaterThanOrEqual(b.minX - 1);
      expect(s.x).toBeLessThanOrEqual(b.maxX + 1);
    }
  });

  it('★ offset=-1600（過一關往左）：生怪 X 落在平移後區塊，非原點', () => {
    advanceLevelOffsetX(-1600);
    expect(getLevelOffsetX()).toBe(-1600);
    const eb = insetBounds(effectiveEnemyPlayBounds(), ENEMY_BODY_RADIUS_PX);
    const { sys, spawns } = makeWave((eb.minX + eb.maxX) / 2);
    for (let i = 0; i < 60 * 2; i += 1) sys.update(1 / 60);
    expect(spawns.length).toBeGreaterThan(0);
    const originMax = insetBounds(ENEMY_PLAY_BOUNDS, ENEMY_BODY_RADIUS_PX).minX;
    for (const s of spawns) {
      expect(s.x).toBeGreaterThanOrEqual(eb.minX - 1);
      expect(s.x).toBeLessThanOrEqual(eb.maxX + 1);
      expect(s.x).toBeLessThan(originMax); // 落在原點區塊左邊（往左過關）＝不在原點
    }
  });

  it('★★ 連過 3 關（-1600×3 累積）：生怪 X 落在第 3 塊（絕對累積 offset，非增量錯位）', () => {
    advanceLevelOffsetX(-1600);
    advanceLevelOffsetX(-1600);
    advanceLevelOffsetX(-1600);
    expect(getLevelOffsetX()).toBe(-4800); // 絕對累積
    const eb = insetBounds(effectiveEnemyPlayBounds(), ENEMY_BODY_RADIUS_PX);
    const { sys, spawns } = makeWave((eb.minX + eb.maxX) / 2);
    for (let i = 0; i < 60 * 2; i += 1) sys.update(1 / 60);
    expect(spawns.length).toBeGreaterThan(0);
    // 第 3 塊的 X 範圍＝原點 - 4800。
    const expectMinX = insetBounds(ENEMY_PLAY_BOUNDS, ENEMY_BODY_RADIUS_PX).minX - 4800;
    const expectMaxX = insetBounds(ENEMY_PLAY_BOUNDS, ENEMY_BODY_RADIUS_PX).maxX - 4800;
    for (const s of spawns) {
      expect(s.x).toBeGreaterThanOrEqual(expectMinX - 1);
      expect(s.x).toBeLessThanOrEqual(expectMaxX + 1);
    }
  });
});
