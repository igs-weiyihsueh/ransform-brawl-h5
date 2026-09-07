// @vitest-environment jsdom
/**
 * 波次系統 2 項（用戶要，波騎）：
 *   #1 火雨訊息晚於「第 N 波」波次宣告 —— 進帶 attachFireRain 的 Spawn 節點後，
 *      getActiveFireRainPreset() 有一段 gate 窗回 null（FireRainSystem 因此延後「天降火雨！」宣告），
 *      gate 跑完才回 preset。gate = WAVE_MESSAGE_FX.durationSec。
 *   #2 Spawn→Spawn 維持場上怪數（對齊 Unity 不清場）—— 前一波殘怪接續帶進下一 Spawn 節點，
 *      不呼 clearAllEnemies；新節點以真實 alive（含殘怪）補生維持 maxAlive。
 *
 * 壞版必紅：
 *   #1 壞版（進節點即回 preset、無 gate）→ gate 窗內就 non-null → 紅。
 *   #2 壞版（Spawn→Spawn advance 清場）→ 殘怪歸零 → 紅。
 */
import { describe, expect, it, vi } from 'vitest';
import { WaveSystem } from '@/systems/WaveSystem';
import { WAVE_MESSAGE_FX } from '@/systems/waveMessage';
import type { GameContext } from '@/systems/GameContext';
import type { LevelData } from '@/config/levelSchema';

/** 極簡假敵人（只需 isDead()）。 */
class FakeEnemy {
  private dead = false;
  isDead(): boolean { return this.dead; }
  kill(): void { this.dead = true; }
}

/** 建含 spawner/getEnemies/effects 的 fake ctx + WaveSystem，注入 levels 避免 fetch。 */
function makeWave(levels: LevelData[]): { sys: WaveSystem; live: FakeEnemy[]; waveMsgs: string[] } {
  const live: FakeEnemy[] = [];
  const waveMsgs: string[] = [];
  const ctx = {
    players: [{ playerId: 0 }],
    player: { getPosition: () => ({ x: 0, y: 0 }) },
    getEnemies: () => live.filter((e) => !e.isDead()),
    spawner: {
      spawn: (_t: string, _x: number, _y: number) => { const e = new FakeEnemy(); live.push(e); return e; },
      clearAllEnemies: () => { for (const e of live) e.kill(); },
    },
    effects: {
      waveMessage: (t: string) => { waveMsgs.push(t); },
      // spawnWarning 不提供 → spawnOne 走「無預警直接生」路徑（見 WaveSystem fallback）
    },
  } as unknown as GameContext;
  const sys = new WaveSystem(levels);
  sys.init(ctx);
  return { sys, live, waveMsgs };
}

const getFR = (sys: WaveSystem): unknown =>
  (sys as unknown as { getActiveFireRainPreset: () => unknown }).getActiveFireRainPreset();

function spawnLevel(overrides: Record<string, unknown> = {}): LevelData {
  return {
    nodes: [
      {
        nodeType: 'Spawn',
        killQuota: 5,
        maxAlive: 4,
        spawnThreshold: 4,
        spawnInterval: 0, // 每 tick 可補
        spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }],
        ...overrides,
      },
    ],
  } as unknown as LevelData;
}

describe('#1 火雨訊息晚於波次宣告（fireRainGate）', () => {
  it('進帶 attachFireRain 的 Spawn 節點：gate 窗內 getActiveFireRainPreset() 回 null', () => {
    const { sys } = makeWave([spawnLevel({ attachFireRain: 'FireRain' })]);
    // 剛進節點：波次宣告已發、火雨仍被 gate 按住 → null
    expect(getFR(sys)).toBeNull();
  });

  it('gate 跑完（>= WAVE_MESSAGE_FX.durationSec）後 → 回火雨 preset（non-null）', () => {
    const { sys } = makeWave([spawnLevel({ attachFireRain: 'FireRain' })]);
    expect(getFR(sys)).toBeNull(); // gate 窗內
    // 推進超過 gate 時長
    sys.update(WAVE_MESSAGE_FX.durationSec + 0.05);
    expect(getFR(sys)).not.toBeNull(); // gate 開 → 火雨可降
  });

  it('波次宣告「第 1 波」確實在 gate 前就發出（訊息先於火雨）', () => {
    const { sys, waveMsgs } = makeWave([spawnLevel({ attachFireRain: 'FireRain' })]);
    // 進節點當下波次宣告已發，而火雨此刻仍 null → 宣告在前
    expect(waveMsgs.length).toBe(1);
    expect(getFR(sys)).toBeNull();
  });

  it('無 attachFireRain 的 Spawn：gate=0，不影響（本就無火雨→null）', () => {
    const { sys } = makeWave([spawnLevel()]);
    expect(getFR(sys)).toBeNull(); // 無火雨
    sys.update(0.016);
    expect(getFR(sys)).toBeNull();
  });
});

describe('#2 Spawn→Spawn 維持場上怪數（不清場、殘怪接續）', () => {
  it('第一波殺滿 quota 前進到第二 Spawn 節點：殘怪不被清場（clearAllEnemies 未呼）', () => {
    const level: LevelData = {
      nodes: [
        { nodeType: 'Spawn', killQuota: 2, maxAlive: 3, spawnThreshold: 3, spawnInterval: 0, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }] },
        { nodeType: 'Spawn', killQuota: 5, maxAlive: 3, spawnThreshold: 3, spawnInterval: 0, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }] },
      ],
    } as unknown as LevelData;
    const { sys, live } = makeWave([level]);
    const clearSpy = vi.spyOn((sys as unknown as { ctx: GameContext }).ctx.spawner, 'clearAllEnemies');

    // 跑數幀讓第一波生怪
    for (let i = 0; i < 6; i += 1) sys.update(0.016);
    const aliveBeforeAdvance = live.filter((e) => !e.isDead()).length;
    expect(aliveBeforeAdvance).toBeGreaterThan(0); // 場上有怪

    // 殺滿 quota=2（殺兩隻），保留其餘殘怪
    const alives = live.filter((e) => !e.isDead());
    alives[0].kill();
    if (alives[1]) alives[1].kill();
    // 再跑幀 → tallyKills 記擊殺、nextIsSpawn=true → 殺滿即 advance（不需場空）
    for (let i = 0; i < 3; i += 1) sys.update(0.016);

    // Spawn→Spawn advance 不清場：clearAllEnemies 從未被呼叫
    expect(clearSpy).not.toHaveBeenCalled();
    // 已進第二節點（nodeIndex=1）
    expect((sys as unknown as { getNodeIndex: () => number }).getNodeIndex()).toBe(1);
  });

  it('進第二 Spawn 節點後：以真實 alive（含殘怪）補生，維持 maxAlive（不超生、不空場）', () => {
    const level: LevelData = {
      nodes: [
        { nodeType: 'Spawn', killQuota: 1, maxAlive: 3, spawnThreshold: 3, spawnInterval: 0, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }] },
        { nodeType: 'Spawn', killQuota: 10, maxAlive: 3, spawnThreshold: 3, spawnInterval: 0, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }] },
      ],
    } as unknown as LevelData;
    const { sys, live } = makeWave([level]);
    // 第一波補到 maxAlive
    for (let i = 0; i < 6; i += 1) sys.update(0.016);
    // 殺一隻滿 quota=1 → advance（nextIsSpawn）
    live.filter((e) => !e.isDead())[0]?.kill();
    for (let i = 0; i < 3; i += 1) sys.update(0.016);
    expect((sys as unknown as { getNodeIndex: () => number }).getNodeIndex()).toBe(1);

    // 第二節點跑幀：維持在 maxAlive（含殘怪），不超過 maxAlive
    for (let i = 0; i < 10; i += 1) sys.update(0.016);
    const alive = live.filter((e) => !e.isDead()).length;
    expect(alive).toBeLessThanOrEqual(3); // 不超生
    expect(alive).toBeGreaterThan(0); // 不空場（維持場面）
  });
});
