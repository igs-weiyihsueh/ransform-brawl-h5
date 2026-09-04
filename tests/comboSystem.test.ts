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
    ticket: { addTickets: (n: number) => (state.ticketsAdded += n) },
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
    sys.onHit();
    sys.onHit();
    expect(sys.getCombo()).toBe(2);
  });

  it('耗盡狀態不累積 COMBO', () => {
    const { sys } = makeSystem({ outOfCredit: true });
    sys.onHit();
    sys.onHit();
    expect(sys.getCombo()).toBe(0);
  });

  it('超時（timer≤0）結算彩票 ceil(count×0.5) 並歸零', () => {
    const { sys, state } = makeSystem();
    for (let i = 0; i < 3; i += 1) sys.onHit(); // count=3, timer=max(0.5,3-0.3)=2.7
    sys.update(3); // 超時
    expect(sys.getCombo()).toBe(0);
    expect(state.ticketsAdded).toBe(2); // ceil(3×0.5)=2
  });

  it('滿檔 100 強制結算 50 張並歸零', () => {
    const { sys, state } = makeSystem();
    for (let i = 0; i < 100; i += 1) sys.onHit();
    expect(sys.getCombo()).toBe(0); // 滿檔即結算歸零
    expect(state.ticketsAdded).toBe(50);
  });

  it('凍結（場上無敵人）→ 不倒數、不結算', () => {
    const { sys, state } = makeSystem({ enemies: 0 });
    sys.onHit();
    // 但 onHit 當下 enemies=0；累積仍 +1（onHit 不看凍結，只看耗盡）
    expect(sys.getCombo()).toBe(1);
    sys.update(999); // 大量時間但凍結 → 不倒數
    expect(sys.getCombo()).toBe(1); // 沒被結算
    expect(state.ticketsAdded).toBe(0);
  });

  it('警告：計時窗剩餘 < 2s 且連段中且非凍結 → isWarning true', () => {
    const { sys } = makeSystem();
    for (let i = 0; i < 3; i += 1) sys.onHit(); // timer=2.7
    expect(sys.isWarning()).toBe(false); // 2.7 > 2
    sys.update(1); // timer=1.7 < 2
    expect(sys.isWarning()).toBe(true);
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
      addTickets: (n: number) => {
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
    sys.onHit(); // count1, timer=2.9
    sys.update(1); // timer=1.9
    sys.onHit(); // count2 → 重設 timer=comboTimeoutFor(2)=2.8（不是 1.9+something）
    // 用 isWarning 邊界間接驗：2.8 >= 2 → 非警告（若是累加/沒重設，1.9<2 會誤報警告）
    expect(sys.isWarning()).toBe(false);
    expect(sys.getCombo()).toBe(2);
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
    for (let i = 0; i < 5; i += 1) sys.onHit(); // count5, timer=2.5
    sys.update(3); // 超時
    expect(sys.getCombo()).toBe(0);
    expect(state.ticketsAdded).toBe(3);
  });

  it('滿檔 100：強制結算 50、歸 0、maxTriggered 只觸發一次（consume 後清）', () => {
    const { sys, state } = makeControllable();
    for (let i = 0; i < 100; i += 1) sys.onHit();
    expect(sys.getCombo()).toBe(0);
    expect(state.ticketsAdded).toBe(50);
    expect(sys.consumeMaxTriggered()).toBe(true); // 第一次讀到 true
    expect(sys.consumeMaxTriggered()).toBe(false); // 讀後清，不重複觸發
  });

  it('一般超時結算【不】設 maxTriggered（只有滿檔才 MAX）', () => {
    const { sys } = makeControllable();
    for (let i = 0; i < 5; i += 1) sys.onHit();
    sys.update(3); // 一般超時結算
    expect(sys.consumeMaxTriggered()).toBe(false);
  });
});

describe('ComboSystem — 凍結（場上無敵人）', () => {
  it('凍結中 update 不倒數、不結算（大量時間也不掉）', () => {
    const { sys, state } = makeControllable();
    sys.onHit(); // count1
    state.enemies = 0; // 凍結
    sys.update(999);
    expect(sys.getCombo()).toBe(1); // 沒被倒數/結算
    expect(state.ticketsAdded).toBe(0);
  });

  it('凍結中 isWarning 恆 false（即使 timer 本來很低）', () => {
    const { sys, state } = makeControllable();
    for (let i = 0; i < 25; i += 1) sys.onHit(); // timer=0.5（<2，本會警告）
    state.enemies = 0; // 凍結
    expect(sys.isWarning()).toBe(false); // 凍結 → 不警告
  });

  it('解凍後恢復倒數（凍→解 → 時間繼續走 → 會結算）', () => {
    const { sys, state } = makeControllable();
    for (let i = 0; i < 5; i += 1) sys.onHit(); // count5 timer=2.5
    state.enemies = 0; // 凍結
    sys.update(999); // 凍結不倒數
    expect(sys.getCombo()).toBe(5);
    state.enemies = 1; // 解凍
    sys.update(3); // 恢復倒數 → 超時結算
    expect(sys.getCombo()).toBe(0);
    expect(state.ticketsAdded).toBe(3); // ceil(5×0.5)
  });
});

describe('ComboSystem — 警告窗 isWarning', () => {
  it('連段中 && 非凍結 && timer<2 → true；timer>=2 → false', () => {
    const { sys } = makeControllable();
    for (let i = 0; i < 3; i += 1) sys.onHit(); // timer=2.7
    expect(sys.isWarning()).toBe(false); // 2.7 >= 2
    sys.update(1); // timer=1.7
    expect(sys.isWarning()).toBe(true); // <2
  });

  it('count=0（無連段）→ isWarning false（不因 timer 值誤報）', () => {
    const { sys } = makeControllable();
    expect(sys.isWarning()).toBe(false);
  });
});

describe('TicketSystem — 純帳本累積', () => {
  it('addTickets 累積、getTickets 讀取；多次累加正確', () => {
    const t = new TicketSystem();
    t.init({} as unknown as GameContext);
    expect(t.getTickets()).toBe(0);
    t.addTickets(3);
    t.addTickets(2);
    expect(t.getTickets()).toBe(5);
  });

  it('addTickets(0) / 負數 → 不改變（守 n>0）', () => {
    const t = new TicketSystem();
    t.init({} as unknown as GameContext);
    t.addTickets(5);
    t.addTickets(0);
    t.addTickets(-3);
    expect(t.getTickets()).toBe(5);
  });

  it('update 不改變彩票（純計數器，無每幀邏輯）', () => {
    const t = new TicketSystem();
    t.init({} as unknown as GameContext);
    t.addTickets(4);
    t.update(999);
    expect(t.getTickets()).toBe(4);
  });
});
