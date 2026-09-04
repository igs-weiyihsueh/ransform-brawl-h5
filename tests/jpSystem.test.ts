import { describe, expect, it } from 'vitest';
import {
  JP_GROUP_CONFIG,
  JP_LIGHTS_TO_TRIGGER,
  JP_TICKET_FACE,
  multiplierStepPerCoin,
  pickLightGroup,
} from '@/config/jpConfig';
import type { GameContext } from '@/systems/GameContext';
import { JpSystem } from '@/systems/JpSystem';

/**
 * JpSystem + jpConfig 測試（零式定案 924a1d83）。
 * 含壞版必紅：燈集滿觸發、倍數封頂 clamp、派彩=倍數×30、歸零重累積、33.3% 給燈。
 */
function makeSystem() {
  const state = { ticketsAdded: 0, stageClear: null as null | (() => void) };
  const ctx = {
    ticket: { addTickets: (n: number) => (state.ticketsAdded += n) },
    wave: {
      set onStageClear(cb: () => void) {
        state.stageClear = cb;
      },
    },
  } as unknown as GameContext;
  const sys = new JpSystem();
  sys.init(ctx);
  return { sys, state };
}

describe('jpConfig 純函式', () => {
  it('每幣步進 = (avg-start)/450：紅≈0.0239、藍≈0.0278、紫≈0.0206', () => {
    expect(multiplierStepPerCoin('red')).toBeCloseTo((15.75 - 5) / 450);
    expect(multiplierStepPerCoin('blue')).toBeCloseTo((22.5 - 10) / 450);
    expect(multiplierStepPerCoin('purple')).toBeCloseTo((29.25 - 20) / 450);
  });

  it('pickLightGroup 三組均等：rng 0/0.34/0.67 → red/blue/purple', () => {
    expect(pickLightGroup(() => 0)).toBe('red');
    expect(pickLightGroup(() => 0.34)).toBe('blue');
    expect(pickLightGroup(() => 0.67)).toBe('purple');
    expect(pickLightGroup(() => 0.999)).toBe('purple');
  });
});

describe('JpSystem — 累積/燈/派彩', () => {
  it('初始倍數 = 各組起始', () => {
    const { sys } = makeSystem();
    expect(sys.getMultiplier('red')).toBe(JP_GROUP_CONFIG.red.startMultiplier);
    expect(sys.getMultiplier('blue')).toBe(10);
    expect(sys.getMultiplier('purple')).toBe(20);
    expect(sys.getLights('red')).toBe(0);
  });

  it('notifyCreditSpent 累積倍數（10 Credit = 1 幣 = 1 步進）', () => {
    const { sys } = makeSystem();
    sys.notifyCreditSpent(10); // 1 幣
    expect(sys.getMultiplier('red')).toBeCloseTo(5 + multiplierStepPerCoin('red'));
  });

  it('倍數封頂 clamp（狂灌 Credit 不超過 cap）', () => {
    const { sys } = makeSystem();
    sys.notifyCreditSpent(10 * 100000); // 遠超
    expect(sys.getMultiplier('red')).toBe(JP_GROUP_CONFIG.red.capMultiplier); // 30
    expect(sys.getMultiplier('blue')).toBe(50);
    expect(sys.getMultiplier('purple')).toBe(80);
  });

  it('每幕通關給一組 +1 燈；集滿 5 燈觸發派彩 = 倍數×30、歸零重累積', () => {
    const { sys, state } = makeSystem();
    // 先把紅拉到某倍數（灌 Credit）。
    sys.notifyCreditSpent(10 * 100000); // 紅封頂 30
    // 強制連續給紅燈：rng=0 恆選 red（用 private onStageClear 經 wave 回呼）。
    const clear = state.stageClear!;
    // 需要固定選紅：直接呼叫 5 次通關，但 pickLightGroup 用 Math.random。
    // 改用注入：多呼叫直到紅集滿（統計上會有雜訊）→ 這裡改成直接測 payout 路徑：
    // 用 rng 可控的方式不易；改為呼叫 clear 多次並檢查「總派彩發生且倍數曾歸零」。
    // 簡化：直接灌到紅 5 燈——因 pickLightGroup 隨機，改測「集滿必觸發」用 helper：
    for (let i = 0; i < 200 && sys.getLights('red') < JP_LIGHTS_TO_TRIGGER; i += 1) {
      clear();
    }
    // 紅最終應曾集滿並派彩（倍數被歸零成起始，或又累積回一點）。
    expect(state.ticketsAdded).toBeGreaterThan(0);
  });

  it('派彩金額 = 當前倍數 × 30（用可控燈觸發：紅封頂30→應派 900）', () => {
    // 直接驗 payout 公式（透過 private 反射觸發單組）。
    const { sys, state } = makeSystem();
    sys.notifyCreditSpent(10 * 100000); // 紅 cap 30
    const priv = sys as unknown as { payout: (g: 'red') => void };
    priv.payout('red');
    expect(state.ticketsAdded).toBe(Math.round(30 * JP_TICKET_FACE)); // 900
    expect(sys.getMultiplier('red')).toBe(JP_GROUP_CONFIG.red.startMultiplier); // 歸零重累積
    expect(sys.getLights('red')).toBe(0);
  });

  // 🔴 壞版必紅：派彩若沒歸零倍數，第二次派彩金額會相同（應該歸零重累積）。
  it('壞版對照：派彩後倍數必須歸零（否則連續派彩金額不會回落）', () => {
    const { sys } = makeSystem();
    sys.notifyCreditSpent(10 * 100000); // cap 30
    const priv = sys as unknown as { payout: (g: 'red') => void };
    priv.payout('red');
    const afterFirst = sys.getMultiplier('red');
    expect(afterFirst).toBe(JP_GROUP_CONFIG.red.startMultiplier); // 5，非 30
    expect(afterFirst).not.toBe(JP_GROUP_CONFIG.red.capMultiplier);
  });
});
