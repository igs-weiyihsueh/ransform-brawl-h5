import { describe, expect, it } from 'vitest';
import {
  COMBO_REWARD_FX,
  comboRewardFontSize,
  comboRewardLabel,
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
