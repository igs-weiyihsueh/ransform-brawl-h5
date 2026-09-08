// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  makeDashChargeState,
  canDash,
  consumeDashCharge,
  tickDashCharge,
  dashCooldownProgress,
  type DashChargeState,
} from '@/systems/dashChargeMath';

/**
 * dashChargeMath — 衝刺充能格計時純函式（用戶新設計，翼騎抽出；異靈交辦補測。maxCharges3/cooldownDuration2s 規格）。
 * make/canDash/consume/tick/progress，不可變（回新 state）。
 * 規格：滿格初始;消耗-1(滿格掉下→cooldownElapsed 起算 0、已回充中→不打斷);tick 非滿格累加 dt 跨格回充、滿格不超充歸0;
 *   progress=elapsed/duration(滿格0、clamp01)。
 * 維度3 斷 charges/elapsed/bool/progress。含壞版必紅(canDash>0/滿格不超充/滿格掉下重置 vs 回充中不打斷/progress clamp)。
 * ⚠️ PlayerControlSystem 每 pid 存 state + 每幀 tick 接線屬狀態機(需 boot)——不補;dashChargeMath 純函式補足。
 */
const MAX = 3;
const CD = 2; // cooldownDuration 2s（異靈規格）

describe('makeDashChargeState — 初始滿格', () => {
  it('預設 maxCharges=3 → 滿格、elapsed 0', () => {
    expect(makeDashChargeState()).toEqual({ currentCharges: 3, cooldownElapsed: 0 });
  });
  it('自訂 maxCharges；負/小數 → clamp floor 且 >=0', () => {
    expect(makeDashChargeState(5).currentCharges).toBe(5);
    expect(makeDashChargeState(-2).currentCharges).toBe(0);
    expect(makeDashChargeState(2.9).currentCharges).toBe(2);
  });
});

describe('canDash — 有格才可衝', () => {
  it('★ currentCharges>0 → true、=0 → false', () => {
    expect(canDash({ currentCharges: 1, cooldownElapsed: 0 })).toBe(true);
    expect(canDash({ currentCharges: 3, cooldownElapsed: 0 })).toBe(true);
    expect(canDash({ currentCharges: 0, cooldownElapsed: 0 })).toBe(false);
  });
});

describe('consumeDashCharge — 消耗一格', () => {
  it('★ 滿格消耗 → -1 且 cooldownElapsed 從 0 起算（開始跑冷卻）', () => {
    const r = consumeDashCharge({ currentCharges: 3, cooldownElapsed: 5 }, MAX);
    expect(r.consumed).toBe(true);
    expect(r.state.currentCharges).toBe(2);
    expect(r.state.cooldownElapsed).toBe(0); // 滿格掉下 → 重置起算
  });
  it('★ 已非滿格(回充中)消耗 → -1 但保留 cooldownElapsed（不打斷正在跑的冷卻）', () => {
    const r = consumeDashCharge({ currentCharges: 2, cooldownElapsed: 1.3 }, MAX);
    expect(r.state.currentCharges).toBe(1);
    expect(r.state.cooldownElapsed).toBe(1.3); // 不打斷
  });
  it('無格消耗 → 不變、consumed=false', () => {
    const s: DashChargeState = { currentCharges: 0, cooldownElapsed: 0.5 };
    const r = consumeDashCharge(s, MAX);
    expect(r.consumed).toBe(false);
    expect(r.state).toBe(s); // 原樣
  });
});

describe('tickDashCharge — 冷卻回充', () => {
  it('★ 非滿格：累加 dt，跑滿 cooldownDuration → +1 格、餘量帶入', () => {
    // 2 格、elapsed 0，dt=2（=CD）→ +1 格到 3（滿）、elapsed 歸 0。
    expect(tickDashCharge({ currentCharges: 2, cooldownElapsed: 0 }, CD, MAX, CD))
      .toEqual({ currentCharges: 3, cooldownElapsed: 0 });
    // 1 格、elapsed 0.5，dt=1 → elapsed 1.5 < 2 → 不回充。
    expect(tickDashCharge({ currentCharges: 1, cooldownElapsed: 0.5 }, 1, MAX, CD))
      .toEqual({ currentCharges: 1, cooldownElapsed: 1.5 });
  });

  it('餘量帶入下一格：跨過 duration 的餘量繼續累積', () => {
    // 1 格、elapsed 0，dt=2.5，CD=2 → +1 格(到2)、餘 0.5 帶入。
    expect(tickDashCharge({ currentCharges: 1, cooldownElapsed: 0 }, 2.5, MAX, CD))
      .toEqual({ currentCharges: 2, cooldownElapsed: 0.5 });
  });

  it('★ 一幀跨多格（大 dt / 短 CD）', () => {
    // 0 格、dt=5、CD=2 → 跨 2 格(到2)、餘 1；再 dt 讓到滿則歸 0。
    expect(tickDashCharge({ currentCharges: 0, cooldownElapsed: 0 }, 5, MAX, CD))
      .toEqual({ currentCharges: 2, cooldownElapsed: 1 });
    // dt=100 → 直接補滿(3)、不超充、elapsed 歸 0。
    expect(tickDashCharge({ currentCharges: 0, cooldownElapsed: 0 }, 100, MAX, CD))
      .toEqual({ currentCharges: 3, cooldownElapsed: 0 });
  });

  it('★ 滿格不超充：elapsed 歸 0、charges 不超過 max', () => {
    expect(tickDashCharge({ currentCharges: 3, cooldownElapsed: 1.5 }, 10, MAX, CD))
      .toEqual({ currentCharges: 3, cooldownElapsed: 0 });
    // 滿格 elapsed 已 0 → 原 state 返回。
    const full: DashChargeState = { currentCharges: 3, cooldownElapsed: 0 };
    expect(tickDashCharge(full, 10, MAX, CD)).toBe(full);
  });

  it('dt<=0 或 CD<=0 → 不變', () => {
    const s: DashChargeState = { currentCharges: 1, cooldownElapsed: 0.5 };
    expect(tickDashCharge(s, 0, MAX, CD)).toBe(s);
    expect(tickDashCharge(s, -1, MAX, CD)).toBe(s);
    expect(tickDashCharge(s, 1, MAX, 0)).toBe(s);
  });
});

describe('dashCooldownProgress — 當前回充格進度 0~1', () => {
  it('★ 滿格 → 0（不顯示壓黑）', () => {
    expect(dashCooldownProgress({ currentCharges: 3, cooldownElapsed: 0 }, MAX, CD)).toBe(0);
  });
  it('非滿格 → elapsed/duration', () => {
    expect(dashCooldownProgress({ currentCharges: 1, cooldownElapsed: 1 }, MAX, CD)).toBeCloseTo(0.5); // 1/2
    expect(dashCooldownProgress({ currentCharges: 0, cooldownElapsed: 0.5 }, MAX, CD)).toBeCloseTo(0.25); // 0.5/2
  });
  it('★ clamp 0..1（elapsed 超過 duration 或負）', () => {
    expect(dashCooldownProgress({ currentCharges: 1, cooldownElapsed: 5 }, MAX, CD)).toBe(1); // >1 clamp
    expect(dashCooldownProgress({ currentCharges: 1, cooldownElapsed: -1 }, MAX, CD)).toBe(0); // <0 clamp
  });
});

describe('整合序列：滿格→消耗→回充回滿', () => {
  it('3 格用掉 1 格，跑 2s 回 1 格回到滿', () => {
    let s = makeDashChargeState(MAX); // {3,0}
    s = consumeDashCharge(s, MAX).state; // {2,0}
    expect(s.currentCharges).toBe(2);
    s = tickDashCharge(s, 1, MAX, CD); // elapsed 1 < 2
    expect(s.currentCharges).toBe(2);
    expect(dashCooldownProgress(s, MAX, CD)).toBeCloseTo(0.5);
    s = tickDashCharge(s, 1, MAX, CD); // elapsed 2 → +1 到滿、歸 0
    expect(s).toEqual({ currentCharges: 3, cooldownElapsed: 0 });
    expect(dashCooldownProgress(s, MAX, CD)).toBe(0);
  });
});
