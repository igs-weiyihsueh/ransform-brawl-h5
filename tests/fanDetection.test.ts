import { describe, expect, it } from 'vitest';
import type { AttackData } from '@/systems/AttackData';
import { buildAttackFan, fanIntersectsCircle } from '@/systems/hitDetection';

/**
 * Fan（扇形）命中判定測試。對照悟空 skill1：radius1.5 angle160 offsetX0.2 offsetY0.2。
 * PPU=100、scale=1.5 → center=(30,30)px、radius=225px、halfAngle=80°。
 *
 * 含壞版必紅對照（spec §11.2）：正確版要能擋掉「超過半張角」的目標；
 * 若把角度檢查拿掉（退化成純圓），90° 上方那顆會誤判為命中——用對照證明角度真的有作用。
 */
const SKILL1_FAN: AttackData = {
  shapeType: 'fan',
  radius: 1.5,
  angle: 160,
  offsetX: 0.2,
  offsetY: 0.2,
  damage: 3,
  hitDelay: 0.2,
  knockback: 6,
};

const SCALE = 1.5;
const R = 30; // 目標碰撞半徑（px）

describe('fanIntersectsCircle — 扇形命中', () => {
  const fan = buildAttackFan(SKILL1_FAN, { x: 0, y: 0 }, 1, SCALE); // 面右

  it('扇心/半徑/半張角換算正確 (center 30,30 / r225 / half 80deg)', () => {
    expect(Math.round(fan.center.x)).toBe(30);
    expect(Math.round(fan.center.y)).toBe(30);
    expect(Math.round(fan.radius)).toBe(225);
    expect(Math.round((fan.halfAngleRad * 180) / Math.PI)).toBe(80);
  });

  it('正前方近距離 → 命中', () => {
    expect(fanIntersectsCircle(fan, { x: 150, y: fan.center.y }, R)).toBe(true);
  });

  it('正後方（面右時左側）→ 不中（夾角 180 > 80）', () => {
    expect(fanIntersectsCircle(fan, { x: -150, y: fan.center.y }, R)).toBe(false);
  });

  it('正上方 90° → 不中（90 > 半張角 80）', () => {
    expect(fanIntersectsCircle(fan, { x: fan.center.x, y: fan.center.y - 150 }, R)).toBe(
      false,
    );
  });

  it('前上方約 45° → 命中（在 80° 內）', () => {
    expect(
      fanIntersectsCircle(fan, { x: fan.center.x + 150, y: fan.center.y - 150 }, R),
    ).toBe(true);
  });

  it('超出半徑 → 不中', () => {
    expect(fanIntersectsCircle(fan, { x: 1000, y: fan.center.y }, R)).toBe(false);
  });

  it('面左：扇形鏡像，左前方命中、右方不中', () => {
    const fanL = buildAttackFan(SKILL1_FAN, { x: 0, y: 0 }, -1, SCALE);
    expect(Math.round(fanL.center.x)).toBe(-30);
    expect(fanIntersectsCircle(fanL, { x: -150, y: fanL.center.y }, R)).toBe(true);
    expect(fanIntersectsCircle(fanL, { x: 150, y: fanL.center.y }, R)).toBe(false);
  });

  // 🔴 壞版必紅對照：若退化成純圓（忽略角度），90° 上方那顆會誤中。
  it('壞版對照：忽略角度（純圓）會讓 90° 上方誤中，與正確版不同', () => {
    const target = { x: fan.center.x, y: fan.center.y - 150 }; // 在半徑內、但 90°
    // 正確版（含角度）：不中。
    expect(fanIntersectsCircle(fan, target, R)).toBe(false);
    // 壞版（純圓，忽略角度）：在半徑內就中。
    const dx = target.x - fan.center.x;
    const dy = target.y - fan.center.y;
    const circleOnly = Math.hypot(dx, dy) <= fan.radius + R;
    expect(circleOnly).toBe(true);
    // 兩者結論不同 → 證明角度檢查真的有作用。
  });
});
