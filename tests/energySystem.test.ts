import { describe, expect, it } from 'vitest';
import { EnergySystem } from '@/systems/EnergySystem';
import type { GameContext } from '@/systems/GameContext';

/**
 * EnergySystem 充能 / 放招 / 模式 測試（決策 15fec2a4）。
 *
 * 用最小 fake context（EnergySystem 只讀 ctx.player.getCharacterKey()），
 * 不需 Phaser。含壞版必紅對照：招式命中或普攻打空氣都不該充能。
 */
function makeSystem(charKey: string): EnergySystem {
  const sys = new EnergySystem();
  const ctx = {
    player: { getCharacterKey: () => charKey },
  } as unknown as GameContext;
  sys.init(ctx);
  return sys;
}

describe('EnergySystem — 充能與放招', () => {
  it('applyMultiplier: finalDmg = max(1, round(base × mult))', () => {
    expect(EnergySystem.applyMultiplier(1, 0.5)).toBe(1); // round(0.5)=1? round=0→max1
    expect(EnergySystem.applyMultiplier(3, 0.5)).toBe(2); // round(1.5)=2
    expect(EnergySystem.applyMultiplier(10, 0.5)).toBe(5);
    expect(EnergySystem.applyMultiplier(10, 1.0)).toBe(10);
    expect(EnergySystem.applyMultiplier(1, 0.5)).toBeGreaterThanOrEqual(1); // 不低於 1
  });

  it('凡人 HumanSimple：普攻命中 4 下 → ready，第 5 次攻擊放 skill1（圓形 dmg3）', () => {
    const sys = makeSystem('Human');
    for (let i = 0; i < 4; i += 1) {
      const intent = sys.resolveAttackIntent();
      expect(intent.isSkill).toBe(false); // 未 ready → 普攻
      sys.reportHit(false, true); // 普攻命中 +1
      sys.update(0);
    }
    expect(sys.isReady()).toBe(true);
    expect(sys.getEnergy()).toBe(4);
    const skill = sys.resolveAttackIntent();
    expect(skill.isSkill).toBe(true);
    expect(skill.attack.shapeType).toBe('circle');
    expect(skill.attack.damage).toBe(3);
    // 放招後歸 0
    sys.update(0);
    expect(sys.getEnergy()).toBe(0);
    expect(sys.isReady()).toBe(false);
  });

  it('凡人放招永遠是 skill1（放兩次都圓形 dmg3）', () => {
    const sys = makeSystem('Human');
    const chargeToReady = () => {
      for (let i = 0; i < 4; i += 1) {
        sys.resolveAttackIntent();
        sys.reportHit(false, true);
        sys.update(0);
      }
    };
    chargeToReady();
    const s1 = sys.resolveAttackIntent();
    sys.update(0);
    chargeToReady();
    const s2 = sys.resolveAttackIntent();
    expect(s1.attack.damage).toBe(3);
    expect(s2.attack.damage).toBe(3);
    expect(s1.attack.shapeType).toBe('circle');
    expect(s2.attack.shapeType).toBe('circle');
  });

  it('悟空 Full：集 4 → 放招循環 skill1(fan,3)→skill2(circle,5)→ultimate(rect,10)', () => {
    const sys = makeSystem('SunWukong');
    const chargeAndFire = () => {
      for (let i = 0; i < 4; i += 1) {
        sys.resolveAttackIntent();
        sys.reportHit(false, true);
        sys.update(0);
      }
      const fired = sys.resolveAttackIntent();
      sys.update(0);
      return fired;
    };
    const a = chargeAndFire();
    const b = chargeAndFire();
    const c = chargeAndFire();
    const d = chargeAndFire();
    expect(a.attack.shapeType).toBe('fan');
    expect(a.attack.damage).toBe(3);
    expect(b.attack.shapeType).toBe('circle');
    expect(b.attack.damage).toBe(5);
    expect(c.attack.shapeType).toBe('rectangle');
    expect(c.attack.damage).toBe(10);
    expect(d.attack.damage).toBe(3); // 循環回 skill1
  });

  // 🔴 壞版必紅對照：招式命中、普攻打空氣都不該充能。
  it('招式命中不充能、普攻打空氣不充能', () => {
    const sys = makeSystem('Human');
    sys.reportHit(false, false); // 普攻沒打到 → 不充
    sys.update(0);
    expect(sys.getEnergy()).toBe(0);
    sys.reportHit(true, true); // 招式命中 → 不充
    sys.update(0);
    expect(sys.getEnergy()).toBe(0);
    sys.reportHit(false, true); // 普攻命中 → +1
    sys.update(0);
    expect(sys.getEnergy()).toBe(1);
  });

  it('一次攻擊最多 +1（reportHit 一次 = 一次充能，不論打幾隻）', () => {
    const sys = makeSystem('Human');
    sys.reportHit(false, true); // 一次命中結算（不管打到幾隻）
    sys.update(0);
    expect(sys.getEnergy()).toBe(1);
  });
});

// ===========================================================================
// 深度強化（QA 測騎接手）：計數/循環/倍率的邊界。
// ===========================================================================

describe('EnergySystem — 凡人計數邊界（3 未 ready / 4 ready / 放招歸 0）', () => {
  it('命中 3 下：energy=3、未 ready（第 4 下才到門檻）', () => {
    const sys = makeSystem('Human');
    for (let i = 0; i < 3; i += 1) {
      sys.reportHit(false, true);
      sys.update(0);
    }
    expect(sys.getEnergy()).toBe(3);
    expect(sys.isReady()).toBe(false);
    // 未 ready → 這次攻擊仍是普攻
    expect(sys.resolveAttackIntent().isSkill).toBe(false);
  });

  it('第 4 下命中 → energy=4、ready；再命中不超過上限（clamp 在 4）', () => {
    const sys = makeSystem('Human');
    for (let i = 0; i < 4; i += 1) {
      sys.reportHit(false, true);
      sys.update(0);
    }
    expect(sys.getEnergy()).toBe(4);
    expect(sys.isReady()).toBe(true);
    // 已滿再命中：不超過 cap（Math.min 夾住）
    sys.reportHit(false, true);
    sys.update(0);
    expect(sys.getEnergy()).toBe(4);
  });

  it('ready 後放招 → 歸 0 且 not ready（消耗）', () => {
    const sys = makeSystem('Human');
    for (let i = 0; i < 4; i += 1) {
      sys.reportHit(false, true);
      sys.update(0);
    }
    const fired = sys.resolveAttackIntent();
    expect(fired.isSkill).toBe(true);
    sys.update(0);
    expect(sys.getEnergy()).toBe(0);
    expect(sys.isReady()).toBe(false);
  });
});

describe('EnergySystem — 悟空 Full 循環 index % 3 邊界', () => {
  const fireCycleValue = (sys: EnergySystem): number => {
    for (let i = 0; i < 4; i += 1) {
      sys.reportHit(false, true);
      sys.update(0);
    }
    const fired = sys.resolveAttackIntent();
    sys.update(0);
    return fired.attack.damage;
  };

  it('循環嚴格為 skill1(3)→skill2(5)→ultimate(10)→skill1(3)→skill2(5)（跨越 index%3 邊界）', () => {
    const sys = makeSystem('SunWukong');
    const seq = [
      fireCycleValue(sys), // index0 → skill1
      fireCycleValue(sys), // index1 → skill2
      fireCycleValue(sys), // index2 → ultimate
      fireCycleValue(sys), // index3%3=0 → skill1（回圈邊界）
      fireCycleValue(sys), // index4%3=1 → skill2
    ];
    expect(seq).toEqual([3, 5, 10, 3, 5]);
  });

  it('凡人不循環：連放兩次都 skill1(3)，且形狀恆為 circle', () => {
    const sys = makeSystem('Human');
    const fire = (): { dmg: number; shape: string } => {
      for (let i = 0; i < 4; i += 1) {
        sys.reportHit(false, true);
        sys.update(0);
      }
      const f = sys.resolveAttackIntent();
      sys.update(0);
      return { dmg: f.attack.damage, shape: f.attack.shapeType };
    };
    expect(fire()).toEqual({ dmg: 3, shape: 'circle' });
    expect(fire()).toEqual({ dmg: 3, shape: 'circle' });
  });
});

describe('EnergySystem.applyMultiplier — round + max(1) 邊界', () => {
  it('凡人 0.5：普攻 base1 → round(0.5)=1（剛好落在 1，不需 max 補）', () => {
    expect(EnergySystem.applyMultiplier(1, 0.5)).toBe(1);
  });

  it('max(1) 真的有作用：round 會得 0 的情況被抬到 1（base1 × 0.4 → round(0.4)=0 → 1）', () => {
    // 這條專門釘 max(1)：若拿掉 max，會得 0。
    expect(EnergySystem.applyMultiplier(1, 0.4)).toBe(1);
    expect(Math.round(1 * 0.4)).toBe(0); // 佐證：沒有 max 就是 0
  });

  it('round 半進位邊界：base3×0.5=1.5→2、base5×0.5=2.5→3（round 而非 floor/truncate）', () => {
    expect(EnergySystem.applyMultiplier(3, 0.5)).toBe(2); // round(1.5)=2
    expect(EnergySystem.applyMultiplier(5, 0.5)).toBe(3); // round(2.5)=3（若 floor 會是 2）
  });

  it('變身 1.0：原值不變（base10→10、base1→1）', () => {
    expect(EnergySystem.applyMultiplier(10, 1.0)).toBe(10);
    expect(EnergySystem.applyMultiplier(1, 1.0)).toBe(1);
  });
});
