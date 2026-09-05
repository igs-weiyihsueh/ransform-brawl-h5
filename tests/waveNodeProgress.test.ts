// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { WaveSystem } from '@/systems/WaveSystem';
import type { LevelData } from '@/config/levelSchema';
import type { GameContext } from '@/systems/GameContext';

/**
 * WaveSystem.getNodeProgress — 節點真實進度（用戶試玩 #3 修：開場累積 bug）。
 * #3 根源：ProgressBarSystem 原用硬回 1 的假 currentSegmentRatio（開場即滿+不前進）→
 * 改讀 WaveSystem.getNodeProgress 真值：Spawn=kills/quota、Event=已過/limit、其他=0。
 * 核心契約：開場(kills=0)=0（非硬回 1）。維度3 斷實際比例值，非 call-count。
 * ⚠️ kills 為 private，經 tallyKills 累計（需真 Enemy 才自然增加）；此處以反射設 kills
 *    驅動不同進度狀態，斷「輸出比例」這個可觀察行為（非測 tallyKills 內部）。
 */

const SPAWN_LEVEL: LevelData[] = [
  {
    id: 'test-spawn',
    nodes: [
      {
        nodeType: 'Spawn',
        killQuota: 4,
        maxAlive: 3,
        spawnThreshold: 1,
        spawnInterval: 1,
        spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }],
      } as LevelData['nodes'][number],
    ],
  },
];

function makeWave(): WaveSystem {
  const sys = new WaveSystem(SPAWN_LEVEL); // 注入關卡不 fetch
  sys.init({ players: [{ playerId: 0 }], getEnemies: () => [] } as unknown as GameContext);
  return sys;
}
/** 反射設 kills（驅動進度狀態；斷的是 getNodeProgress 輸出比例）。 */
function setKills(sys: WaveSystem, n: number): void {
  (sys as unknown as { kills: number }).kills = n;
}

describe('WaveSystem.getNodeProgress — Spawn 節點真實進度（修開場累積）', () => {
  it('★ 開場 kills=0 → getNodeProgress=0（非硬回 1，修 #3 開場即滿 bug 的核心契約）', () => {
    const sys = makeWave();
    expect(sys.getNodeProgress()).toBe(0);
  });

  it('半完成：kills=2 / quota4（1 人 scale1）→ 0.5', () => {
    const sys = makeWave();
    setKills(sys, 2);
    expect(sys.getNodeProgress()).toBeCloseTo(0.5);
  });

  it('滿：kills=4 / quota4 → 1', () => {
    const sys = makeWave();
    setKills(sys, 4);
    expect(sys.getNodeProgress()).toBe(1);
  });

  it('超過 → clamp 1（不超出）', () => {
    const sys = makeWave();
    setKills(sys, 10);
    expect(sys.getNodeProgress()).toBe(1);
  });

  it('隨 kills 遞增（進度單調上升）', () => {
    const sys = makeWave();
    setKills(sys, 1);
    const p1 = sys.getNodeProgress();
    setKills(sys, 3);
    const p3 = sys.getNodeProgress();
    expect(p3).toBeGreaterThan(p1);
  });
});
