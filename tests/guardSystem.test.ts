// @vitest-environment jsdom
import { describe, expect, it, beforeAll, afterAll, afterEach } from 'vitest';
import Phaser from 'phaser';
import { getGuardPreset, GUARD_FALLBACK, GUARD_PRESETS } from '@/config/guardConfig';
import { CHEST_OPEN_THRESHOLD } from '@/config/chestConfig';
import { GuardTarget } from '@/entities/GuardTarget';
import { GuardEvent } from '@/systems/GuardEvent';
import type { GameContext } from '@/systems/GameContext';

/**
 * 守護波測試（決策 76f235e4）：guardConfig 預設查詢 + GuardTarget HP/敗判定。
 * 含壞版必紅：查無預設用 fallback 不炸、HP 歸 0 翻敗、hpRatio。
 * GuardTarget 需 Phaser 場景 → jsdom + 一個最小 headless game 的 scene。
 */
describe('getGuardPreset — 名稱查詢 + fallback', () => {
  it('Guard60 查得到正確數值', () => {
    const p = getGuardPreset('Guard60');
    expect(p.timeLimit).toBe(60);
    expect(p.targetHP).toBe(100);
    expect(p.rewardTickets).toBe(10);
    expect(p).toBe(GUARD_PRESETS.Guard60);
  });

  it('查無預設 → 用 fallback（不炸）', () => {
    expect(getGuardPreset('Nope')).toBe(GUARD_FALLBACK);
    expect(getGuardPreset(undefined)).toBe(GUARD_FALLBACK);
  });
});

describe('GuardTarget — HP / 敗判定 / hpRatio', () => {
  let game: Phaser.Game;
  let scene: Phaser.Scene;

  function withScene(fn: (s: Phaser.Scene) => void): Promise<void> {
    return new Promise((resolve) => {
      class T extends Phaser.Scene {
        constructor() {
          super({ key: 'T' });
        }
        create() {
          scene = this;
          fn(this);
          resolve();
        }
      }
      game = new Phaser.Game({
        type: Phaser.HEADLESS,
        width: 100,
        height: 100,
        scene: [T],
        audio: { noAudio: true },
        banner: false,
      });
    });
  }

  it('初始 HP 滿、未敗、hpRatio 1', async () => {
    await withScene(() => {});
    const t = new GuardTarget(scene, 0, 0, 100);
    expect(t.getHp()).toBe(100);
    expect(t.isDefeated()).toBe(false);
    expect(t.getHpRatio()).toBe(1);
    game.destroy(true);
  });

  it('takeDamage 扣 HP（不低於 0）；歸 0 翻 isDefeated（不銷毀）', async () => {
    await withScene(() => {});
    const t = new GuardTarget(scene, 0, 0, 100);
    t.takeDamage(30);
    expect(t.getHp()).toBe(70);
    expect(t.getHpRatio()).toBeCloseTo(0.7);
    expect(t.isDefeated()).toBe(false);
    t.takeDamage(80); // 超過 → clamp 0
    expect(t.getHp()).toBe(0);
    expect(t.isDefeated()).toBe(true); // 翻敗
    game.destroy(true);
  });

  // 🔴 壞版對照：敗後再扣不應變負、isDefeated 維持 true。
  it('壞版對照：歸 0 後 takeDamage 不會變負、isDefeated 恆真', async () => {
    await withScene(() => {});
    const t = new GuardTarget(scene, 0, 0, 100);
    t.takeDamage(100);
    t.takeDamage(50);
    expect(t.getHp()).toBe(0); // 非負
    expect(t.isDefeated()).toBe(true);
    game.destroy(true);
  });
});

// ===========================================================================
// 深度強化（QA 測騎接手）：preset 查詢不變性 · GuardTarget HP 邊界 ·
// GuardEvent 勝敗狀態機 + 獎券公式 + 敗不 GameOver（cleanup/前進語意）。
// GuardTarget/GuardEvent 需 Phaser scene → 共用一個 HEADLESS scene（快、不每測起 game）。
// ===========================================================================

let sharedGame: Phaser.Game;
let sharedScene: Phaser.Scene;

// GuardEvent/GuardTarget 需 Phaser scene，共用一個 HEADLESS scene（快）。
// 🔴 儀器不可被受測系統污染（instrument-validity）：兩道防護，讓「壞版 mutation → 乾淨斷言紅」而非 OOM：
//   (1) afterEach 一律 destroy 本測建立的雕像（含壞版下事件不結束、未被 GuardEvent 自行 destroy 的），
//       避免在共用 scene 累積。
//   (2) 【真正的 OOM 根因修正】斷言不直接吃「持有 Phaser 物件的值」：
//       原本 `expect(state.guardTarget).toBeNull()` 在壞版下（雕像未清）會讓 vitest 去 diff 一個
//       帶【循環參照】的 Phaser GuardTarget → "invalid table size / heap OOM"（分不清紅是斷言抓到還是掛掉）。
//       改成 boolean 斷言 `expect(state.guardTarget === null).toBe(true)` → 失敗時只 diff 布林，
//       壞版產生【乾淨斷言紅】。通則：測 Phaser 相關邏輯時，斷言值收斂成 primitive，別把活物件丟進 expect diff。
const createdTargets: GuardTarget[] = [];

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    class Boot extends Phaser.Scene {
      constructor() {
        super({ key: 'Boot' });
      }
      create(): void {
        sharedScene = this;
        resolve();
      }
    }
    sharedGame = new Phaser.Game({
      type: Phaser.HEADLESS,
      width: 100,
      height: 100,
      scene: [Boot],
      audio: { noAudio: true },
      banner: false,
    });
  });
});

afterEach(() => {
  // 一律清掉本測建立的雕像（含壞版下「不結束」而未被 GuardEvent 自行 destroy 的），
  // 確保 harness 不被受測系統的失控狀態污染。
  for (const t of createdTargets) {
    try {
      t.destroy();
    } catch {
      // 已 destroy 的忽略。
    }
  }
  createdTargets.length = 0;
});

afterAll(() => {
  sharedGame?.destroy(true);
});

/** 建 GuardEvent 用的 fake ctx：抓 spawner 拿到的 target（模擬雕像被打）、記 chest 進度 + ticket。 */
function makeGuardCtx() {
  const state = {
    guardTarget: null as GuardTarget | null,
    enemies: [] as unknown[],
    spawnedCount: 0,
    clearedCalls: 0,
    ticketsAdded: 0,
    addCalls: 0,
    // 守護成功獎勵改為「加寶盒進度」(用戶決策 76f07f64)：記錄實際加進的 charge 量（可觀察行為）+ 呼叫次數。
    chestChargeAdded: 0,
    chestAddCalls: 0,
  };
  const ctx = {
    scene: sharedScene,
    player: { playerId: 0 }, // S5 chest per-player：GuardEvent.finish 讀 ctx.player.playerId
    getEnemies: () => state.enemies,
    spawner: {
      setGuardTarget: (t: GuardTarget | null) => {
        state.guardTarget = t;
        if (t) createdTargets.push(t); // 註冊給 afterEach 清理（防壞版累積）
      },
      spawn: () => {
        state.spawnedCount += 1;
      },
      clearAllEnemies: () => {
        state.clearedCalls += 1;
        state.enemies = [];
      },
    },
    // 寶盒 stub：記「實際加進多少 charge」(維度3：斷言可觀察的加值量，非只 call-count) + 呼叫次數。
    // S5：addCharge(playerId, amount) → 記第 2 參的量。
    chest: {
      addCharge: (_playerId: number, amount: number) => {
        state.chestChargeAdded += amount;
        state.chestAddCalls += 1;
      },
    },
    ticket: {
      addTickets: (_playerId: number, n: number) => {
        state.ticketsAdded += n;
        state.addCalls += 1;
      },
    },
  } as unknown as GameContext;
  return { ctx, state };
}

describe('getGuardPreset — 不變性/回傳同一參考', () => {
  it('查詢不改變預設表；Guard60 回同一物件參考（非複製）', () => {
    const before = { ...GUARD_PRESETS.Guard60 };
    const p = getGuardPreset('Guard60');
    expect(p).toBe(GUARD_PRESETS.Guard60); // 同參考
    expect(GUARD_PRESETS.Guard60).toEqual(before); // 查詢未動表
  });

  it('空字串也走 fallback（falsy name）', () => {
    expect(getGuardPreset('')).toBe(GUARD_FALLBACK);
  });
});

describe('GuardTarget — HP 邊界（1 未敗 / 恰 0 敗 / hpRatio clamp01）', () => {
  it('HP=1（扣到剩 1）未敗（邊界另一側）', async () => {
    const t = new GuardTarget(sharedScene, 0, 0, 100);
    t.takeDamage(99);
    expect(t.getHp()).toBe(1);
    expect(t.isDefeated()).toBe(false); // 1 > 0
    expect(t.getHpRatio()).toBeCloseTo(0.01);
  });

  it('恰好扣到 0 → 敗（邊界這一側）、hpRatio=0', () => {
    const t = new GuardTarget(sharedScene, 0, 0, 100);
    t.takeDamage(100);
    expect(t.getHp()).toBe(0);
    expect(t.isDefeated()).toBe(true);
    expect(t.getHpRatio()).toBe(0);
  });

  it('hpRatio 恆在 0..1（半血 0.5、滿血 1）', () => {
    const t = new GuardTarget(sharedScene, 0, 0, 100);
    expect(t.getHpRatio()).toBe(1);
    t.takeDamage(50);
    expect(t.getHpRatio()).toBeCloseTo(0.5);
  });
});

describe('GuardEvent — 勝敗狀態機 + 獎勵（改為加寶盒進度 addCharge，用戶決策 76f07f64）', () => {
  it('撐過時間(timer≤0)且 HP>0 → 勝，寶盒進度 += round(165 × hpRatio)（滿血 165）', () => {
    const { ctx, state } = makeGuardCtx();
    const ev = new GuardEvent(ctx, 'Guard60', ['Enemy_Rush']); // timeLimit60 HP100
    // 不打雕像（HP 滿）→ 跑滿 60s → 勝、寶盒進度 +round(165×1.0)=165（=一箱門檻）。
    const done = ev.update(60);
    expect(done).toBe(true);
    expect(ev.isFinished()).toBe(true);
    expect(ev.didWin()).toBe(true);
    expect(state.chestChargeAdded).toBe(CHEST_OPEN_THRESHOLD); // 滿 HP → 165（可觀察加值量）
    expect(state.ticketsAdded).toBe(0); // 已不再發彩票
  });

  it('勝但半血：寶盒進度 += round(165 × 0.5) = 83', () => {
    const { ctx, state } = makeGuardCtx();
    const ev = new GuardEvent(ctx, 'Guard60', ['Enemy_Rush']);
    state.guardTarget!.takeDamage(50); // HP 100→50（hpRatio 0.5，仍 >0）
    ev.update(60); // 撐過時間 → 勝
    expect(ev.didWin()).toBe(true);
    expect(state.chestChargeAdded).toBe(83); // round(165×0.5)=round(82.5)=83
  });

  it('倒數中 HP≤0 提早結束 → 敗，寶盒進度不加（不給獎勵、addCharge 不被呼叫）', () => {
    const { ctx, state } = makeGuardCtx();
    const ev = new GuardEvent(ctx, 'Guard60', ['Enemy_Rush']);
    state.guardTarget!.takeDamage(100); // 雕像被打爆
    const done = ev.update(1); // 倒數中就偵測到 defeated → 敗、提早結束
    expect(done).toBe(true);
    expect(ev.didWin()).toBe(false);
    expect(state.chestChargeAdded).toBe(0); // 敗不給獎勵
    expect(state.chestAddCalls).toBe(0); // 敗完全不呼叫 addCharge
  });

  it('邊界：timer 恰 0 且 HP=1 → 勝（撐過且 HP>0），寶盒進度 += round(165×0.01)=2', () => {
    const { ctx, state } = makeGuardCtx();
    const ev = new GuardEvent(ctx, 'Guard60', ['Enemy_Rush']);
    state.guardTarget!.takeDamage(99); // HP=1
    ev.update(60); // 恰好耗盡時間、HP=1>0 → 勝
    expect(ev.didWin()).toBe(true);
    // hpRatio=0.01 → round(165×0.01)=round(1.65)=2（撐過、血極低仍給 2 點進度）
    expect(state.chestChargeAdded).toBe(2);
  });

  it('🔴 敗不 GameOver：敗後 cleanup（清回玩家目標/清敵/destroy 雕像）且回報結束讓關卡前進', () => {
    const { ctx, state } = makeGuardCtx();
    const ev = new GuardEvent(ctx, 'Guard60', ['Enemy_Rush']);
    expect(state.guardTarget !== null).toBe(true); // 開場設了雕像為目標（用 boolean 避免 diff Phaser 物件）
    state.guardTarget!.takeDamage(100); // 敗
    const done = ev.update(1);
    // 語意：敗也結束（done=true 讓 WaveSystem advanceNode 前進），不是 gameover/不卡住。
    expect(done).toBe(true);
    expect(ev.isFinished()).toBe(true);
    // cleanup 發生：敵人目標清回（setGuardTarget(null)）、清全部敵人。
    expect(state.guardTarget === null).toBe(true); // 已 setGuardTarget(null)（boolean 斷言）
    expect(state.clearedCalls).toBeGreaterThanOrEqual(1); // clearAllEnemies 被呼叫
    // 無「扣命/gameover」的呼叫；敗不給寶盒進度。
    expect(state.chestChargeAdded).toBe(0);
  });

  it('勝也 cleanup（清回目標/清敵）', () => {
    const { ctx, state } = makeGuardCtx();
    const ev = new GuardEvent(ctx, 'Guard60', ['Enemy_Rush']);
    ev.update(60); // 勝
    expect(state.guardTarget === null).toBe(true); // 清回玩家目標（boolean 斷言）
    expect(state.clearedCalls).toBeGreaterThanOrEqual(1);
  });

  it('查無 preset → fallback，不炸（用未知 preset 名建 GuardEvent 仍可跑完）', () => {
    const { ctx, state } = makeGuardCtx();
    const ev = new GuardEvent(ctx, 'NoSuchPreset', ['Enemy_Rush']); // fallback 60/100
    ev.update(60); // 撐過 → 勝、寶盒進度 +round(165×1)=165
    expect(ev.didWin()).toBe(true);
    expect(state.chestChargeAdded).toBe(CHEST_OPEN_THRESHOLD);
  });

  it('finished 後再 update 恆回 true、不重複結算（addCharge 只被呼叫一次、進度不重複加）', () => {
    const { ctx, state } = makeGuardCtx();
    const ev = new GuardEvent(ctx, 'Guard60', ['Enemy_Rush']);
    ev.update(60); // 勝，+165
    const chargeAfterWin = state.chestChargeAdded;
    const callsAfterWin = state.chestAddCalls;
    expect(ev.update(60)).toBe(true); // 已結束
    expect(state.chestChargeAdded).toBe(chargeAfterWin); // 進度不重複加（可觀察行為）
    expect(state.chestAddCalls).toBe(callsAfterWin); // 且 addCharge 不再被呼叫（=1 次）
    expect(callsAfterWin).toBe(1);
  });
});
