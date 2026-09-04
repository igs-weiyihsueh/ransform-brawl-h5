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

// ===========================================================================
// 深度強化（QA 測騎接手）：順序無關(3-way + 明確排除 last-wins) · 共存/各自到期 ·
// 中途到期更新聚合 · remove · clamp 邊界兩側 · refresh 不重跑 onExpire。
// ===========================================================================

describe('BuffSystem — 🔴 順序無關（排除 last-wins，架構決定）', () => {
  // 3 個同 stat buff，6 種套用順序 → getStatMultiplier 必須全等（1.5×2×1.5=4.5）。
  const orders: Array<Array<[string, number]>> = [
    [['MoveSpeed', 1.5], ['Dash', 2], ['mount', 1.5]],
    [['MoveSpeed', 1.5], ['mount', 1.5], ['Dash', 2]],
    [['Dash', 2], ['MoveSpeed', 1.5], ['mount', 1.5]],
    [['Dash', 2], ['mount', 1.5], ['MoveSpeed', 1.5]],
    [['mount', 1.5], ['MoveSpeed', 1.5], ['Dash', 2]],
    [['mount', 1.5], ['Dash', 2], ['MoveSpeed', 1.5]],
  ];

  it('3 個同 stat buff 的 6 種套用順序 → 聚合倍率全等 4.5（順序無關）', () => {
    const results = orders.map((seq) => {
      const sys = make();
      for (const [id, mag] of seq) {
        sys.apply({ id: id as never, statTag: 'moveSpeed', magnitude: mag, duration: 8 });
      }
      return sys.getStatMultiplier('moveSpeed');
    });
    for (const r of results) expect(r).toBeCloseTo(4.5);
    // 全部相等（順序無關的直接斷言）。
    expect(new Set(results.map((r) => r.toFixed(6))).size).toBe(1);
  });

  it('明確排除 last-wins：先 A(×1.5) 後 B(×2) 與 先 B 後 A 都是 3（非 last-wins 的 2 或 1.5）', () => {
    const ab = make();
    ab.apply({ id: 'MoveSpeed', statTag: 'moveSpeed', magnitude: 1.5, duration: 8 });
    ab.apply({ id: 'Dash', statTag: 'moveSpeed', magnitude: 2, duration: 8 });
    const ba = make();
    ba.apply({ id: 'Dash', statTag: 'moveSpeed', magnitude: 2, duration: 8 });
    ba.apply({ id: 'MoveSpeed', statTag: 'moveSpeed', magnitude: 1.5, duration: 8 });
    expect(ab.getStatMultiplier('moveSpeed')).toBeCloseTo(3);
    expect(ba.getStatMultiplier('moveSpeed')).toBeCloseTo(3);
    // 非 last-wins：last-wins 會是「最後套的那個」→ ab=2、ba=1.5（不相等且各自≠3）。
    expect(ab.getStatMultiplier('moveSpeed')).not.toBeCloseTo(2);
    expect(ba.getStatMultiplier('moveSpeed')).not.toBeCloseTo(1.5);
  });
});

describe('BuffSystem — 不同 buff 共存 / 各自到期', () => {
  it('不同 stat 的 buff 各自獨立（moveSpeed 與 dashSpeed 互不干擾）', () => {
    const sys = make();
    sys.apply({ id: 'MoveSpeed', statTag: 'moveSpeed', magnitude: 1.5, duration: 8 });
    sys.apply({ id: 'Dash', statTag: 'dashSpeed', magnitude: 2, duration: 8 });
    expect(sys.getStatMultiplier('moveSpeed')).toBeCloseTo(1.5);
    expect(sys.getStatMultiplier('dashSpeed')).toBeCloseTo(2);
    expect(sys.getStatMultiplier('damage')).toBe(1); // 無此 stat buff
  });

  it('各自到期：短的先到期只還原它自己，長的仍在', () => {
    const sys = make();
    sys.apply({ id: 'MoveSpeed', statTag: 'moveSpeed', magnitude: 1.5, duration: 3 });
    sys.apply({ id: 'Dash', statTag: 'dashSpeed', magnitude: 2, duration: 10 });
    sys.update(4); // MoveSpeed 到期、Dash 仍在
    expect(sys.isActive('MoveSpeed')).toBe(false);
    expect(sys.isActive('Dash')).toBe(true);
    expect(sys.getStatMultiplier('moveSpeed')).toBe(1); // 還原
    expect(sys.getStatMultiplier('dashSpeed')).toBeCloseTo(2); // 不受影響
  });

  it('同 stat 兩來源，其一到期 → 聚合更新為剩下那個（2.25→1.5）', () => {
    const sys = make();
    sys.apply({ id: 'mount', statTag: 'dashSpeed', magnitude: 1.5, duration: 3 });
    sys.apply({ id: 'Dash', statTag: 'dashSpeed', magnitude: 1.5, duration: 10 });
    expect(sys.getStatMultiplier('dashSpeed')).toBeCloseTo(2.25);
    sys.update(4); // mount 到期
    expect(sys.getStatMultiplier('dashSpeed')).toBeCloseTo(1.5); // 只剩 Dash
  });
});

describe('BuffSystem — remove / clamp 邊界', () => {
  it('remove(id) → 觸發 onExpire、移除、聚合還原', () => {
    const sys = make();
    const onExpire = vi.fn();
    sys.apply({ id: 'MoveSpeed', statTag: 'moveSpeed', magnitude: 1.5, duration: 8, onExpire });
    sys.remove('MoveSpeed');
    expect(sys.isActive('MoveSpeed')).toBe(false);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(sys.getStatMultiplier('moveSpeed')).toBe(1);
  });

  it('remove 不存在的 id → 安靜 no-op（不炸、不誤觸 onExpire）', () => {
    const sys = make();
    expect(() => sys.remove('Freeze')).not.toThrow();
  });

  it('clamp 上限：剛好超過 5 夾 5（2×2×2=8→5）；剛好等於 5 不夾（不會 <5）', () => {
    const [, hi] = STAT_MULT_CLAMP;
    const over = make();
    over.apply({ id: 'MoveSpeed', statTag: 'moveSpeed', magnitude: 2, duration: 8 });
    over.apply({ id: 'Dash', statTag: 'moveSpeed', magnitude: 2, duration: 8 });
    over.apply({ id: 'mount', statTag: 'moveSpeed', magnitude: 2, duration: 8 });
    expect(over.getStatMultiplier('moveSpeed')).toBe(hi); // 8→夾5
  });

  it('clamp 下限：低於 0.1 夾 0.1，不為 0/負（0.05→0.1）', () => {
    const [lo] = STAT_MULT_CLAMP;
    const sys = make();
    sys.apply({ id: 'Freeze', statTag: 'moveSpeed', magnitude: 0.05, duration: 8 });
    expect(sys.getStatMultiplier('moveSpeed')).toBe(lo);
    expect(sys.getStatMultiplier('moveSpeed')).toBeGreaterThan(0); // 非 0/負
  });

  it('clamp 是套「聚合後」：兩個各自在界內但相乘超界 → 夾（3×3=9→5）', () => {
    const [, hi] = STAT_MULT_CLAMP;
    const sys = make();
    sys.apply({ id: 'MoveSpeed', statTag: 'moveSpeed', magnitude: 3, duration: 8 });
    sys.apply({ id: 'Dash', statTag: 'moveSpeed', magnitude: 3, duration: 8 });
    expect(sys.getStatMultiplier('moveSpeed')).toBe(hi); // 聚合後 9 才夾，非各自夾後相乘
  });

  it('refresh（同 id 重套）不重跑 onExpire（只有真到期/remove 才 onExpire）', () => {
    const sys = make();
    const onExpire = vi.fn();
    sys.apply({ id: 'Dash', statTag: 'dashSpeed', magnitude: 1.5, duration: 8, onExpire });
    sys.apply({ id: 'Dash', statTag: 'dashSpeed', magnitude: 1.5, duration: 8, onExpire }); // refresh
    expect(onExpire).not.toHaveBeenCalled();
  });
});
