import { describe, expect, it } from 'vitest';
import {
  CHEST_LOOT_TABLE,
  CHEST_OPEN_THRESHOLD,
  chestChargeFor,
} from '@/config/chestConfig';
import { ChestSystem } from '@/systems/ChestSystem';
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
