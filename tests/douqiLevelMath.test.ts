import { describe, expect, it } from 'vitest';
import { levelLerp, levelScale, expForKill, applyKillExp, expToNextLevel } from '@/systems/douqiLevelMath';

const CAP = 10;
const CURVE = [50, 100, 150, 200, 250, 290, 340, 380, 440];

describe('levelLerp — 雙軌線性內插（夾 [1,cap]）', () => {
  it('Lv1 → base×lv1Scale', () => expect(levelLerp(100, 0.35, 1, CAP)).toBeCloseTo(35));
  it('Lvcap → base 滿值', () => expect(levelLerp(100, 0.35, 10, CAP)).toBeCloseTo(100));
  it('中間 Lv5 線性', () => expect(levelLerp(100, 0.35, 5, CAP)).toBeCloseTo(35 + (100 - 35) * 4 / 9));
  it('★level<1 夾到 1', () => expect(levelLerp(100, 0.35, 0, CAP)).toBeCloseTo(35));
  it('★level>cap 夾到 cap（滿值）', () => expect(levelLerp(100, 0.35, 99, CAP)).toBeCloseTo(100));
  it('spawnInterval lv1Scale 1.6（>1 慢→快）Lv1=1.6/Lv10=1.0', () => {
    expect(levelScale(1.6, 1, CAP)).toBeCloseTo(1.6);
    expect(levelScale(1.6, 10, CAP)).toBeCloseTo(1.0);
  });
});

describe('expForKill', () => {
  const mults = { Enemy_Rush: 1, Enemy_Elite: 3, Enemy_Tower: 0 };
  it('normal ×1 → 10', () => expect(expForKill('Enemy_Rush', 10, mults)).toBe(10));
  it('tank/菁英 ×3 → 30', () => expect(expForKill('Enemy_Elite', 10, mults)).toBe(30));
  it('塔 ×0 → 0', () => expect(expForKill('Enemy_Tower', 10, mults)).toBe(0));
  it('未列種類 → 預設 ×1', () => expect(expForKill('unknown', 10, mults)).toBe(10));
});

describe('applyKillExp — 升級（可連升、夾 cap）', () => {
  it('殺 5 normal（50exp）Lv1→2', () => {
    const r = applyKillExp(1, 0, 50, CURVE, CAP);
    expect(r.level).toBe(2);
    expect(r.exp).toBe(0);
    expect(r.leveledUp).toBe(true);
  });
  it('未達門檻只累積不升', () => {
    const r = applyKillExp(1, 0, 30, CURVE, CAP);
    expect(r.level).toBe(1);
    expect(r.exp).toBe(30);
    expect(r.leveledUp).toBe(false);
  });
  it('大量經驗連升多級', () => {
    const r = applyKillExp(1, 0, 200, CURVE, CAP); // 50+100=150升到3、剩50不足150升4
    expect(r.level).toBe(3);
    expect(r.exp).toBe(50);
    expect(r.leveledUp).toBe(true);
  });
  it('★滿級不再累積', () => {
    const r = applyKillExp(10, 0, 500, CURVE, CAP);
    expect(r.level).toBe(10);
    expect(r.exp).toBe(0);
  });
});

describe('expToNextLevel', () => {
  it('Lv1 需 50', () => expect(expToNextLevel(1, CURVE, CAP)).toBe(50));
  it('Lv9 需 440', () => expect(expToNextLevel(9, CURVE, CAP)).toBe(440));
  it('滿級 Lv10 → 0', () => expect(expToNextLevel(10, CURVE, CAP)).toBe(0));
});
