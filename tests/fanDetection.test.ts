import { describe, expect, it } from 'vitest';
import type { AttackData } from '@/systems/AttackData';
import { buildAttackFan, fanIntersectsCircle, type Vec2 } from '@/systems/hitDetection';

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

// ===========================================================================
// 深度強化（QA 測騎接手）：離軸邊界 + 非對稱方向 + on-radius + 退化。
//
// 顧問要求用「非對稱輸入」原理（決策 dfb08b5e）：扇形對【垂直軸(上下)】天生對稱
// （角度只由 dx/dist 決定，dy 的正負不影響 theta）——所以上下翻號【抓不到】、也【不該抓】
// （那是正確行為）。真正有鑑別力的是【前後/左右】方向：facing 決定扇形朝哪半邊。
// 因此離軸 case 一律用「前方命中 vs 同幅度但落到後方 → 不中」的非對稱對照，
// 專抓「拿掉 facing / 用 |dx| 讓扇形變雙向 / 角度邊界 <= 改 < / 半徑 <= 改 <」這些細改。
// ===========================================================================

/** 直接建一個面右(facing=+1)、可控半張角的扇形，中心在原點，方便下 on-boundary 座標。 */
function fanRight(radiusPx: number, halfAngleDeg: number, facing = 1): {
  center: Vec2;
  radius: number;
  facing: number;
  halfAngleRad: number;
} {
  return {
    center: { x: 0, y: 0 },
    radius: radiusPx,
    facing,
    halfAngleRad: (halfAngleDeg * Math.PI) / 180,
  };
}

describe('fanIntersectsCircle — 離軸角度邊界（釘住 theta <= halfAngle 的 <=）', () => {
  // 半張角取非整數 50°，半徑 200，目標半徑 0（純點，隔離角度判定）。
  const fan = fanRight(200, 50);
  const d = 100; // 距離 < 半徑，隔離角度因素

  it('剛好在 50° 邊界上 → 命中（on-boundary，含邊界）', () => {
    // 方向 (cos50, sin50)。theta 精確 = 50° = halfAngle → <= 命中。
    const a = (50 * Math.PI) / 180;
    expect(fanIntersectsCircle(fan, { x: d * Math.cos(a), y: d * Math.sin(a) }, 0)).toBe(true);
  });

  it('50° 邊界外一點點 (50°+ε) → 不中', () => {
    const a = (50.05 * Math.PI) / 180;
    expect(fanIntersectsCircle(fan, { x: d * Math.cos(a), y: d * Math.sin(a) }, 0)).toBe(false);
  });

  it('50° 邊界內一點點 (50°−ε) → 命中', () => {
    const a = (49.95 * Math.PI) / 180;
    expect(fanIntersectsCircle(fan, { x: d * Math.cos(a), y: d * Math.sin(a) }, 0)).toBe(true);
  });

  it('下方 −50° 邊界（垂直對稱，正確行為）→ 命中', () => {
    // 扇形對上下對稱：−50° 與 +50° 同 theta → 同樣命中。這是正確設計，非 bug。
    const a = (-50 * Math.PI) / 180;
    expect(fanIntersectsCircle(fan, { x: d * Math.cos(a), y: d * Math.sin(a) }, 0)).toBe(true);
  });
});

describe('fanIntersectsCircle — 前後方向非對稱（專抓拿掉 facing / 變雙向）', () => {
  // 窄扇 halfAngle=30°，面右。用「前方 +θ 命中」對「後方鏡射同角度 不中」形成非對稱對照。
  const fanR = fanRight(200, 30, 1);
  const d = 100;

  it('前方 +20°（面右）→ 命中', () => {
    const a = (20 * Math.PI) / 180;
    expect(fanIntersectsCircle(fanR, { x: d * Math.cos(a), y: d * Math.sin(a) }, 0)).toBe(true);
  });

  it('正後方 180−20°（面右時的左後）→ 不中（前後非對稱）', () => {
    // 方向 (cos160, sin160)：dx<0。正確版 theta≈160°>30 → 不中。
    // 若把角度改用 |dx|（扇形變雙向），這顆會誤中 → 此條在該壞版變紅。
    const a = (160 * Math.PI) / 180;
    expect(fanIntersectsCircle(fanR, { x: d * Math.cos(a), y: d * Math.sin(a) }, 0)).toBe(false);
  });

  it('正後方 −160°（左後下）→ 不中（後方整片皆不中）', () => {
    const a = (-160 * Math.PI) / 180;
    expect(fanIntersectsCircle(fanR, { x: d * Math.cos(a), y: d * Math.sin(a) }, 0)).toBe(false);
  });

  it('面左(facing=-1)時：左前方命中、右前方不中（facing 真的決定朝向）', () => {
    const fanL = fanRight(200, 30, -1);
    // 面左 forward=(-1,0)。左前 (cos160, sin20?) → 取 dx<0 小離軸：方向 160°，dx<0，
    // 與 forward(-1,0) 夾角 = 20° <=30 → 命中。
    const aLeft = (160 * Math.PI) / 180;
    expect(fanIntersectsCircle(fanL, { x: d * Math.cos(aLeft), y: d * Math.sin(aLeft) }, 0)).toBe(true);
    // 右前 20°：與 forward(-1,0) 夾角 160°>30 → 不中。
    const aRight = (20 * Math.PI) / 180;
    expect(fanIntersectsCircle(fanL, { x: d * Math.cos(aRight), y: d * Math.sin(aRight) }, 0)).toBe(false);
  });
});

describe('fanIntersectsCircle — on-radius 半徑邊界（釘住 dist <= radius+r 的 <=）', () => {
  const fan = fanRight(200, 90); // 半張角 90°（前半平面），隔離角度只測半徑
  const rTarget = 30;

  it('正前方 dist == radius + 目標半徑 → 命中（on-radius，含邊界）', () => {
    // 放在正前方 x = 200+30 = 230，dist=230=radius+r → 命中
    expect(fanIntersectsCircle(fan, { x: 230, y: 0 }, rTarget)).toBe(true);
  });

  it('正前方 dist 比 radius+r 多一點點 → 不中', () => {
    expect(fanIntersectsCircle(fan, { x: 230.01, y: 0 }, rTarget)).toBe(false);
  });

  it('幾乎同點(dist<=1e-6) → 命中（貼臉必中）', () => {
    expect(fanIntersectsCircle(fan, { x: 0, y: 0 }, 0)).toBe(true);
  });
});

describe('fanIntersectsCircle — 退化角度', () => {
  it('angle=0（halfAngle=0）：只有正前方向量(theta=0)命中，稍微離軸就不中', () => {
    const fan = fanRight(200, 0);
    expect(fanIntersectsCircle(fan, { x: 100, y: 0 }, 0)).toBe(true); // 正前 theta=0
    expect(fanIntersectsCircle(fan, { x: 100, y: 1 }, 0)).toBe(false); // 極小離軸 → 不中
  });

  it('angle=360（halfAngle=180）：半徑內任何方向皆命中（含正後方）', () => {
    const fan = fanRight(200, 180);
    expect(fanIntersectsCircle(fan, { x: -100, y: 0 }, 0)).toBe(true); // 正後也中
    expect(fanIntersectsCircle(fan, { x: 0, y: -100 }, 0)).toBe(true); // 正下也中
    expect(fanIntersectsCircle(fan, { x: -300, y: 0 }, 0)).toBe(false); // 但仍受半徑限制
  });
});
