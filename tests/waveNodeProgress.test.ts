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

/**
 * Reward 節點：進度段自動填滿補間（對齊 Unity RunRewardNode rewardFillDuration=0.6s）。
 * 報獎流程期間 getNodeProgress=0；末段 0.6s 內 0→1 lerp 自動填滿（進度條動畫，非瞬跳）→ 前進。
 * isRewardActive() 供 ComboSystem 凍結 COMBO 倒數。
 */
const REWARD_LEVEL: LevelData[] = [
  {
    id: 'test-reward',
    nodes: [
      { nodeType: 'Reward', rewardTickets: 10 } as unknown as LevelData['nodes'][number],
      { nodeType: 'Reward', rewardTickets: 5 } as LevelData['nodes'][number],
    ],
  },
];
function makeRewardWave(): { sys: WaveSystem; onReward: () => number } {
  const sys = new WaveSystem(REWARD_LEVEL);
  let rewardCalls = 0;
  sys.onReward = () => { rewardCalls += 1; };
  sys.init({ players: [{ playerId: 0 }], player: { getPosition: () => ({ x: 0, y: 0 }) }, getEnemies: () => [], spawner: { spawn: () => ({ isDead: () => false }), clearAllEnemies: () => {} }, effects: { waveMessage: () => {} } } as unknown as GameContext);
  return { sys, onReward: () => rewardCalls };
}

describe('WaveSystem — Reward 進度自動填滿補間 + isRewardActive（對齊 Unity）', () => {
  it('★ 報獎流程期間 getNodeProgress=0；末段 0.6s 內 0→1 遞增（自動填滿動畫非瞬跳）', () => {
    const { sys } = makeRewardWave();
    // 進 Reward 節點第一幀：觸發 onReward、rewardHold=4.4，進度 0（報獎流程階段）。
    sys.update(1 / 60);
    expect(sys.getNodeProgress()).toBe(0);
    // 推進到報獎流程中段（hold 還 > 0.6）→ 仍 0（尚未進填滿段）。
    for (let i = 0; i < 60 * 2; i += 1) sys.update(1 / 60); // ~2s
    expect(sys.getNodeProgress()).toBe(0);
    // 推進到接近末段（hold 進入 <=0.6 填滿窗）→ 進度 > 0 且 < 1 且遞增。
    const samples: number[] = [];
    for (let i = 0; i < 60 * 2; i += 1) { // 再 ~2s（跨過填滿窗）
      sys.update(1 / 60);
      const idx = (sys as unknown as { getNodeIndex: () => number }).getNodeIndex();
      if (idx === 0) samples.push(sys.getNodeProgress()); // 仍在 Reward 節點時取樣
      if (idx >= 1) break; // 已前進到下一節點
    }
    // 填滿窗內應出現 0<p<1 的中間值（證明是 lerp 補間、非 0 直接跳 advance）。
    const mid = samples.filter((p) => p > 0 && p < 1);
    expect(mid.length).toBeGreaterThan(0);
    // 填滿是遞增的（單調不減）。
    for (let i = 1; i < samples.length; i += 1) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 1e-6);
  });

  it('填滿完 → 前進（離開第一 Reward 節點，nodeIndex >= 1）', () => {
    const { sys } = makeRewardWave();
    for (let i = 0; i < 60 * 6; i += 1) sys.update(1 / 60); // 6s > REWARD_HOLD_SEC 4.4
    expect((sys as unknown as { getNodeIndex: () => number }).getNodeIndex()).toBeGreaterThanOrEqual(1);
  });

  it('★ isRewardActive：Reward 表演中 true（供 ComboSystem 凍結 COMBO）', () => {
    const { sys } = makeRewardWave();
    sys.update(1 / 60);
    expect(sys.isRewardActive()).toBe(true); // Reward 表演中
  });
});
