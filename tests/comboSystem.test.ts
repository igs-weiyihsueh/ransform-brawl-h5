import { describe, expect, it } from 'vitest';
import {
  comboTimeoutFor,
  ticketsForCombo,
  COMBO_MIN_TIMEOUT,
} from '@/config/comboConfig';
import { ComboSystem } from '@/systems/ComboSystem';
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
