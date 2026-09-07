import { describe, it, expect } from 'vitest';
import {
  MASH_HITS_TO_FULL,
  MASH_PER_HIT,
  MASH_IDLE_TO_AUTO_SEC,
  mashRatioAfterHit,
  shouldAutoFill,
  autoFillDelta,
  isMashComplete,
} from '@/systems/mashTransformMath';

describe('mashTransformMath — 連打變身填充純邏輯', () => {
  it('mashRatioAfterHit：每按 +1/15，clamp 0..1', () => {
    expect(mashRatioAfterHit(0)).toBeCloseTo(MASH_PER_HIT, 6);
    expect(mashRatioAfterHit(0.9)).toBeCloseTo(0.9 + MASH_PER_HIT, 6);
    expect(mashRatioAfterHit(1)).toBe(1); // 已滿不超過 1
    expect(mashRatioAfterHit(-5)).toBeCloseTo(MASH_PER_HIT, 6); // 負值 clamp 起點 0
  });

  it('連打 15 下填滿（ratio→1，含浮點容忍）', () => {
    let r = 0;
    for (let i = 0; i < MASH_HITS_TO_FULL; i += 1) r = mashRatioAfterHit(r);
    expect(isMashComplete(r)).toBe(true); // 15×(1/15)=0.9999999 也算滿（epsilon）
  });

  it('連打 14 下未滿（不到 15 不完成）', () => {
    let r = 0;
    for (let i = 0; i < MASH_HITS_TO_FULL - 1; i += 1) r = mashRatioAfterHit(r);
    expect(isMashComplete(r)).toBe(false);
  });

  it('shouldAutoFill：idle 達門檻(0.5s)才自動填（連打優先）', () => {
    expect(shouldAutoFill(0)).toBe(false); // 剛連打過 → 不自動
    expect(shouldAutoFill(MASH_IDLE_TO_AUTO_SEC - 0.01)).toBe(false);
    expect(shouldAutoFill(MASH_IDLE_TO_AUTO_SEC)).toBe(true); // 達門檻 → 自動填
    expect(shouldAutoFill(2)).toBe(true);
  });

  it('autoFillDelta：一般自動填 10s 填滿(每秒 0.1)、scripted 快填(每秒 1.0)', () => {
    expect(autoFillDelta(1, false)).toBeCloseTo(0.1, 6); // 一般：1s → +0.1
    expect(autoFillDelta(1, true)).toBeCloseTo(1.0, 6); // scripted：1s → +1.0（~1s 滿）
    expect(autoFillDelta(0, false)).toBe(0);
  });

  it('一般自動填累積 10s → 滿', () => {
    let r = 0;
    for (let i = 0; i < 100; i += 1) r = Math.min(1, r + autoFillDelta(0.1, false)); // 100×0.1s=10s
    expect(isMashComplete(r)).toBe(true);
  });

  // 🔴 壞版必紅對照：isMashComplete 若用嚴格 >=1（無 epsilon），15 下浮點累加會永遠差一點 → 卡死不變身
  it('壞版對照：15 下浮點累加(0.9999999)必須算完成（epsilon 容忍，否則卡死）', () => {
    let r = 0;
    for (let i = 0; i < MASH_HITS_TO_FULL; i += 1) r = mashRatioAfterHit(r);
    expect(r).toBeLessThanOrEqual(1);
    expect(isMashComplete(r)).toBe(true); // 沒 epsilon 會是 false（卡死）
  });
});
