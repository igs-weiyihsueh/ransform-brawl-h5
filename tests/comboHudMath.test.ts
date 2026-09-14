import { describe, it, expect } from 'vitest';
import { comboFillRatio, comboNodeX, comboNodeState, empowerCountdownLabel } from '@/systems/comboHudMath';

describe('comboHudMath', () => {
  describe('comboFillRatio', () => {
    it('combo/max 夾 0~1', () => {
      expect(comboFillRatio(0, 10)).toBe(0);
      expect(comboFillRatio(5, 10)).toBe(0.5);
      expect(comboFillRatio(10, 10)).toBe(1);
      expect(comboFillRatio(15, 10)).toBe(1); // 夾上限
      expect(comboFillRatio(3, 0)).toBe(0); // max0 防除零
    });
  });

  describe('comboNodeX (按門檻比例定位)', () => {
    it('barX + (threshold/max)×barWidth', () => {
      // barX=100, barWidth=360, max10
      expect(comboNodeX(100, 360, 3, 10)).toBeCloseTo(100 + 0.3 * 360); // 208
      expect(comboNodeX(100, 360, 6, 10)).toBeCloseTo(100 + 0.6 * 360); // 316
      expect(comboNodeX(100, 360, 10, 10)).toBeCloseTo(100 + 360); // 460 條尾
    });
  });

  describe('comboNodeState (三態＝待會放什麼招預告)', () => {
    it('未解鎖：teamLevel < unlockLevel → locked', () => {
      // 圓形斬 unlockLevel2；teamLevel1 未達
      expect(comboNodeState(1, 5, 3, 2)).toBe('locked');
    });
    it('已解鎖但 combo 未達門檻 → unlocked', () => {
      // teamLevel2 達解鎖，combo2 < 門檻3
      expect(comboNodeState(2, 2, 3, 2)).toBe('unlocked');
    });
    it('已解鎖且 combo≥門檻 → ready（下次揮擊放這招）', () => {
      expect(comboNodeState(2, 3, 3, 2)).toBe('ready');
      expect(comboNodeState(5, 9, 6, 4)).toBe('ready'); // 氣波
    });
    it('強化 unlockLevel1：Lv1 即解鎖，combo10 → ready', () => {
      expect(comboNodeState(1, 10, 10, 1)).toBe('ready');
      expect(comboNodeState(1, 9, 10, 1)).toBe('unlocked'); // 還沒到 10
    });
    it('爆發 unlockLevel6：Lv5 未達 → locked（即使 combo 夠）', () => {
      expect(comboNodeState(5, 9, 9, 6)).toBe('locked');
      expect(comboNodeState(6, 9, 9, 6)).toBe('ready');
    });
  });

  describe('empowerCountdownLabel', () => {
    it('>0 顯示強化 X.Xs，否則空字串', () => {
      expect(empowerCountdownLabel(0)).toBe('');
      expect(empowerCountdownLabel(-100)).toBe('');
      expect(empowerCountdownLabel(5000)).toBe('強化 5.0s');
      expect(empowerCountdownLabel(2340)).toBe('強化 2.3s');
    });
  });
});
