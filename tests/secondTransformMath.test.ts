import { describe, expect, it } from 'vitest';
import {
  makeSecondTransformState,
  accumulateSecondEnergy,
  decaySecondEnergy,
  loseSecondEnergy,
  secondEnergyRatio,
  isSecondActive,
  type SecondTransformState,
} from '@/systems/secondTransformMath';

/**
 * secondTransformMath — 二段變身能量條純函式（用戶新大功能）。
 * 覆蓋：累積（達閾值觸發）/消退（退完解除）/ratio/邊界/壞版對照。純函式、不可變。
 * ★feature flag（SECOND_TRANSFORM_CONFIG.enabled）由 TransformSystem gate，非此模組職責。
 */
describe('secondTransformMath — 累積 accumulateSecondEnergy', () => {
  it('初始 energy 0、非 active、ratio 0', () => {
    const s = makeSecondTransformState();
    expect(s.energy).toBe(0);
    expect(isSecondActive(s)).toBe(false);
    expect(secondEnergyRatio(s)).toBe(0);
  });

  it('累積 < 閾值 → energy 增、未觸發（active=false）', () => {
    let s = makeSecondTransformState();
    s = accumulateSecondEnergy(s, 0.3, 1);
    expect(s.energy).toBeCloseTo(0.3);
    expect(s.active).toBe(false);
    s = accumulateSecondEnergy(s, 0.3, 1);
    expect(s.energy).toBeCloseTo(0.6);
    expect(s.active).toBe(false);
  });

  it('累積達閾值 → 觸發二段（active=true、energy 填滿 1）', () => {
    let s = makeSecondTransformState();
    s = accumulateSecondEnergy(s, 0.7, 1);
    s = accumulateSecondEnergy(s, 0.4, 1); // 1.1 → cap 1、觸發
    expect(s.energy).toBe(1);
    expect(s.active).toBe(true);
  });

  it('恰好達閾值（=1）→ 觸發', () => {
    let s = makeSecondTransformState();
    s = accumulateSecondEnergy(s, 1, 1);
    expect(s.active).toBe(true);
    expect(s.energy).toBe(1);
  });

  it('二段中（active）再累積 → no-op（不因打怪延長，避免無限二段）', () => {
    let s: SecondTransformState = { energy: 1, active: true };
    const after = accumulateSecondEnergy(s, 0.5, 1);
    expect(after).toBe(s); // 同參考、不變
  });

  it('壞版對照：amount<=0 → no-op（不累積、不觸發）', () => {
    const s = makeSecondTransformState();
    expect(accumulateSecondEnergy(s, 0, 1)).toBe(s);
    expect(accumulateSecondEnergy(s, -5, 1)).toBe(s);
  });

  it('energy cap 1（超量累積不溢出）', () => {
    let s = makeSecondTransformState();
    s = accumulateSecondEnergy(s, 5, 1);
    expect(s.energy).toBe(1);
    expect(secondEnergyRatio(s)).toBe(1);
  });
});

describe('secondTransformMath — 消退 decaySecondEnergy', () => {
  it('active 中隨時間消退（energy 降）', () => {
    let s: SecondTransformState = { energy: 1, active: true };
    s = decaySecondEnergy(s, 1, 0.125); // -0.125
    expect(s.energy).toBeCloseTo(0.875);
    expect(s.active).toBe(true);
  });

  it('消退到 <=0 → 解除二段（active=false, energy=0）', () => {
    let s: SecondTransformState = { energy: 0.1, active: true };
    s = decaySecondEnergy(s, 1, 0.125); // 0.1-0.125 <=0
    expect(s.energy).toBe(0);
    expect(s.active).toBe(false);
  });

  it('滿能量二段 → 跑滿一輪消退（1/decayPerSec 秒）退完解除', () => {
    let s: SecondTransformState = { energy: 1, active: true };
    const decay = 0.125; // 8s 退完
    for (let i = 0; i < 8; i += 1) s = decaySecondEnergy(s, 1, decay);
    expect(s.active).toBe(false);
    expect(s.energy).toBe(0);
  });

  it('非 active → 消退 no-op（未觸發的累積能量不隨時間掉）', () => {
    const s: SecondTransformState = { energy: 0.5, active: false };
    expect(decaySecondEnergy(s, 1, 0.125)).toBe(s);
  });

  it('壞版對照：dt<=0 或 decayPerSec<=0 → 不變', () => {
    const s: SecondTransformState = { energy: 0.5, active: true };
    expect(decaySecondEnergy(s, 0, 0.125)).toBe(s);
    expect(decaySecondEnergy(s, -1, 0.125)).toBe(s);
    expect(decaySecondEnergy(s, 1, 0)).toBe(s);
  });
});

describe('secondTransformMath — 完整週期（累積→滿觸發→消退→退完解除）', () => {
  it('打怪填滿 → 二段 → 時間退完 → 回一段', () => {
    let s = makeSecondTransformState();
    // 累積到滿（8 隻 ×0.12=0.96，第 9 隻觸發）。
    for (let i = 0; i < 9; i += 1) s = accumulateSecondEnergy(s, 0.12, 1);
    expect(s.active).toBe(true);
    expect(s.energy).toBe(1);
    // 消退退完。
    let guard = 0;
    while (s.active && guard < 1000) {
      s = decaySecondEnergy(s, 0.1, 0.125);
      guard += 1;
    }
    expect(s.active).toBe(false);
    expect(s.energy).toBe(0);
  });
});

describe('secondTransformMath — 階段3 被打倒扣 loseSecondEnergy（clamp 0）', () => {
  it('累積態被打 → energy 倒扣該量（不觸發 active）', () => {
    const s: SecondTransformState = { energy: 0.5, active: false };
    const r = loseSecondEnergy(s, 0.1);
    expect(r.energy).toBeCloseTo(0.4, 6);
    expect(r.active).toBe(false);
  });

  it('★能量 0 → 不扣（clamp 0，不會負，回原能量 0）', () => {
    const s: SecondTransformState = { energy: 0, active: false };
    const r = loseSecondEnergy(s, 0.1);
    expect(r.energy).toBe(0); // 0 不扣
  });

  it('★扣超過剩餘 → clamp 到 0（不負）', () => {
    const s: SecondTransformState = { energy: 0.08, active: false };
    const r = loseSecondEnergy(s, 0.3);
    expect(r.energy).toBe(0); // max(0, 0.08-0.3)=0，非 -0.22
  });

  it('倒扣量 <=0 / NaN → no-op（回原 state）', () => {
    const s: SecondTransformState = { energy: 0.5, active: false };
    expect(loseSecondEnergy(s, 0).energy).toBe(0.5);
    expect(loseSecondEnergy(s, -0.2).energy).toBe(0.5);
    expect(loseSecondEnergy(s, NaN).energy).toBe(0.5);
  });

  it('active（二段中）被打 → 只降 energy、不主動翻 active（消退由 decay 管）', () => {
    const s: SecondTransformState = { energy: 1, active: true };
    const r = loseSecondEnergy(s, 0.2);
    expect(r.energy).toBeCloseTo(0.8, 6);
    expect(r.active).toBe(true); // 不因倒扣主動解除
  });
});
