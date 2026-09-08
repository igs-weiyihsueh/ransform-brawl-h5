import { describe, expect, it } from 'vitest';
import {
  makeSecondTransformState,
  accumulateSecondEnergy,
  decaySecondEnergy,
  type SecondTransformState,
} from '@/systems/secondTransformMath';

/**
 * secondTransformMath 複核補強（測騎複核翼騎 6915c19 的 13 測）：翼騎 13 測鑑別足（active guard/觸發 >=/解除 <=0/amount<=0 壞版皆紅），
 * 但跑壞版發現兩處未鎖：
 *  1. ★fillThreshold 參數未被釘：翼騎測全用預設 1 → 若實作把 `>= fillThreshold` 誤寫死 `>= 1`(忽略參數)，13 測全綠(slip)。
 *     補「非預設 threshold(0.5) 提早觸發」鎖住參數。
 *  2. decay 恰好 energy-decay×dt===0 邊界（翼騎靠 8 步循環間接掃到,補一條顯式恰=0）。
 * 維度3 斷 energy/active。與翼騎測互補。
 */

describe('accumulateSecondEnergy — fillThreshold 參數釘死（非預設）', () => {
  it('★ threshold=0.5 → 累積到 0.5 就觸發（證 fillThreshold 參數生效,非寫死 1）', () => {
    let s = makeSecondTransformState();
    s = accumulateSecondEnergy(s, 0.5, 0.5); // 0.5 >= 0.5 → 觸發
    expect(s.active).toBe(true);
    expect(s.energy).toBe(1); // 觸發後 energy 填滿 1
  });

  it('★ threshold=0.5 → 累積 0.4(<0.5) 不觸發（低於自訂閾值）', () => {
    let s = makeSecondTransformState();
    s = accumulateSecondEnergy(s, 0.4, 0.5);
    expect(s.active).toBe(false);
    expect(s.energy).toBeCloseTo(0.4);
  });

  it('★ threshold=0.8：0.7 不觸發、再 +0.2→0.9>=0.8 觸發（對照預設 1 會需更多）', () => {
    let s = makeSecondTransformState();
    s = accumulateSecondEnergy(s, 0.7, 0.8);
    expect(s.active).toBe(false); // 0.7 < 0.8
    s = accumulateSecondEnergy(s, 0.2, 0.8); // 0.9 >= 0.8 → 觸發
    expect(s.active).toBe(true);
    expect(s.energy).toBe(1);
  });
});

describe('decaySecondEnergy — 恰好退到 0 邊界', () => {
  it('★ energy - decayPerSec×dt 恰=0 → 解除（<=0 含等於）', () => {
    const s: SecondTransformState = { energy: 0.5, active: true };
    const after = decaySecondEnergy(s, 1, 0.5); // 0.5 - 0.5×1 = 0（恰 0）
    expect(after.energy).toBe(0);
    expect(after.active).toBe(false); // 恰 0 也解除（釘 <= 非 <）
  });

  it('恰好差一點未到 0 → 仍 active', () => {
    const s: SecondTransformState = { energy: 0.5, active: true };
    const after = decaySecondEnergy(s, 1, 0.49); // 0.5-0.49=0.01 > 0
    expect(after.energy).toBeCloseTo(0.01);
    expect(after.active).toBe(true);
  });
});
