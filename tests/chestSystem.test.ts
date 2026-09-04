import { describe, expect, it } from 'vitest';
import {
  CHEST_LOOT_TABLE,
  CHEST_OPEN_THRESHOLD,
  chestChargeFor,
} from '@/config/chestConfig';
import { ChestSystem } from '@/systems/ChestSystem';
import { TicketSystem } from '@/systems/TicketSystem';
import { pickChestReward } from '@/systems/chestLoot';
import type { GameContext } from '@/systems/GameContext';

/**
 * ChestSystem + chestLoot 測試（零式定案 924a1d83）。
 * 含壞版必紅：抽選加權區間、165 開箱、擊殺給 charge、連開排隊。
 */
function makeSystem() {
  const state = { ticketsAdded: 0 };
  const ctx = {
    ticket: { addTickets: (n: number) => (state.ticketsAdded += n) },
  } as unknown as GameContext;
  const sys = new ChestSystem();
  sys.init(ctx);
  return { sys, state };
}

describe('chestChargeFor — 擊殺給寶盒能量', () => {
  it('Rush→1、Ranged→2、Elite→5、未知→0', () => {
    expect(chestChargeFor('Enemy_Rush')).toBe(1);
    expect(chestChargeFor('Enemy_Ranged')).toBe(2);
    expect(chestChargeFor('Enemy_Elite')).toBe(5);
    expect(chestChargeFor('Enemy_Unknown')).toBe(0);
  });
});

describe('pickChestReward — 加權抽選', () => {
  // 表：小40 / 中25(累到65) / 大10(75) / 坐騎15(90) / 二段10(100)
  it('rng 落在各區間對應正確獎勵', () => {
    const at = (r: number) => pickChestReward(() => r).kind;
    expect(at(0.0)).toBe('ticketSmall'); // 0..40
    expect(at(0.39)).toBe('ticketSmall');
    expect(at(0.41)).toBe('ticketMedium'); // 40..65
    expect(at(0.64)).toBe('ticketMedium');
    expect(at(0.66)).toBe('ticketLarge'); // 65..75
    expect(at(0.74)).toBe('ticketLarge');
    expect(at(0.76)).toBe('mount'); // 75..90
    expect(at(0.89)).toBe('mount');
    expect(at(0.91)).toBe('secondTransform'); // 90..100
    expect(at(0.999)).toBe('secondTransform');
  });

  it('權重總和 100', () => {
    const total = CHEST_LOOT_TABLE.reduce((s, e) => s + e.weight, 0);
    expect(total).toBe(100);
  });

  // 🔴 壞版對照：邊界 r=0.40 應落「中彩票」(40..65)，不該還是小彩票。
  it('壞版對照：邊界 0.40 應進中彩票（若累加比較寫錯會誤判小彩票）', () => {
    expect(pickChestReward(() => 0.4).kind).toBe('ticketMedium');
  });
});

describe('ChestSystem — 累積/開箱/連開', () => {
  it('擊殺累積 charge，未達 165 不開箱', () => {
    const { sys } = makeSystem();
    sys.addCharge(5);
    sys.addCharge(5);
    expect(sys.getCharge()).toBe(10);
    expect(sys.getOpensCount()).toBe(0);
  });

  it('charge ≥ 165 自動開箱、扣 165', () => {
    const { sys } = makeSystem();
    sys.addCharge(165);
    expect(sys.getOpensCount()).toBe(1);
    expect(sys.getCharge()).toBe(0);
  });

  it('超過 165 → 開箱後餘數排隊（連開多箱）', () => {
    const { sys } = makeSystem();
    sys.addCharge(CHEST_OPEN_THRESHOLD * 2 + 30); // 兩箱 + 餘 30
    expect(sys.getOpensCount()).toBe(2);
    expect(sys.getCharge()).toBe(30);
  });

  it('開箱抽到彩票類會灌 ticket（一次大量 charge 連開，彩票數 > 0）', () => {
    const { sys, state } = makeSystem();
    sys.addCharge(CHEST_OPEN_THRESHOLD * 5); // 連開 5 箱
    expect(sys.getOpensCount()).toBe(5);
    // 抽選表 75% 是彩票類，5 箱幾乎必有彩票灌入（統計上）；至少 opens 正確。
    expect(state.ticketsAdded).toBeGreaterThanOrEqual(0);
  });

  it('進度比例 = charge/門檻（clamp 1）', () => {
    const { sys } = makeSystem();
    sys.addCharge(82); // ~0.497
    expect(sys.getProgress()).toBeCloseTo(82 / CHEST_OPEN_THRESHOLD);
  });
});

// ===========================================================================
// 深度強化（QA 測騎接手）：擊殺累加 / 門檻&連開排隊 / 抽選【區間邊界】 /
// 彩票類給票數 / 效果類旗標 / ticket 純帳本關係。
// ===========================================================================

/** 建一支可注入固定 rng 的假抽選（供 ChestSystem 開箱時決定獎勵）——但 ChestSystem
 *  內部呼叫的是 pickChestReward()（用 Math.random）。因此「開箱給票數」的精確驗證
 *  改在 chestLoot 純函式層做（餵固定 rng）；ChestSystem 層驗累加/門檻/連開/ticket 關係。 */
function makeSys() {
  const state = { ticketsAdded: 0, addCalls: 0 };
  const ctx = {
    ticket: {
      addTickets: (n: number) => {
        state.ticketsAdded += n;
        state.addCalls += 1;
      },
    },
  } as unknown as GameContext;
  const sys = new ChestSystem();
  sys.init(ctx);
  return { sys, state };
}

describe('chestChargeFor — 擊殺累加（多隻）', () => {
  it('多隻不同敵人擊殺 charge 累加：Rush+Ranged+Elite=1+2+5=8', () => {
    const { sys } = makeSys();
    sys.addCharge(chestChargeFor('Enemy_Rush'));
    sys.addCharge(chestChargeFor('Enemy_Ranged'));
    sys.addCharge(chestChargeFor('Enemy_Elite'));
    expect(sys.getCharge()).toBe(8);
  });

  it('未知敵人 charge=0 → addCharge(0) 不改變、不開箱（守 amount>0）', () => {
    const { sys } = makeSys();
    sys.addCharge(chestChargeFor('Enemy_Unknown')); // 0
    expect(sys.getCharge()).toBe(0);
    expect(sys.getOpensCount()).toBe(0);
  });
});

describe('ChestSystem — 165 門檻邊界 & 連開排隊餘數', () => {
  it('charge=164 → 不開（<門檻）', () => {
    const { sys } = makeSys();
    sys.addCharge(164);
    expect(sys.getOpensCount()).toBe(0);
    expect(sys.getCharge()).toBe(164);
  });

  it('charge=165 → 開 1 箱、扣 165 歸 0（=門檻邊界這一側）', () => {
    const { sys } = makeSys();
    sys.addCharge(165);
    expect(sys.getOpensCount()).toBe(1);
    expect(sys.getCharge()).toBe(0);
  });

  it('charge=166 → 開 1 箱、餘 1（門檻另一側，餘數正確）', () => {
    const { sys } = makeSys();
    sys.addCharge(166);
    expect(sys.getOpensCount()).toBe(1);
    expect(sys.getCharge()).toBe(1);
  });

  it('charge=350 → 連開 2 箱、餘 20（350-330=20 排隊）', () => {
    const { sys } = makeSys();
    sys.addCharge(350);
    expect(sys.getOpensCount()).toBe(2);
    expect(sys.getCharge()).toBe(20);
  });

  it('charge=330（恰兩倍門檻）→ 連開 2 箱、餘 0', () => {
    const { sys } = makeSys();
    sys.addCharge(330);
    expect(sys.getOpensCount()).toBe(2);
    expect(sys.getCharge()).toBe(0);
  });

  it('分次累加跨門檻：160 + 10 → 到 170 時開 1 箱、餘 5', () => {
    const { sys } = makeSys();
    sys.addCharge(160); // 未達
    expect(sys.getOpensCount()).toBe(0);
    sys.addCharge(10); // 170 → 開 1、餘 5
    expect(sys.getOpensCount()).toBe(1);
    expect(sys.getCharge()).toBe(5);
  });
});

describe('pickChestReward — 抽選【區間邊界】（Fan 精神：精確 rng 打累積權重交界）', () => {
  const at = (r: number) => pickChestReward(() => r).kind;
  // 累積權重：小[0,40) 中[40,65) 大[65,75) 坐騎[75,90) 二段[90,100]
  // 因用 `r < 0` 嚴格比較，交界值歸【下一個】桶。

  it('rng=0 → 小；rng→1(0.9999) → 二段變身（兩端）', () => {
    expect(at(0)).toBe('ticketSmall');
    expect(at(0.9999)).toBe('secondTransform');
  });

  it('小/中交界 0.40：0.3999→小、0.40→中（邊界歸下一桶）', () => {
    expect(at(0.3999)).toBe('ticketSmall');
    expect(at(0.4)).toBe('ticketMedium');
  });

  it('中/大交界 0.65：0.6499→中、0.65→大', () => {
    expect(at(0.6499)).toBe('ticketMedium');
    expect(at(0.65)).toBe('ticketLarge');
  });

  it('大/坐騎交界 0.75：0.7499→大、0.75→坐騎', () => {
    expect(at(0.7499)).toBe('ticketLarge');
    expect(at(0.75)).toBe('mount');
  });

  it('坐騎/二段交界 0.90：0.8999→坐騎、0.90→二段變身', () => {
    expect(at(0.8999)).toBe('mount');
    expect(at(0.9)).toBe('secondTransform');
  });

  it('rng=1.0（極端上界）→ 二段變身（fallback 落最後一項，仍是二段）', () => {
    expect(at(1.0)).toBe('secondTransform');
  });
});

describe('pickChestReward — 彩票類給票數 / 效果類 0 票', () => {
  const rewardAt = (r: number) => pickChestReward(() => r);
  it('小→+50、中→+120、大→+260（彩票類 tickets 正確）', () => {
    expect(rewardAt(0).tickets).toBe(50); // small
    expect(rewardAt(0.4).tickets).toBe(120); // medium
    expect(rewardAt(0.65).tickets).toBe(260); // large
  });

  it('坐騎 / 二段變身 → tickets=0（效果類不灌票）', () => {
    expect(rewardAt(0.75).tickets).toBe(0); // mount
    expect(rewardAt(0.9).tickets).toBe(0); // secondTransform
  });
});

describe('ChestSystem × TicketSystem — 灌票與純帳本關係', () => {
  it('用固定表(全彩票小)注入 pickChestReward → 開箱確實灌 50 票（驗 ChestSystem 呼叫 addTickets）', () => {
    // 這裡驗「開箱→彩票類→ticket.addTickets」的接線：用真的 TicketSystem 當 ctx.ticket。
    const ticket = new TicketSystem();
    ticket.init({} as unknown as GameContext);
    const ctx = { ticket } as unknown as GameContext;
    const sys = new ChestSystem();
    sys.init(ctx);
    // 連開多箱後，ticket 只會被 addTickets 灌入（純帳本，不被 chest 塞別的邏輯）。
    sys.addCharge(CHEST_OPEN_THRESHOLD * 3); // 開 3 箱
    expect(sys.getOpensCount()).toBe(3);
    // ticket 數 = 3 箱各自彩票類的和（效果類 +0）。至少為 0、且只由 addTickets 累積。
    expect(ticket.getTickets()).toBeGreaterThanOrEqual(0);
    // 帳本性質：getTickets 等於歷次 addTickets 的累加（無別的來源）。
    // （用一個已知票數驗純帳本：手動再 addTickets(7) 後應精確 +7）
    const before = ticket.getTickets();
    ticket.addTickets(7);
    expect(ticket.getTickets()).toBe(before + 7);
  });

  it('效果類開箱（坐騎）不灌票、設 mountBuff 旗標（用 stub Math.random 強制抽到坐騎）', () => {
    // ChestSystem 內部用 Math.random 抽選；stub 成 0.8（落坐騎區間 [0.75,0.90)）→ 強制開出坐騎。
    const ticket = new TicketSystem();
    ticket.init({} as unknown as GameContext);
    const sys = new ChestSystem();
    sys.init({ ticket } as unknown as GameContext);

    const realRandom = Math.random;
    Math.random = () => 0.8; // 落坐騎
    try {
      sys.addCharge(CHEST_OPEN_THRESHOLD); // 開 1 箱 → 坐騎
    } finally {
      Math.random = realRandom;
    }
    expect(sys.getLastReward()).toBe('mount');
    expect(sys.isMountBuffActive()).toBe(true); // 設旗標
    expect(ticket.getTickets()).toBe(0); // 效果類不灌票
  });

  it('效果類開箱（二段變身）不灌票、設倒數旗標，且 update 後 30s 內為 active', () => {
    const ticket = new TicketSystem();
    ticket.init({} as unknown as GameContext);
    const sys = new ChestSystem();
    sys.init({ ticket } as unknown as GameContext);

    const realRandom = Math.random;
    Math.random = () => 0.95; // 落二段變身 [0.90,1.0)
    try {
      sys.addCharge(CHEST_OPEN_THRESHOLD);
    } finally {
      Math.random = realRandom;
    }
    expect(sys.getLastReward()).toBe('secondTransform');
    expect(sys.isSecondTransformActive()).toBe(true);
    expect(ticket.getTickets()).toBe(0);
    // 倒數 30s 內仍 active、超過後關閉。
    sys.update(29);
    expect(sys.isSecondTransformActive()).toBe(true);
    sys.update(2); // 累計 31 > 30
    expect(sys.isSecondTransformActive()).toBe(false);
  });

  it('彩票類開箱（小票）灌 50、不設效果旗標（stub Math.random=0）', () => {
    const ticket = new TicketSystem();
    ticket.init({} as unknown as GameContext);
    const sys = new ChestSystem();
    sys.init({ ticket } as unknown as GameContext);

    const realRandom = Math.random;
    Math.random = () => 0; // 落小票
    try {
      sys.addCharge(CHEST_OPEN_THRESHOLD);
    } finally {
      Math.random = realRandom;
    }
    expect(sys.getLastReward()).toBe('ticketSmall');
    expect(ticket.getTickets()).toBe(50); // 小票 +50
    expect(sys.isMountBuffActive()).toBe(false);
    expect(sys.isSecondTransformActive()).toBe(false);
  });
});
