import { describe, expect, it, vi } from 'vitest';
import { BuffSystem } from '@/systems/BuffSystem';
import type { GameContext } from '@/systems/GameContext';

/**
 * BuffSystem 通用計時 buff 框架測試。
 * 含壞版必紅：到期還原(onExpire)、重套覆蓋(重置計時不重跑 onApply)、多個並存。
 */
function make() {
  const sys = new BuffSystem();
  sys.init({} as unknown as GameContext);
  return sys;
}

describe('BuffSystem — 計時 buff 框架', () => {
  it('apply → onApply 呼叫、isActive true、getRemaining=duration', () => {
    const sys = make();
    const onApply = vi.fn();
    sys.apply({ id: 'MoveSpeed', duration: 8, onApply });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(sys.isActive('MoveSpeed')).toBe(true);
    expect(sys.getRemaining('MoveSpeed')).toBe(8);
  });

  it('到期自動 onExpire + 移除', () => {
    const sys = make();
    const onExpire = vi.fn();
    sys.apply({ id: 'Dash', duration: 5, onExpire });
    sys.update(4);
    expect(sys.isActive('Dash')).toBe(true);
    expect(onExpire).not.toHaveBeenCalled();
    sys.update(1.1); // 累計 5.1 > 5
    expect(sys.isActive('Dash')).toBe(false);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('同 id 重套 = 覆蓋重置計時，不重跑 onApply', () => {
    const sys = make();
    const onApply = vi.fn();
    sys.apply({ id: 'Shield', duration: 8, onApply });
    sys.update(6); // 剩 2
    sys.apply({ id: 'Shield', duration: 8, onApply }); // 重套 → 重置 8
    expect(onApply).toHaveBeenCalledTimes(1); // 沒重跑
    expect(sys.getRemaining('Shield')).toBe(8);
  });

  it('多個 buff 並存、各自到期', () => {
    const sys = make();
    sys.apply({ id: 'MoveSpeed', duration: 3 });
    sys.apply({ id: 'Freeze', duration: 6 });
    sys.update(3.1);
    expect(sys.isActive('MoveSpeed')).toBe(false);
    expect(sys.isActive('Freeze')).toBe(true);
    expect(sys.getActiveIds()).toEqual(['Freeze']);
  });

  it('remove 立即移除 + onExpire', () => {
    const sys = make();
    const onExpire = vi.fn();
    sys.apply({ id: 'mount', duration: 20, onExpire });
    sys.remove('mount');
    expect(sys.isActive('mount')).toBe(false);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  // 🔴 壞版必紅：若到期不觸發 onExpire，還原邏輯就漏（buff 視覺/倍率殘留）。
  it('壞版對照：到期必須觸發 onExpire（否則效果殘留）', () => {
    const sys = make();
    let active = false;
    sys.apply({
      id: 'Lightning',
      duration: 2,
      onApply: () => (active = true),
      onExpire: () => (active = false),
    });
    expect(active).toBe(true);
    sys.update(2.5);
    expect(active).toBe(false); // 到期還原；壞版(不呼叫 onExpire)這裡會 true → 紅
  });
});
