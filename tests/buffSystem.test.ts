import { describe, expect, it, vi } from 'vitest';
import { STAT_MULT_CLAMP } from '@/config/buffConfig';
import { BuffSystem } from '@/systems/BuffSystem';
import type { GameContext } from '@/systems/GameContext';

/**
 * BuffSystem 統一計時 buff 框架測試（顧問 confirm 形狀）。
 * 含壞版必紅：到期還原、重套 refresh 不疊、同 stat 多來源相乘、clamp 套聚合後。
 */
function make() {
  const sys = new BuffSystem();
  sys.init({} as unknown as GameContext);
  return sys;
}

describe('BuffSystem — 計時 / 生命週期', () => {
  it('apply → onApply、isActive、getRemaining=duration', () => {
    const sys = make();
    const onApply = vi.fn();
    sys.apply({ id: 'MoveSpeed', statTag: 'moveSpeed', magnitude: 1.5, duration: 8, onApply });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(sys.isActive('MoveSpeed')).toBe(true);
    expect(sys.getRemaining('MoveSpeed')).toBe(8);
  });

  it('到期自動 onExpire + 移除', () => {
    const sys = make();
    const onExpire = vi.fn();
    sys.apply({ id: 'Dash', statTag: 'dashSpeed', magnitude: 1.5, duration: 5, onExpire });
    sys.update(4);
    expect(sys.isActive('Dash')).toBe(true);
    sys.update(1.1);
    expect(sys.isActive('Dash')).toBe(false);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('同 id 重套 = refresh 計時，不重跑 onApply、不疊 magnitude', () => {
    const sys = make();
    const onApply = vi.fn();
    sys.apply({ id: 'Dash', statTag: 'dashSpeed', magnitude: 1.5, duration: 8, onApply });
    sys.update(6);
    sys.apply({ id: 'Dash', statTag: 'dashSpeed', magnitude: 1.5, duration: 8, onApply });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(sys.getRemaining('Dash')).toBe(8);
    // 未疊加：dashSpeed 仍 1.5（非 2.25）。
    expect(sys.getStatMultiplier('dashSpeed')).toBeCloseTo(1.5);
  });
});

describe('BuffSystem — getStatMultiplier 聚合', () => {
  it('無命中回 1', () => {
    expect(make().getStatMultiplier('moveSpeed')).toBe(1);
  });

  it('單一 buff = 單一 mult（等同 Unity base×mult）', () => {
    const sys = make();
    sys.apply({ id: 'MoveSpeed', statTag: 'moveSpeed', magnitude: 1.5, duration: 8 });
    expect(sys.getStatMultiplier('moveSpeed')).toBeCloseTo(1.5);
  });

  it('同 stat 多來源 = 相乘、順序無關（坐騎1.5 × 頭盔Dash1.5 = 2.25）', () => {
    const a = make();
    a.apply({ id: 'mount', statTag: 'dashSpeed', magnitude: 1.5, duration: 20 });
    a.apply({ id: 'Dash', statTag: 'dashSpeed', magnitude: 1.5, duration: 8 });
    const b = make();
    b.apply({ id: 'Dash', statTag: 'dashSpeed', magnitude: 1.5, duration: 8 });
    b.apply({ id: 'mount', statTag: 'dashSpeed', magnitude: 1.5, duration: 20 });
    expect(a.getStatMultiplier('dashSpeed')).toBeCloseTo(2.25);
    expect(b.getStatMultiplier('dashSpeed')).toBeCloseTo(2.25); // 順序無關
  });

  it('clamp 套在聚合後結果（上限 5、下限 0.1）', () => {
    const [lo, hi] = STAT_MULT_CLAMP;
    const sys = make();
    // 三個 ×4 = 64 → clamp 上限。
    sys.apply({ id: 'MoveSpeed', statTag: 'moveSpeed', magnitude: 4, duration: 8 });
    sys.apply({ id: 'Dash', statTag: 'moveSpeed', magnitude: 4, duration: 8 });
    sys.apply({ id: 'mount', statTag: 'moveSpeed', magnitude: 4, duration: 8 });
    expect(sys.getStatMultiplier('moveSpeed')).toBe(hi);
    const sys2 = make();
    sys2.apply({ id: 'Freeze', statTag: 'moveSpeed', magnitude: 0.01, duration: 8 });
    expect(sys2.getStatMultiplier('moveSpeed')).toBe(lo);
  });

  // 🔴 壞版必紅：聚合若用「加法/last-wins」而非相乘，多來源結果會不同。
  it('壞版對照：相乘 2.25 ≠ 加法(1.5+1.5=3) 或 last-wins(1.5)', () => {
    const sys = make();
    sys.apply({ id: 'mount', statTag: 'dashSpeed', magnitude: 1.5, duration: 20 });
    sys.apply({ id: 'Dash', statTag: 'dashSpeed', magnitude: 1.5, duration: 8 });
    const good = sys.getStatMultiplier('dashSpeed');
    expect(good).toBeCloseTo(2.25); // 相乘
    expect(good).not.toBeCloseTo(3); // 非加法
    expect(good).not.toBeCloseTo(1.5); // 非 last-wins
  });

  // 🔴 到期還原：到期後聚合倍率回 1。
  it('到期後該 stat 聚合回 1（效果還原）', () => {
    const sys = make();
    sys.apply({ id: 'MoveSpeed', statTag: 'moveSpeed', magnitude: 1.5, duration: 2 });
    expect(sys.getStatMultiplier('moveSpeed')).toBeCloseTo(1.5);
    sys.update(2.5);
    expect(sys.getStatMultiplier('moveSpeed')).toBe(1);
  });
});
