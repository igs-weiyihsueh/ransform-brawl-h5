import { describe, expect, it } from 'vitest';
import {
  resolveComboReward,
  COMBO_REWARD_SCHEMA_VERSION,
  defaultComboRewardFile,
  type ResolvedComboReward,
} from '@/config/comboRewardSchema';

/**
 * comboRewardSchema — COMBO 獎參數 override 解析（用戶要開放 COMBO 獎全參數）。
 * resolveComboReward(override, packaged)：逐欄 override 優先、無/不合法 fallback packaged。
 * ★PKG 各欄「全不同值」→抓「A 欄 fallback 誤讀 B 欄」的串欄 mutant（測騎串欄教訓）。
 */
// 各欄全不同值（且與可能誤讀的鄰欄不同）→ 鎖逐欄不串。
const PKG: ResolvedComboReward = {
  ticketMultiplier: 0.5,
  maxCount: 100,
  baseTimeout: 3,
  timeoutDecay: 0.1,
  minTimeout: 0.6, // ≠ timeoutDecay/其他
  warningTime: 2,
  rewardDurationSec: 1.2,
  burstMinTickets: 8,
  burstMaxTickets: 20,
  burstCountForMax: 30,
};

describe('resolveComboReward — override 優先、逐欄 fallback', () => {
  it('override 沒設（null/undefined/非物件/陣列）→ 全回 packaged', () => {
    expect(resolveComboReward(null, PKG)).toEqual(PKG);
    expect(resolveComboReward(undefined, PKG)).toEqual(PKG);
    expect(resolveComboReward('nope' as unknown, PKG)).toEqual(PKG);
    expect(resolveComboReward(42 as unknown, PKG)).toEqual(PKG);
    expect(resolveComboReward([1] as unknown, PKG)).toEqual(PKG);
  });

  it('version 錯 → 全回 packaged', () => {
    expect(resolveComboReward({ version: 2, ticketMultiplier: 1.5 }, PKG)).toEqual(PKG);
    expect(resolveComboReward({ ticketMultiplier: 1.5 }, PKG)).toEqual(PKG); // 缺 version
  });

  it('★全欄 override → 各欄採用（10 欄全不同值，讀欄不串）', () => {
    const ov = {
      version: 1,
      ticketMultiplier: 1.3, maxCount: 50, baseTimeout: 4.5, timeoutDecay: 0.25,
      minTimeout: 1.1, warningTime: 2.8, rewardDurationSec: 2.2,
      burstMinTickets: 12, burstMaxTickets: 40, burstCountForMax: 45,
    };
    expect(resolveComboReward(ov, PKG)).toEqual({
      ticketMultiplier: 1.3, maxCount: 50, baseTimeout: 4.5, timeoutDecay: 0.25,
      minTimeout: 1.1, warningTime: 2.8, rewardDurationSec: 2.2,
      burstMinTickets: 12, burstMaxTickets: 40, burstCountForMax: 45,
    });
  });

  it('★逐欄 fallback：只給部分欄 → 其餘沿用 packaged（不串欄）', () => {
    const r = resolveComboReward({ version: 1, ticketMultiplier: 0.8, burstMaxTickets: 30 }, PKG);
    expect(r.ticketMultiplier).toBe(0.8); // 有給→採用
    expect(r.burstMaxTickets).toBe(30);
    expect(r.maxCount).toBe(PKG.maxCount); // 沒給→自己的 packaged
    expect(r.baseTimeout).toBe(PKG.baseTimeout);
    expect(r.minTimeout).toBe(PKG.minTimeout);
    expect(r.burstMinTickets).toBe(PKG.burstMinTickets);
    expect(r.rewardDurationSec).toBe(PKG.rewardDurationSec);
  });

  it('★壞值：posNum 欄非有限正數（0/負/NaN/字串/Infinity）→ 該欄 fallback packaged', () => {
    const r = resolveComboReward(
      { version: 1, ticketMultiplier: 0, maxCount: -5, baseTimeout: NaN, minTimeout: '1', warningTime: Infinity, rewardDurationSec: 0, burstMinTickets: -1, burstMaxTickets: NaN, burstCountForMax: 0 },
      PKG,
    );
    expect(r.ticketMultiplier).toBe(PKG.ticketMultiplier); // 0 不合法
    expect(r.maxCount).toBe(PKG.maxCount); // 負
    expect(r.baseTimeout).toBe(PKG.baseTimeout); // NaN
    expect(r.minTimeout).toBe(PKG.minTimeout); // 字串
    expect(r.warningTime).toBe(PKG.warningTime); // Infinity
    expect(r.rewardDurationSec).toBe(PKG.rewardDurationSec); // 0
    expect(r.burstMinTickets).toBe(PKG.burstMinTickets); // 負
    expect(r.burstMaxTickets).toBe(PKG.burstMaxTickets); // NaN
    expect(r.burstCountForMax).toBe(PKG.burstCountForMax); // 0
  });

  it('★timeoutDecay 特例：允許 0（不縮窗）採用；負/NaN → fallback', () => {
    expect(resolveComboReward({ version: 1, timeoutDecay: 0 }, PKG).timeoutDecay).toBe(0); // ★0 採用（nonNegNum）
    expect(resolveComboReward({ version: 1, timeoutDecay: 0.3 }, PKG).timeoutDecay).toBe(0.3);
    expect(resolveComboReward({ version: 1, timeoutDecay: -0.1 }, PKG).timeoutDecay).toBe(PKG.timeoutDecay); // 負→fallback
    expect(resolveComboReward({ version: 1, timeoutDecay: NaN }, PKG).timeoutDecay).toBe(PKG.timeoutDecay);
  });

  it('★物件守衛：function-with-props（typeof≠object）→ 全回 packaged', () => {
    const fn = Object.assign(function () {}, { version: 1, ticketMultiplier: 1.5 });
    expect(resolveComboReward(fn as unknown, PKG)).toEqual(PKG);
  });

  it('SCHEMA_VERSION=1、defaultComboRewardFile 帶 version + 全欄 packaged', () => {
    expect(COMBO_REWARD_SCHEMA_VERSION).toBe(1);
    const f = defaultComboRewardFile();
    expect(f.version).toBe(1);
    expect(f.ticketMultiplier).toBeTypeOf('number');
    expect(f.burstCountForMax).toBeTypeOf('number');
  });
});
