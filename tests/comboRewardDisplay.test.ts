import { describe, expect, it } from 'vitest';
import {
  COMBO_REWARD_FX,
  COMBO_TICKET_BURST,
  comboRewardFontSize,
  comboRewardLabel,
  sparkleBurstCount,
  ticketBurstCount,
} from '@/systems/comboRewardDisplay';

/**
 * COMBO 結算報獎表演純呈現邏輯測試（第3項）。
 * 文字彈跳/上飄的 Phaser 繪製在 EffectSystem，這裡測純呈現：報獎文字/滿檔華麗度。含壞版必紅。
 * ⚠️ 純視覺；combo 數值不受影響。
 */
describe('comboRewardDisplay — COMBO 報獎', () => {
  it('一般結算文字：COMBO xN  +M', () => {
    expect(comboRewardLabel(8, 4, false)).toBe('COMBO x8  +4');
    expect(comboRewardLabel(20, 10, false)).toBe('COMBO x20  +10');
  });

  it('滿檔結算文字：MAX 前綴 + 驚嘆', () => {
    const s = comboRewardLabel(100, 50, true);
    expect(s).toContain('MAX');
    expect(s).toContain('COMBO x100');
    expect(s).toContain('+50');
    expect(s.endsWith('!')).toBe(true);
  });

  it('滿檔字級 > 一般字級（更華麗）', () => {
    expect(comboRewardFontSize(true)).toBeGreaterThan(comboRewardFontSize(false));
  });

  it('表演參數合理（時長/位移/彈跳 > 0）', () => {
    expect(COMBO_REWARD_FX.durationSec).toBeGreaterThan(0);
    expect(COMBO_REWARD_FX.risePx).toBeGreaterThan(0);
    expect(COMBO_REWARD_FX.popScale).toBeGreaterThan(1);
  });

  // 🔴 壞版對照：報獎文字必須帶實際 COMBO 數與彩票數（不同數不同字）。
  it('壞版對照：報獎帶實際數字（不同 count/tickets 不同文字）', () => {
    expect(comboRewardLabel(8, 4, false)).not.toBe(comboRewardLabel(20, 10, false));
    expect(comboRewardLabel(8, 4, false)).toContain('8');
    expect(comboRewardLabel(8, 4, false)).toContain('4');
  });

  // 🔴 壞版對照：滿檔必須比一般華麗（字級更大），否則滿檔高光時刻沒突出。
  it('壞版對照：滿檔字級嚴格大於一般（非相等）', () => {
    expect(comboRewardFontSize(true)).not.toBe(comboRewardFontSize(false));
  });
});

describe('彩票噴發數量（ticketBurstCount / sparkleBurstCount，純函式）', () => {
  const c = COMBO_TICKET_BURST;

  it('段數越高噴越多（單調不減），夾在 min~max*加成', () => {
    const n0 = ticketBurstCount(0, false);
    const nMid = ticketBurstCount(c.countForMax / 2, false);
    const nMax = ticketBurstCount(c.countForMax, false);
    expect(n0).toBe(c.minTickets);
    expect(nMid).toBeGreaterThanOrEqual(n0);
    expect(nMax).toBeGreaterThanOrEqual(nMid);
    // 非滿檔上限 = maxTickets
    expect(nMax).toBeLessThanOrEqual(c.maxTickets);
    expect(nMax).toBeGreaterThanOrEqual(c.minTickets);
  });

  it('超過 countForMax 段數 → 仍夾在上限（不無限增長）', () => {
    const huge = ticketBurstCount(9999, false);
    expect(huge).toBe(c.maxTickets); // 非滿檔就是 maxTickets
  });

  it('滿檔比同段數一般多（加成），但夾在 max*加成上限', () => {
    const normal = ticketBurstCount(c.countForMax, false);
    const max = ticketBurstCount(c.countForMax, true);
    expect(max).toBeGreaterThanOrEqual(normal);
    expect(max).toBeLessThanOrEqual(Math.round(c.maxTickets * c.maxBonusMul));
  });

  it('低段數（clamp 下限）不會低於 min', () => {
    expect(ticketBurstCount(0, false)).toBe(c.minTickets);
    expect(ticketBurstCount(-5, false)).toBe(c.minTickets); // 負數 clamp 到 0→min
  });

  it('閃光數量同樣夾在 min~max*加成、段數單調', () => {
    expect(sparkleBurstCount(0, false)).toBe(c.minSparkles);
    expect(sparkleBurstCount(9999, false)).toBe(c.maxSparkles);
    expect(sparkleBurstCount(c.countForMax, true)).toBeGreaterThanOrEqual(
      sparkleBurstCount(c.countForMax, false),
    );
  });

  it('扇形角度偏上（-120~-60°，含正上 -90）+ 重力為正（往下回落）', () => {
    expect(c.angleMinDeg).toBeLessThan(-60 + 0.001);
    expect(c.angleMaxDeg).toBeGreaterThan(-120 - 0.001);
    expect(c.angleMinDeg).toBeLessThanOrEqual(-90);
    expect(c.angleMaxDeg).toBeGreaterThanOrEqual(-90);
    expect(c.gravity).toBeGreaterThan(0);
  });
});
