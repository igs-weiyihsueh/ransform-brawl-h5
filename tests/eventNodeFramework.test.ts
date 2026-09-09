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

/** 變體：捕捉 waveMessage 呼叫（測塔波/守護波開頭訊息）。 */
function makeWaveCapturingMsgs(nodes: unknown[]): { ws: WaveSystem; msgs: string[] } {
  const msgs: string[] = [];
  const ws = new WaveSystem(wrap(nodes).levels);
  const ctx = {
    effects: { waveMessage: (t: string) => { msgs.push(t); }, fireRainAnnounce: () => {} },
    spawner: { spawn: () => ({}), clear: () => {} },
    players: [],
    player: { getPosition: () => ({ x: 0, y: 0 }) },
    getEnemies: () => [],
  } as unknown as Parameters<WaveSystem['init']>[0];
  ws.init(ctx); // init 進節點 0 → announceNode
  return { ws, msgs };
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
  it('進 Tower4 事件 → gate 內先不生塔、gate 跑完 onTowerWave 帶 TowerPreset（B4 比照火雨/地雷）', () => {
    const ws = makeWave([{ nodeType: 'Event', eventPresetName: 'Tower4' }]);
    let got: TowerPreset | null = null;
    ws.onTowerWave = (p) => { got = p; };
    ws.update(0.016); // gate 窗內：waveMessage 顯示中，先不生塔
    expect(got).toBeNull();
    expect(ws.isTowerWaveActive()).toBe(false);
    ws.update(WAVE_MESSAGE_FX.durationSec + 0.05); // gate 跑完 → 生塔
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
    ws.update(WAVE_MESSAGE_FX.durationSec + 0.05); // gate 跑完，生 4 塔
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
    ws.update(WAVE_MESSAGE_FX.durationSec + 0.05); // gate 跑完，生塔
    // 不打塔，硬推超過限時（Tower4=60s）
    for (let i = 0; i < 61 * 60; i += 1) ws.update(1 / 60);
    expect(won).toBe(false);
    expect(ws.getNodeIndex()).toBe(1); // 仍前進（不卡、不 GameOver）
  });
});

describe('魔尖塔波狀態 accessor（B5/B6 進度條+倒數）+ towerGate', () => {
  it('非塔波（Spawn）→ isTowerWaveActive false、其餘 accessor 回 0', () => {
    const ws = makeWave([
      { nodeType: 'Spawn', killQuota: 1, maxAlive: 1, spawnThreshold: 1, spawnInterval: 1, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }] },
    ]);
    expect(ws.isTowerWaveActive()).toBe(false);
    expect(ws.getTowerWaveDestroyed()).toBe(0);
    expect(ws.getTowerWaveTotal()).toBe(0);
    expect(ws.getTowerWaveRemaining()).toBe(0);
    expect(ws.getTowerWaveTimeLimit()).toBe(0);
  });

  it('towerGate 窗內 → isTowerWaveActive false（塔還沒生）；gate 跑完 → active、total=4、timeLimit=60', () => {
    const ws = makeWave([{ nodeType: 'Event', eventPresetName: 'Tower4' }]);
    ws.update(0.016); // gate 窗內
    expect(ws.isTowerWaveActive()).toBe(false); // 塔還沒生，進度條先不顯塔條
    expect(ws.getTowerWaveTotal()).toBe(0);
    ws.update(WAVE_MESSAGE_FX.durationSec + 0.05); // gate 跑完，生塔
    expect(ws.isTowerWaveActive()).toBe(true);
    expect(ws.getTowerWaveTotal()).toBe(4);
    expect(ws.getTowerWaveTimeLimit()).toBe(60);
    const rem0 = ws.getTowerWaveRemaining();
    expect(rem0).toBeGreaterThan(0);
    expect(rem0).toBeLessThanOrEqual(60);
    ws.notifyTowerDestroyed(); ws.notifyTowerDestroyed();
    expect(ws.getTowerWaveDestroyed()).toBe(2);
    ws.update(1); // 倒數遞減
    expect(ws.getTowerWaveRemaining()).toBeLessThan(rem0);
  });
});

describe('塔波登場開頭訊息（announceNode 對 tower 節點發 waveMessage，用戶爆氣修）', () => {
  it('進 Tower4 節點 → 發「魔尖塔！打掉尖塔！」開頭訊息（之前被 announceNode gate 掉）', () => {
    const { msgs } = makeWaveCapturingMsgs([{ nodeType: 'Event', eventPresetName: 'Tower4' }]);
    expect(msgs.some((m) => m.includes('魔尖塔'))).toBe(true);
  });

  it('進 Guard60 守護波 → 不發節點 waveMessage（有自己開場序列，避免重疊）', () => {
    const { msgs } = makeWaveCapturingMsgs([{ nodeType: 'Event', eventPresetName: 'Guard60' }]);
    expect(msgs.length).toBe(0);
  });
});

describe('A1：魔尖塔波節點附加火雨（getActiveFireRainPreset 認 Tower 節點）', () => {
  it('Tower4 + attachFireRain=FireRain → gate 內 null、觸發後回火雨 preset', () => {
    const ws = makeWave([{ nodeType: 'Event', eventPresetName: 'Tower4', attachFireRain: 'FireRain' }]);
    const getFR = () => (ws as unknown as { getActiveFireRainPreset: () => unknown }).getActiveFireRainPreset();
    ws.update(0.016); // towerGate 窗內：塔沒生 → 火雨也先按住
    expect(getFR()).toBeNull();
    ws.update(WAVE_MESSAGE_FX.durationSec + 0.05); // gate 跑完、塔生成 → 降火雨
    expect(getFR()).not.toBeNull();
  });

  it('Tower4 attachFireRain=none → 觸發後仍 null（明確無火雨）', () => {
    const ws = makeWave([{ nodeType: 'Event', eventPresetName: 'Tower4', attachFireRain: 'none' }]);
    const getFR = () => (ws as unknown as { getActiveFireRainPreset: () => unknown }).getActiveFireRainPreset();
    ws.update(WAVE_MESSAGE_FX.durationSec + 0.05);
    expect(getFR()).toBeNull();
  });

  it('Tower4 無 attachFireRain → 觸發後 null', () => {
    const ws = makeWave([{ nodeType: 'Event', eventPresetName: 'Tower4' }]);
    const getFR = () => (ws as unknown as { getActiveFireRainPreset: () => unknown }).getActiveFireRainPreset();
    ws.update(WAVE_MESSAGE_FX.durationSec + 0.05);
    expect(getFR()).toBeNull();
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
