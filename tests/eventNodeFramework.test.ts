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
import { TOWER_MESSAGE_DEFAULTS } from '@/config/towerConfig';
import type { LevelData, LevelsFile } from '@/config/levelSchema';

/** 塔波 gate 時長＝eventTextDurationSec + timedEventText 滑進+滑出 0.75s（Bug1：等大字全程結束）；測試推過此值才觸發生塔。 */
const TOWER_GATE_ADVANCE = TOWER_MESSAGE_DEFAULTS.eventTextDurationSec + 0.75 + 0.05;
import type { MinePreset } from '@/config/mineConfig';

function wrap(nodes: unknown[]): LevelsFile {
  return { version: 1, levels: [{ id: 'L1', nodes } as unknown as LevelData] };
}

/** 最小 GameContext stub（只給 WaveSystem 用到的 effects/spawner/players）。 */
function makeWave(nodes: unknown[]): WaveSystem {
  const ws = new WaveSystem(wrap(nodes).levels);
  const ctx = {
    effects: { waveMessage: () => {}, fireRainAnnounce: () => {} },
    spawner: { spawn: () => ({}), clear: () => {}, clearAllEnemies: () => {} },
    players: [],
    player: { getPosition: () => ({ x: 0, y: 0 }) },
    getEnemies: () => [],
  } as unknown as Parameters<WaveSystem['init']>[0];
  ws.init(ctx);
  return ws;
}

/** 變體：捕捉登場訊息呼叫（waveMessage 單段 / timedEventText 大字 / guardText 提示）測塔波/守護波開頭。 */
function makeWaveCapturingMsgs(nodes: unknown[]): {
  ws: WaveSystem; msgs: string[]; eventTexts: string[]; guardTexts: string[];
} {
  const msgs: string[] = [];
  const eventTexts: string[] = [];
  const guardTexts: string[] = [];
  const ws = new WaveSystem(wrap(nodes).levels);
  const ctx = {
    effects: {
      waveMessage: (t: string) => { msgs.push(t); },
      fireRainAnnounce: () => {},
      timedEventText: (_d: number, t: string) => { eventTexts.push(t); },
      guardText: (t: string) => { guardTexts.push(t); return { fadeOut: () => {} }; },
    },
    spawner: { spawn: () => ({}), clear: () => {}, clearAllEnemies: () => {} },
    players: [],
    player: { getPosition: () => ({ x: 0, y: 0 }) },
    getEnemies: () => [],
  } as unknown as Parameters<WaveSystem['init']>[0];
  ws.init(ctx); // init 進節點 0 → enterNode（塔波兩段訊息）/ announceNode
  return { ws, msgs, eventTexts, guardTexts };
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

  it('①塔波節點帶 attachMineTrap → 聚焦壓黑期間不撒（towerCombatStarted=false→null）、endFocus 後才撒（照火雨 combat gate）', () => {
    const ws = makeWave([{ nodeType: 'Event', eventPresetName: 'Tower4', attachMineTrap: 'Mine' }]);
    ws.update(TOWER_GATE_ADVANCE); // 觸發生塔（聚焦壓黑，towerCombatStarted 仍 false）
    expect(ws.getActiveMinePreset()).toBeNull(); // ★登場/聚焦期間不撒地雷（上批只等 1.6s 的 bug 已修）
    ws.notifyTowerCombatStart(); // 征騎 endFocus 通知開打
    expect(ws.getActiveMinePreset()).not.toBeNull(); // combat 後才撒
  });
});

describe('魔尖塔=單獨波次 Event eventPresetName=tower preset', () => {
  it('進 Tower4 事件 → gate 內先不生塔、gate 跑完 onTowerWave 帶 TowerPreset（B4 比照火雨/地雷）', () => {
    const ws = makeWave([{ nodeType: 'Event', eventPresetName: 'Tower4' }]);
    let got: TowerPreset | null = null;
    ws.onTowerWave = (p) => { got = p; };
    ws.update(0.016); // gate 窗內：兩段訊息顯示中，先不生塔
    expect(got).toBeNull();
    expect(ws.isTowerWaveActive()).toBe(false);
    ws.update(TOWER_GATE_ADVANCE); // gate 跑完（塔波訊息顯完）→ 生塔
    expect(got).not.toBeNull();
    expect(got!.towerCount).toBe(4);
    expect(got!.ringSkill.ringCount).toBeGreaterThan(0);
  });

  it('Bug1 gate 時序：等第一段大字全程結束（eventTextDurationSec+0.75）才觸發，只等 eventTextDurationSec 還不觸發', () => {
    const ws = makeWave([{ nodeType: 'Event', eventPresetName: 'Tower4' }]); // eventTextDurationSec=3
    let got: TowerPreset | null = null;
    ws.onTowerWave = (p) => { got = p; };
    ws.update(3 + 0.05); // 只到 eventTextDurationSec → 大字還在滑出（+0.75 未到）→ 仍不觸發
    expect(got).toBeNull();
    expect(ws.isTowerWaveActive()).toBe(false);
    ws.update(0.75); // 補到全程結束 → 觸發
    expect(got).not.toBeNull();
    expect(ws.isTowerWaveActive()).toBe(true);
  });

  it('打完全部尖塔 → onTowerWaveResult(true) + 前進', () => {
    const ws = makeWave([
      { nodeType: 'Event', eventPresetName: 'Tower4' },
      { nodeType: 'Reward' },
    ]);
    let won: boolean | null = null;
    ws.onTowerWaveResult = (w) => { won = w; };
    ws.update(TOWER_GATE_ADVANCE); // gate 跑完，生 4 塔
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
    ws.update(TOWER_GATE_ADVANCE); // gate 跑完，生塔
    // 不打塔，推進到剛超過限時（Tower4=60s）觸發失敗前進；一到 Reward(idx1) 就停（避免 Reward 自身 hold 再前進）。
    for (let i = 0; i < 61 * 60 && ws.getNodeIndex() === 0; i += 1) ws.update(1 / 60);
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
    ws.update(TOWER_GATE_ADVANCE); // gate 跑完，生塔
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

describe('塔波登場訊息（Bug1：enterNode 只發第一段大字，第二段交征騎 beginFocus 不疊）', () => {
  it('進 Tower4 節點 → 只發 timedEventText 大字（introEventText）、★不發 guardText（避免與 beginFocus 疊）、不發單段 waveMessage', () => {
    const { msgs, eventTexts, guardTexts } = makeWaveCapturingMsgs([{ nodeType: 'Event', eventPresetName: 'Tower4' }]);
    expect(eventTexts.some((m) => m.includes('魔尖塔'))).toBe(true); // 第一段大字有發
    expect(guardTexts.length).toBe(0); // ★Bug1：enterNode 不預發第二段（征騎 TowerIntroSequence.beginFocus 才發）
    expect(msgs.length).toBe(0); // 不走單段 waveMessage
  });

  it('進 Guard60 守護波 → WaveSystem 不發節點 waveMessage（GuardEvent 自己開場）', () => {
    const { msgs } = makeWaveCapturingMsgs([{ nodeType: 'Event', eventPresetName: 'Guard60' }]);
    expect(msgs.length).toBe(0);
  });
});

describe('塔波附加雜兵 drip（Bug4 + #2 combat gate：drip 綁 towerCombatStarted，聚焦期間不生）', () => {
  function makeWaveCountingSpawn(nodes: unknown[]): { ws: WaveSystem; spawnCount: () => number; cleared: () => number } {
    let count = 0;
    let clears = 0;
    const ws = new WaveSystem(wrap(nodes).levels);
    const ctx = {
      effects: { waveMessage: () => {}, fireRainAnnounce: () => {}, timedEventText: () => {}, guardText: () => ({ fadeOut: () => {} }) },
      spawner: { spawn: () => { count += 1; return {}; }, clear: () => {}, clearAllEnemies: () => { clears += 1; } },
      players: [],
      player: { getPosition: () => ({ x: 0, y: 0 }) },
      getEnemies: () => [],
    } as unknown as Parameters<WaveSystem['init']>[0];
    ws.init(ctx);
    return { ws, spawnCount: () => count, cleared: () => clears };
  }

  it('#2 聚焦期間（未 notifyTowerCombatStart）→ 不生雜兵；endFocus 通知後才 drip', () => {
    const { ws, spawnCount } = makeWaveCountingSpawn([
      { nodeType: 'Event', eventPresetName: 'Tower4', maxAlive: 3, spawnThreshold: 3, spawnInterval: 0, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }] },
      { nodeType: 'Reward' },
    ]);
    ws.update(TOWER_GATE_ADVANCE); // gate 跑完、觸發生塔（聚焦壓黑，towerCombatStarted 仍 false）
    for (let i = 0; i < 5; i += 1) ws.update(0.1);
    expect(spawnCount()).toBe(0); // ★聚焦期間不生雜兵（drip gate 綁 combat）
    ws.notifyTowerCombatStart(); // 征騎 endFocus 通知開打
    for (let i = 0; i < 5; i += 1) ws.update(0.1);
    expect(spawnCount()).toBeGreaterThan(0); // 開打後才 drip
    // 過關仍只看塔數：打掉 4 塔 → 過關前進（雜兵不影響）。
    for (let i = 0; i < 4; i += 1) ws.notifyTowerDestroyed();
    ws.update(0.016);
    expect(ws.getNodeIndex()).toBe(1);
  });

  it('Tower4 無 spawns → 不生雜兵（即使 combat 開打）', () => {
    const { ws, spawnCount } = makeWaveCountingSpawn([{ nodeType: 'Event', eventPresetName: 'Tower4' }]);
    ws.update(TOWER_GATE_ADVANCE);
    ws.notifyTowerCombatStart();
    for (let i = 0; i < 5; i += 1) ws.update(0.1);
    expect(spawnCount()).toBe(0);
  });

  it('#3 限時到沒打完 → advanceNode 前 clearAllEnemies（清未打掉的塔）', () => {
    const { ws, cleared } = makeWaveCountingSpawn([
      { nodeType: 'Event', eventPresetName: 'Tower4' },
      { nodeType: 'Reward' },
    ]);
    ws.update(TOWER_GATE_ADVANCE); // 觸發生塔
    for (let i = 0; i < 61 * 60 && ws.getNodeIndex() === 0; i += 1) ws.update(1 / 60); // 推到限時到失敗
    expect(cleared()).toBeGreaterThan(0); // ★超時失敗有清場（清未打掉的塔）
    expect(ws.getNodeIndex()).toBe(1);
  });
});

describe('A1：魔尖塔波節點附加火雨（getActiveFireRainPreset 認 Tower 節點）', () => {
  it('Tower4 + attachFireRain=FireRain → gate 內 null、觸發後回火雨 preset', () => {
    const ws = makeWave([{ nodeType: 'Event', eventPresetName: 'Tower4', attachFireRain: 'FireRain' }]);
    const getFR = () => (ws as unknown as { getActiveFireRainPreset: () => unknown }).getActiveFireRainPreset();
    ws.update(0.016); // towerGate 窗內：塔沒生 → 火雨也先按住
    expect(getFR()).toBeNull();
    ws.update(TOWER_GATE_ADVANCE); // gate 跑完、塔生成 → 降火雨
    expect(getFR()).not.toBeNull();
  });

  it('Tower4 attachFireRain=none → 觸發後仍 null（明確無火雨）', () => {
    const ws = makeWave([{ nodeType: 'Event', eventPresetName: 'Tower4', attachFireRain: 'none' }]);
    const getFR = () => (ws as unknown as { getActiveFireRainPreset: () => unknown }).getActiveFireRainPreset();
    ws.update(TOWER_GATE_ADVANCE);
    expect(getFR()).toBeNull();
  });

  it('Tower4 無 attachFireRain → 觸發後 null', () => {
    const ws = makeWave([{ nodeType: 'Event', eventPresetName: 'Tower4' }]);
    const getFR = () => (ws as unknown as { getActiveFireRainPreset: () => unknown }).getActiveFireRainPreset();
    ws.update(TOWER_GATE_ADVANCE);
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
