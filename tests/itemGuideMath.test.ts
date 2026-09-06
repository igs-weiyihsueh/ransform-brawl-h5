// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  guideArrowAngle,
  shouldHideArrow,
  nextGuideTarget,
  tetherEndPoint,
  GUIDE_ARROW,
} from '@/systems/itemGuideMath';

/**
 * itemGuideMath 純函式（用戶 #7 道具三視覺，翼騎 be86624，搬 Unity guideArrow/TetherLine）。
 * 箭頭朝向 / 距離隱藏 / FIFO 排隊 / 牽引線停真空圈邊緣。維度3 斷實際角度/bool/座標。含壞版必紅。
 * ⚠️ TransformSystem drawTethers/drawGuideArrows 每幀繪製屬狀態機+純視覺(需 boot)、owner round-robin 分配屬 spawn 接線——不補;
 *    itemGuideMath 四個純函式補足。H5 座標 y 下為正。
 */
describe('guideArrowAngle — 從 owner 指向道具（atan2）', () => {
  it('道具在右 → 0；在左 → ±π；下 → +π/2；上 → -π/2（H5 y 下為正）', () => {
    const o = { x: 0, y: 0 };
    expect(guideArrowAngle(o, { x: 10, y: 0 })).toBeCloseTo(0); // 右
    expect(Math.abs(guideArrowAngle(o, { x: -10, y: 0 }))).toBeCloseTo(Math.PI); // 左 = ±π
    expect(guideArrowAngle(o, { x: 0, y: 10 })).toBeCloseTo(Math.PI / 2); // 下（y+）
    expect(guideArrowAngle(o, { x: 0, y: -10 })).toBeCloseTo(-Math.PI / 2); // 上（y-）
  });

  it('對角線：右下 45° = +π/4、右上 = -π/4（指向道具方向）', () => {
    const o = { x: 5, y: 5 };
    expect(guideArrowAngle(o, { x: 15, y: 15 })).toBeCloseTo(Math.PI / 4); // 右下
    expect(guideArrowAngle(o, { x: 15, y: -5 })).toBeCloseTo(-Math.PI / 4); // 右上
  });
});

describe('shouldHideArrow — owner 靠近道具則隱藏（dist < hideDistance）', () => {
  it('dist < 1.5 → true（隱藏）、dist ≥ 1.5 → false（顯示）', () => {
    expect(shouldHideArrow(1.0)).toBe(true); // 近 → 隱藏
    expect(shouldHideArrow(2.0)).toBe(false); // 遠 → 顯示
    expect(shouldHideArrow(0)).toBe(true);
  });

  it('★ 邊界：dist 恰 1.5 → false（顯示，嚴格 <、非 ≤）', () => {
    expect(shouldHideArrow(1.5)).toBe(false); // 恰門檻不隱藏
    expect(shouldHideArrow(1.4999)).toBe(true); // 略內 → 隱藏
    // 預設門檻 = GUIDE_ARROW.hideDistanceUnits。
    expect(GUIDE_ARROW.hideDistanceUnits).toBe(1.5);
  });

  it('自訂 hideDistance 覆蓋預設', () => {
    expect(shouldHideArrow(2.5, 3)).toBe(true); // 2.5 < 3
    expect(shouldHideArrow(3, 3)).toBe(false);
  });
});

describe('nextGuideTarget — FIFO 一次一個（先掉先指、跳過已撿）', () => {
  const never = () => false;
  it('回佇列第一個未撿的（先掉落的先指）', () => {
    expect(nextGuideTarget([10, 20, 30], never)).toBe(10); // 先掉先指
  });

  it('★ FIFO：第一個已撿 → 指下一個（順序不亂跳）', () => {
    const picked = new Set([10]);
    expect(nextGuideTarget([10, 20, 30], (id) => picked.has(id))).toBe(20); // 10 撿了 → 20
    const picked2 = new Set([10, 20]);
    expect(nextGuideTarget([10, 20, 30], (id) => picked2.has(id))).toBe(30);
  });

  it('空佇列 / 全撿 → null（安全）', () => {
    expect(nextGuideTarget([], never)).toBeNull();
    expect(nextGuideTarget([10, 20], () => true)).toBeNull(); // 全撿
  });
});

describe('tetherEndPoint — 牽引線終點停真空圈邊緣（靠 anchor 側）', () => {
  it('終點在圓緣（離圓心 = radius）且朝 anchor 方向', () => {
    // anchor 在圓心右方 100，radius 30 → 終點 = 圓心 +(1,0)×30。
    const end = tetherEndPoint({ x: 100, y: 0 }, { x: 0, y: 0 }, 30);
    expect(end).toEqual({ x: 30, y: 0 });
    expect(Math.hypot(end.x - 0, end.y - 0)).toBeCloseTo(30); // 在圓緣
  });

  it('對角線 anchor：終點仍在圓緣、方向為單位(anchor-center)', () => {
    // anchor (30,40) 距圓心 50，radius 10 → 終點 = (0.6,0.8)×10 = (6,8)。
    const end = tetherEndPoint({ x: 30, y: 40 }, { x: 0, y: 0 }, 10);
    expect(end.x).toBeCloseTo(6);
    expect(end.y).toBeCloseTo(8);
    expect(Math.hypot(end.x, end.y)).toBeCloseTo(10); // 圓緣
  });

  it('anchor 在圈內（dist ≤ radius）或重合 → 回圓心（不外推）', () => {
    expect(tetherEndPoint({ x: 5, y: 0 }, { x: 0, y: 0 }, 30)).toEqual({ x: 0, y: 0 }); // 5<30
    expect(tetherEndPoint({ x: 0, y: 0 }, { x: 0, y: 0 }, 30)).toEqual({ x: 0, y: 0 }); // 重合
  });

  // 🔴 壞版對照：終點必須停圓緣（不到圓心、不超出到 anchor）。
  it('★ 壞版對照：anchor 遠時終點離圓心 = radius（非 0、非到 anchor）', () => {
    const c = { x: 100, y: 100 };
    const end = tetherEndPoint({ x: 400, y: 100 }, c, 50);
    expect(Math.hypot(end.x - c.x, end.y - c.y)).toBeCloseTo(50); // 恰圓緣
    expect(end).toEqual({ x: 150, y: 100 }); // 圓心 +50 朝 anchor，非 400
  });
});
