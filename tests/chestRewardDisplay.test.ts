import { describe, expect, it } from 'vitest';
import {
  CHEST_REWARD_FX,
  chestRewardIsTicket,
  chestRewardLabel,
} from '@/systems/chestRewardDisplay';

/**
 * 開箱報獎表演純呈現邏輯測試（第5項）。
 * 光環/飄字的 Phaser 繪製在 EffectSystem，這裡測純呈現：報獎文字/種類判定。含壞版必紅。
 * ⚠️ 純視覺；chest 數值不受影響。
 */
describe('chestRewardDisplay — 開箱報獎', () => {
  it('彩票類報獎文字 = +N（張數）', () => {
    expect(chestRewardLabel('ticketSmall', 50)).toBe('+50');
    expect(chestRewardLabel('ticketMedium', 120)).toBe('+120');
    expect(chestRewardLabel('ticketLarge', 260)).toBe('+260');
  });

  it('效果類報獎文字：坐騎/二段變身', () => {
    expect(chestRewardLabel('mount', 0)).toBe('坐騎!');
    expect(chestRewardLabel('secondTransform', 0)).toBe('二段變身!');
  });

  it('彩票種類判定', () => {
    expect(chestRewardIsTicket('ticketSmall')).toBe(true);
    expect(chestRewardIsTicket('ticketLarge')).toBe(true);
    expect(chestRewardIsTicket('mount')).toBe(false);
    expect(chestRewardIsTicket('secondTransform')).toBe(false);
  });

  it('表演參數合理（時長/位移/脈動 > 0）', () => {
    expect(CHEST_REWARD_FX.durationSec).toBeGreaterThan(0);
    expect(CHEST_REWARD_FX.risePx).toBeGreaterThan(0);
    expect(CHEST_REWARD_FX.pulseScale).toBeGreaterThan(1); // 放大脈動
  });

  // 🔴 壞版對照：彩票報獎必須帶張數（+N），不能是空/固定字。
  it('壞版對照：彩票報獎帶實際張數（不同張數不同文字）', () => {
    expect(chestRewardLabel('ticketSmall', 50)).not.toBe(chestRewardLabel('ticketSmall', 120));
    expect(chestRewardLabel('ticketMedium', 120)).toContain('120');
  });

  // 🔴 壞版對照：效果類不可被當成彩票（否則會顯 +0）。
  it('壞版對照：效果類非彩票（不顯 +N）', () => {
    expect(chestRewardIsTicket('mount')).toBe(false);
    expect(chestRewardLabel('mount', 0)).not.toContain('+');
  });
});
