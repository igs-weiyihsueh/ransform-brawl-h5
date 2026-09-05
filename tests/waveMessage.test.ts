import { describe, expect, it } from 'vitest';
import { WAVE_MESSAGE_FX, waveMessageFor } from '@/systems/waveMessage';
import type { LevelNodeData } from '@/config/levelSchema';

/**
 * 波次過場提示文字（#9）純函式測試。文字表演在 EffectSystem，這裡測 節點→文字 對應。含壞版必紅。
 */
const spawn: LevelNodeData = {
  nodeType: 'Spawn',
  killQuota: 5,
  maxAlive: 3,
  spawnThreshold: 2,
  spawnInterval: 1,
  spawns: [],
};
const guard: LevelNodeData = { nodeType: 'Event', eventPresetName: 'Guard60' };
const otherEvent: LevelNodeData = { nodeType: 'Event', eventPresetName: 'Meteor' };
const reward: LevelNodeData = { nodeType: 'Reward' };

describe('waveMessageFor — 波次過場提示', () => {
  it('Spawn 節點 → 第 N 波（帶波序）', () => {
    expect(waveMessageFor(spawn, 1)).toBe('第 1 波');
    expect(waveMessageFor(spawn, 5)).toBe('第 5 波');
  });

  it('Guard 事件 → 守護波！保護雕像！', () => {
    expect(waveMessageFor(guard, 1)).toContain('守護');
    expect(waveMessageFor(guard, 1)).toContain('雕像');
  });

  it('非 Guard 事件 → 通用事件提示', () => {
    expect(waveMessageFor(otherEvent, 1)).toBe('事件！');
  });

  it('Reward 節點 → 過關！', () => {
    expect(waveMessageFor(reward, 1)).toBe('過關！');
  });

  it('表演參數合理（時長/停留比例/字級 > 0）', () => {
    expect(WAVE_MESSAGE_FX.durationSec).toBeGreaterThan(0);
    expect(WAVE_MESSAGE_FX.holdRatio).toBeGreaterThan(0);
    expect(WAVE_MESSAGE_FX.fontSize).toBeGreaterThan(0);
  });

  // 🔴 壞版對照：Spawn 提示必須帶實際波序（不同波不同字）。
  it('壞版對照：Spawn 帶實際波序（第1波 ≠ 第5波）', () => {
    expect(waveMessageFor(spawn, 1)).not.toBe(waveMessageFor(spawn, 5));
    expect(waveMessageFor(spawn, 3)).toContain('3');
  });

  // 🔴 壞版對照：Guard 事件必須是守護波提示（非通用事件/空）。
  it('壞版對照：Guard 事件非通用/空', () => {
    expect(waveMessageFor(guard, 1)).not.toBe('事件！');
    expect(waveMessageFor(guard, 1)).not.toBe('');
  });
});
