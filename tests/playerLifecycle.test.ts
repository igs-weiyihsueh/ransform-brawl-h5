import { describe, expect, it } from 'vitest';
import {
  canControlWhenActive,
  shouldEnterOnCoin,
  shouldReturnToWaiting,
  tickOutOfCreditCountdown,
} from '@/systems/playerLifecycle';

/**
 * 投幣進場循環純狀態邏輯測試（項目3 重做）。
 * 位置/Phaser 動畫在 Player/PlayerControl，這裡測純狀態機邏輯。含壞版必紅。
 */
describe('playerLifecycle — 投幣進場循環', () => {
  it('投幣進場：只有 waiting 投幣才進場（entering/active 不重複進場）', () => {
    expect(shouldEnterOnCoin('waiting')).toBe(true);
    expect(shouldEnterOnCoin('entering')).toBe(false);
    expect(shouldEnterOnCoin('active')).toBe(false);
  });

  it('耗盡倒數：遞減、clamp 到 0', () => {
    expect(tickOutOfCreditCountdown(10, 1)).toBe(9);
    expect(tickOutOfCreditCountdown(0.5, 1)).toBe(0); // 不會負
    expect(tickOutOfCreditCountdown(0, 1)).toBe(0);
  });

  it('回待機：耗盡 + 倒數<=0 才回待機', () => {
    expect(shouldReturnToWaiting(true, 0)).toBe(true);
    expect(shouldReturnToWaiting(true, 0.1)).toBe(false); // 還在倒數
    expect(shouldReturnToWaiting(false, 0)).toBe(false); // 沒耗盡不回
  });

  it('active 可操控：非耗盡才可（耗盡凍結）', () => {
    expect(canControlWhenActive(false)).toBe(true);
    expect(canControlWhenActive(true)).toBe(false); // 耗盡凍結不能動
  });

  // 🔴 壞版對照：投幣進場條件若放寬到所有狀態，active 會誤重複進場。
  it('壞版對照：active 投幣不得觸發進場（非 waiting）', () => {
    expect(shouldEnterOnCoin('active')).toBe(false);
  });

  // 🔴 壞版對照：倒數若沒 clamp 會變負、永遠回不了待機判斷。
  it('壞版對照：倒數不會變負（clamp）', () => {
    expect(tickOutOfCreditCountdown(0.1, 5)).toBe(0);
    expect(tickOutOfCreditCountdown(0.1, 5)).toBeGreaterThanOrEqual(0);
  });

  // 🔴 壞版對照：耗盡必須凍結操控（不能動），否則沒 Credit 還能玩。
  it('壞版對照：耗盡狀態不可操控', () => {
    expect(canControlWhenActive(true)).not.toBe(true);
  });
});
