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
