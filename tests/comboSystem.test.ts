import { describe, expect, it } from 'vitest';
import {
  comboTimeoutFor,
  ticketsForCombo,
  COMBO_MIN_TIMEOUT,
} from '@/config/comboConfig';
import { ComboSystem } from '@/systems/ComboSystem';
import { TicketSystem } from '@/systems/TicketSystem';
import type { GameContext } from '@/systems/GameContext';

/**
 * ComboSystem + combo 純函式 測試（Unity 規格）。
 * 含壞版必紅：計時窗縮短公式、結算彩票 ceil、耗盡不累積。
 */
function makeSystem(opts?: { outOfCredit?: boolean; enemies?: number }) {
  const state = {
    outOfCredit: opts?.outOfCredit ?? false,
    enemies: opts?.enemies ?? 1,
    ticketsAdded: 0,
  };
  const ctx = {
    credit: { isOutOfCredit: () => state.outOfCredit },
    ticket: { addTickets: (_playerId: number, n: number) => (state.ticketsAdded += n) },
    getEnemies: () => new Array(state.enemies).fill(null),
  } as unknown as GameContext;
  const sys = new ComboSystem();
  sys.init(ctx);
  return { sys, state };
}

describe('combo 純函式', () => {
  it('計時窗：count0→3s、count5→2.5s、count100→下限0.5s', () => {
    expect(comboTimeoutFor(0)).toBeCloseTo(3);
    expect(comboTimeoutFor(5)).toBeCloseTo(2.5);
    expect(comboTimeoutFor(100)).toBe(COMBO_MIN_TIMEOUT); // max(0.5, 3-10)=0.5
    expect(comboTimeoutFor(30)).toBe(COMBO_MIN_TIMEOUT); // 3-3=0 → 0.5
  });

  it('結算彩票 ceil(count×0.5)：1→1、3→2、100→50、0→0', () => {
    expect(ticketsForCombo(1)).toBe(1); // ceil(0.5)=1
    expect(ticketsForCombo(3)).toBe(2); // ceil(1.5)=2
    expect(ticketsForCombo(100)).toBe(50);
    expect(ticketsForCombo(0)).toBe(0);
  });
});

describe('ComboSystem — 累積/超時結算/凍結/耗盡', () => {
  it('命中累積 +1', () => {
    const { sys } = makeSystem();
    sys.onHit(0);
    sys.onHit(0);
    expect(sys.getCombo(0)).toBe(2);
  });

  it('耗盡狀態不累積 COMBO', () => {
    const { sys } = makeSystem({ outOfCredit: true });
    sys.onHit(0);
    sys.onHit(0);
    expect(sys.getCombo(0)).toBe(0);
  });

  it('超時（timer≤0）結算彩票 ceil(count×0.5) 並歸零', () => {
    const { sys, state } = makeSystem();
    for (let i = 0; i < 3; i += 1) sys.onHit(0); // count=3, timer=max(0.5,3-0.3)=2.7
    sys.update(3); // 超時
    expect(sys.getCombo(0)).toBe(0);
    expect(state.ticketsAdded).toBe(2); // ceil(3×0.5)=2
  });

  it('滿檔 100 強制結算 50 張並歸零', () => {
    const { sys, state } = makeSystem();
    for (let i = 0; i < 100; i += 1) sys.onHit(0);
    expect(sys.getCombo(0)).toBe(0); // 滿檔即結算歸零
    expect(state.ticketsAdded).toBe(50);
  });

  it('凍結（場上無敵人）→ 不倒數、不結算', () => {
    const { sys, state } = makeSystem({ enemies: 0 });
    sys.onHit(0);
    // 但 onHit 當下 enemies=0；累積仍 +1（onHit 不看凍結，只看耗盡）
    expect(sys.getCombo(0)).toBe(1);
    sys.update(999); // 大量時間但凍結 → 不倒數
    expect(sys.getCombo(0)).toBe(1); // 沒被結算
    expect(state.ticketsAdded).toBe(0);
  });

  it('警告：計時窗剩餘 < 2s 且連段中且非凍結 → isWarning true', () => {
    const { sys } = makeSystem();
    for (let i = 0; i < 3; i += 1) sys.onHit(0); // timer=2.7
    expect(sys.isWarning(0)).toBe(false); // 2.7 > 2
    sys.update(1); // timer=1.7 < 2
    expect(sys.isWarning(0)).toBe(true);
  });

  // 🔴 壞版必紅：結算彩票若用 floor 而非 ceil，count=3 會給 1 而非 2。
  it('壞版對照：結算用 floor 會少給彩票（count=3: ceil=2 vs floor=1）', () => {
    expect(ticketsForCombo(3)).toBe(2);
    expect(Math.floor(3 * 0.5)).toBe(1);
    expect(ticketsForCombo(3)).not.toBe(Math.floor(3 * 0.5));
  });
});

// ===========================================================================
// 深度強化（QA 測騎接手）：計時窗/結算/凍結/警告/滿檔 的邊界與不變量。
// ===========================================================================

/** 可控 fake：測試中途可切 outOfCredit / enemies（凍結）、記錄灌入彩票。 */
function makeControllable() {
  const state = { outOfCredit: false, enemies: 1, ticketsAdded: 0, maxAddCalls: 0 };
  const ctx = {
    credit: { isOutOfCredit: () => state.outOfCredit },
    ticket: {
      addTickets: (_playerId: number, n: number) => {
        state.ticketsAdded += n;
        state.maxAddCalls += 1;
      },
    },
    getEnemies: () => new Array(state.enemies).fill(null),
  } as unknown as GameContext;
  const sys = new ComboSystem();
  sys.init(ctx);
  return { sys, state };
}

describe('comboTimeoutFor — 計時窗公式邊界 max(0.5, 3 - count×0.1)', () => {
  it('count0→3、count5→2.5（線性遞減段）', () => {
    expect(comboTimeoutFor(0)).toBeCloseTo(3);
    expect(comboTimeoutFor(5)).toBeCloseTo(2.5);
  });

  it('count25→恰好 0.5（3-2.5=0.5，觸下限交界）', () => {
    expect(comboTimeoutFor(25)).toBeCloseTo(0.5);
  });

  it('count24→0.6（下限交界前一格，仍在線性段）', () => {
    expect(comboTimeoutFor(24)).toBeCloseTo(0.6);
  });

  it('count30 / count100 → clamp 0.5，不變負', () => {
    // 3 - 30×0.1 = 0 → max(0.5,0)=0.5；3 - 100×0.1 = -7 → max(0.5,-7)=0.5
    expect(comboTimeoutFor(30)).toBe(COMBO_MIN_TIMEOUT);
    expect(comboTimeoutFor(100)).toBe(COMBO_MIN_TIMEOUT);
    expect(comboTimeoutFor(100)).toBeGreaterThan(0); // 絕不變負
  });
});

describe('ComboSystem — 每命中「重設」計時窗（非累加）', () => {
  it('連續命中後 timer = 當前 count 的公式值（重設，不累加）', () => {
    const { sys } = makeControllable();
    sys.onHit(0); // count1, timer=2.9
    sys.update(1); // timer=1.9
    sys.onHit(0); // count2 → 重設 timer=comboTimeoutFor(2)=2.8（不是 1.9+something）
    // 用 isWarning 邊界間接驗：2.8 >= 2 → 非警告（若是累加/沒重設，1.9<2 會誤報警告）
    expect(sys.isWarning(0)).toBe(false);
    expect(sys.getCombo(0)).toBe(2);
  });
});

describe('ticketsForCombo — ceil 結算邊界（真回歸點：ceil vs floor）', () => {
  it('count1→1、count3→2、count4→2、count5→3（ceil(count×0.5)）', () => {
    expect(ticketsForCombo(1)).toBe(1); // ceil(0.5)
    expect(ticketsForCombo(3)).toBe(2); // ceil(1.5)
    expect(ticketsForCombo(4)).toBe(2); // ceil(2.0)
    expect(ticketsForCombo(5)).toBe(3); // ceil(2.5)
  });

  it('ceil ≠ floor（真回歸點）：count1 ceil1/floor0、count5 ceil3/floor2', () => {
    expect(ticketsForCombo(1)).not.toBe(Math.floor(1 * 0.5)); // 1 vs 0
    expect(ticketsForCombo(5)).not.toBe(Math.floor(5 * 0.5)); // 3 vs 2
  });
});

describe('ComboSystem — 超時結算 + 滿檔 MAX', () => {
  it('超時結算：count5 → 灌 ceil(5×0.5)=3 張、歸 0', () => {
    const { sys, state } = makeControllable();
    for (let i = 0; i < 5; i += 1) sys.onHit(0); // count5, timer=2.5
    sys.update(3); // 超時
    expect(sys.getCombo(0)).toBe(0);
    expect(state.ticketsAdded).toBe(3);
  });

  it('滿檔 100：強制結算 50、歸 0、maxTriggered 只觸發一次（consume 後清）', () => {
    const { sys, state } = makeControllable();
    for (let i = 0; i < 100; i += 1) sys.onHit(0);
    expect(sys.getCombo(0)).toBe(0);
    expect(state.ticketsAdded).toBe(50);
    expect(sys.consumeMaxTriggered(0)).toBe(true); // 第一次讀到 true
    expect(sys.consumeMaxTriggered(0)).toBe(false); // 讀後清，不重複觸發
  });

  it('一般超時結算【不】設 maxTriggered（只有滿檔才 MAX）', () => {
    const { sys } = makeControllable();
    for (let i = 0; i < 5; i += 1) sys.onHit(0);
    sys.update(3); // 一般超時結算
    expect(sys.consumeMaxTriggered(0)).toBe(false);
  });
});

describe('ComboSystem — 凍結（場上無敵人）', () => {
  it('凍結中 update 不倒數、不結算（大量時間也不掉）', () => {
    const { sys, state } = makeControllable();
    sys.onHit(0); // count1
    state.enemies = 0; // 凍結
    sys.update(999);
    expect(sys.getCombo(0)).toBe(1); // 沒被倒數/結算
    expect(state.ticketsAdded).toBe(0);
  });

  it('凍結中 isWarning 恆 false（即使 timer 本來很低）', () => {
    const { sys, state } = makeControllable();
    for (let i = 0; i < 25; i += 1) sys.onHit(0); // timer=0.5（<2，本會警告）
    state.enemies = 0; // 凍結
    expect(sys.isWarning(0)).toBe(false); // 凍結 → 不警告
  });

  it('解凍後恢復倒數（凍→解 → 時間繼續走 → 會結算）', () => {
    const { sys, state } = makeControllable();
    for (let i = 0; i < 5; i += 1) sys.onHit(0); // count5 timer=2.5
    state.enemies = 0; // 凍結
    sys.update(999); // 凍結不倒數
    expect(sys.getCombo(0)).toBe(5);
    state.enemies = 1; // 解凍
    sys.update(3); // 恢復倒數 → 超時結算
    expect(sys.getCombo(0)).toBe(0);
    expect(state.ticketsAdded).toBe(3); // ceil(5×0.5)
  });
});

describe('ComboSystem — 警告窗 isWarning', () => {
  it('連段中 && 非凍結 && timer<2 → true；timer>=2 → false', () => {
    const { sys } = makeControllable();
    for (let i = 0; i < 3; i += 1) sys.onHit(0); // timer=2.7
    expect(sys.isWarning(0)).toBe(false); // 2.7 >= 2
    sys.update(1); // timer=1.7
    expect(sys.isWarning(0)).toBe(true); // <2
  });

  it('count=0（無連段）→ isWarning false（不因 timer 值誤報）', () => {
    const { sys } = makeControllable();
    expect(sys.isWarning(0)).toBe(false);
  });
});

describe('TicketSystem — per-player 帳本累積（S5 keying）', () => {
  it('addTickets(0,n) 累積、getTickets(0) 讀取；多次累加正確', () => {
    const t = new TicketSystem();
    t.init({} as unknown as GameContext);
    expect(t.getTickets(0)).toBe(0);
    t.addTickets(0, 3);
    t.addTickets(0, 2);
    expect(t.getTickets(0)).toBe(5);
  });

  it('addTickets(0, 0/負) → 不改變（守 n>0）', () => {
    const t = new TicketSystem();
    t.init({} as unknown as GameContext);
    t.addTickets(0, 5);
    t.addTickets(0, 0);
    t.addTickets(0, -3);
    expect(t.getTickets(0)).toBe(5);
  });

  it('update 不改變彩票（純計數器，無每幀邏輯）', () => {
    const t = new TicketSystem();
    t.init({} as unknown as GameContext);
    t.addTickets(0, 4);
    t.update(999);
    expect(t.getTickets(0)).toBe(4);
  });

  // S5 ② per-player keying 鑑別：各自一本、互不汙染。
  it('per-player 各自一本：addTickets(0,n) 只加 P0、getTickets(1) 不變', () => {
    const t = new TicketSystem();
    t.init({} as unknown as GameContext);
    t.addTickets(0, 10);
    expect(t.getTickets(0)).toBe(10);
    expect(t.getTickets(1)).toBe(0); // P1 獨立
    t.addTickets(1, 7);
    expect(t.getTickets(0)).toBe(10); // P0 不受 P1 影響
    expect(t.getTickets(1)).toBe(7);
  });

  it('未記錄的 playerId → 0', () => {
    const t = new TicketSystem();
    t.init({} as unknown as GameContext);
    expect(t.getTickets(3)).toBe(0);
  });
});

// ===========================================================================
// S5 ②：COMBO 結算的彩票歸屬 = settle 的那個 player（用真 TicketSystem 觀察 per-player 歸屬）。
// 🔴 壞版必紅：settle 忽略 playerId、把票灌進 P0（別人 combo 結算灌到 P1 票）→ 這裡紅。
// ===========================================================================
describe('ComboSystem — S5 ② 結算彩票歸屬 settle 的 player', () => {
  function makeWithTicket() {
    const ticket = new TicketSystem();
    ticket.init({} as unknown as GameContext);
    const sys = new ComboSystem();
    const ctx = {
      credit: { isOutOfCredit: () => false },
      ticket,
      getEnemies: () => [null], // 非凍結
    } as unknown as GameContext;
    sys.init(ctx);
    return { sys, ticket };
  }

  it('P1(id1) 累段後超時結算 → 票灌進 P1(getTickets(1))，P0 不得票', () => {
    const { sys, ticket } = makeWithTicket();
    sys.onHit(1);
    sys.onHit(1);
    sys.onHit(1); // count=3
    sys.update(999); // 超時結算 → ceil(3×0.5)=2 灌給 P1
    expect(ticket.getTickets(1)).toBe(2); // 歸屬正確
    expect(ticket.getTickets(0)).toBe(0); // P0 沒被灌別人的結算
  });

  it('P0 與 P1 各自結算各自得票（不互灌）', () => {
    const { sys, ticket } = makeWithTicket();
    sys.onHit(0); // P0 count=1
    sys.onHit(1);
    sys.onHit(1); // P1 count=2
    sys.update(999); // 兩人都超時結算：P0 ceil(1×0.5)=1、P1 ceil(2×0.5)=1
    expect(ticket.getTickets(0)).toBe(1);
    expect(ticket.getTickets(1)).toBe(1);
  });
});
