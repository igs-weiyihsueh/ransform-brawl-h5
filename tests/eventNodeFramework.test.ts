/**
 * 2 新事件（單一架構重構版）：
 * - 地雷=附加類：Spawn/Event 節點 attachMineTrap（地雷 preset 名）→ WaveSystem.getActiveMinePreset() 回該 preset。
 * - 魔尖塔=單獨波次：Event 節點 eventPresetName=tower preset → onTowerWave(TowerPreset) + 勝敗雙結束（失敗不 GameOver）。
 * - 純 eventPresetName 分派（無 eventType）；火雨/守護 preset 沿用。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { validateLevels } from '@/config/levelSchema';
import { WaveSystem, type TowerPreset } from '@/systems/WaveSystem';
import { clearResolvedMineCache } from '@/config/mineSchema';
import { clearResolvedTowerCache } from '@/config/towerSchema';
import { WAVE_MESSAGE_FX } from '@/systems/waveMessage';
import type { LevelData, LevelsFile } from '@/config/levelSchema';
import type { MinePreset } from '@/config/mineConfig';

function wrap(nodes: unknown[]): LevelsFile {
  return { version: 1, levels: [{ id: 'L1', nodes } as unknown as LevelData] };
}

/** 最小 GameContext stub（只給 WaveSystem 用到的 effects/spawner/players）。 */
function makeWave(nodes: unknown[]): WaveSystem {
  const ws = new WaveSystem(wrap(nodes).levels);
  const ctx = {
    effects: { waveMessage: () => {}, fireRainAnnounce: () => {} },
    spawner: { spawn: () => ({}), clear: () => {} },
    players: [],
    player: { getPosition: () => ({ x: 0, y: 0 }) },
    getEnemies: () => [],
  } as unknown as Parameters<WaveSystem['init']>[0];
  ws.init(ctx);
  return ws;
}

beforeEach(() => {
  clearResolvedMineCache();
  clearResolvedTowerCache();
});

describe('地雷=附加類 attachMineTrap → getActiveMinePreset', () => {
  it('Spawn 節點帶 attachMineTrap=Mine → gate 窗內回 null、gate 跑完回該 preset（訊息時機比照火雨）', () => {
    const ws = makeWave([
      { nodeType: 'Spawn', killQuota: 1, maxAlive: 1, spawnThreshold: 1, spawnInterval: 1, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }], attachMineTrap: 'Mine' },
    ]);
    // 進節點後 mineGate 窗內：地雷先按住（讓「第 N 波」波次宣告先顯示）→ null。
    expect(ws.getActiveMinePreset()).toBeNull();
    // gate 跑完（>= WAVE_MESSAGE_FX.durationSec）→ 開放撒地雷，回該 preset。
    ws.update(WAVE_MESSAGE_FX.durationSec + 0.05);
    const p: MinePreset | null = ws.getActiveMinePreset();
    expect(p).not.toBeNull();
    expect(p!.count).toBeGreaterThan(0);
    expect(p!.maintainCount).toBeGreaterThan(0);
    expect(p!.respawnDelaySec).toBeGreaterThanOrEqual(0);
  });

  it('無 attachMineTrap → getActiveMinePreset 回 null（gate 前後皆 null）', () => {
    const ws = makeWave([
      { nodeType: 'Spawn', killQuota: 1, maxAlive: 1, spawnThreshold: 1, spawnInterval: 1, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }] },
    ]);
    expect(ws.getActiveMinePreset()).toBeNull();
    ws.update(WAVE_MESSAGE_FX.durationSec + 0.05);
    expect(ws.getActiveMinePreset()).toBeNull();
  });
});

describe('魔尖塔=單獨波次 Event eventPresetName=tower preset', () => {
  it('進 Tower4 事件 → onTowerWave 帶 TowerPreset（towerCount>0）', () => {
    const ws = makeWave([{ nodeType: 'Event', eventPresetName: 'Tower4' }]);
    let got: TowerPreset | null = null;
    ws.onTowerWave = (p) => { got = p; };
    ws.update(0.016);
    expect(got).not.toBeNull();
    expect(got!.towerCount).toBe(4);
    expect(got!.ringSkill.ringCount).toBeGreaterThan(0);
  });

  it('打完全部尖塔 → onTowerWaveResult(true) + 前進', () => {
    const ws = makeWave([
      { nodeType: 'Event', eventPresetName: 'Tower4' },
      { nodeType: 'Reward' },
    ]);
    let won: boolean | null = null;
    ws.onTowerWaveResult = (w) => { won = w; };
    ws.update(0.016); // 觸發，生 4 塔
    for (let i = 0; i < 4; i += 1) ws.notifyTowerDestroyed();
    ws.update(0.016); // 判過關
    expect(won).toBe(true);
    expect(ws.getNodeIndex()).toBe(1); // 前進到 Reward
  });

  it('限時到沒打完 → onTowerWaveResult(false) + 前進（不 GameOver）', () => {
    const ws = makeWave([
      { nodeType: 'Event', eventPresetName: 'Tower4' },
      { nodeType: 'Reward' },
    ]);
    let won: boolean | null = null;
    ws.onTowerWaveResult = (w) => { won = w; };
    ws.update(0.016); // 觸發
    // 不打塔，硬推超過限時（Tower4=60s）
    for (let i = 0; i < 61 * 60; i += 1) ws.update(1 / 60);
    expect(won).toBe(false);
    expect(ws.getNodeIndex()).toBe(1); // 仍前進（不卡、不 GameOver）
  });
});

describe('schema：attachMineTrap + tower preset Event 驗證', () => {
  it('合法 attachMineTrap（Spawn）通過', () => {
    const r = validateLevels(wrap([
      { nodeType: 'Spawn', killQuota: 1, maxAlive: 1, spawnThreshold: 1, spawnInterval: 1, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }], attachMineTrap: 'Mine' },
    ]));
    expect(r.ok).toBe(true);
  });

  it('attachMineTrap 非字串 → 擋', () => {
    const r = validateLevels(wrap([
      { nodeType: 'Spawn', killQuota: 1, maxAlive: 1, spawnThreshold: 1, spawnInterval: 1, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }], attachMineTrap: 123 },
    ]));
    expect(r.ok).toBe(false);
  });

  it('Event eventPresetName=tower preset 通過（純字串驗證）', () => {
    const r = validateLevels(wrap([{ nodeType: 'Event', eventPresetName: 'Tower4' }]));
    expect(r.ok).toBe(true);
  });

  it('Event 缺 eventPresetName → 擋', () => {
    const r = validateLevels(wrap([{ nodeType: 'Event' }]));
    expect(r.ok).toBe(false);
  });

  it('向後相容：守護波 Event（Guard60）仍通過', () => {
    const r = validateLevels(wrap([{ nodeType: 'Event', eventPresetName: 'Guard60' }]));
    expect(r.ok).toBe(true);
  });
});
