// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { guideArrowAnchor, GUIDE_ARROW } from '@/systems/itemGuideMath';

/**
 * guideArrowAnchor — 道具指引箭頭錨點（用戶六輪#9，翼騎 50da58e）。
 * 真因：箭頭原錨身體中心+outPx 過頭→浮身體上方離搜索圈遠+跟角色糊。
 * 修：錨改搜索圈中心 + 抽 guideArrowAnchor 算箭頭落搜索圈邊緣外側、指向道具那側。
 * 簽章(讀 src 50da58e)：guideArrowAnchor(vacuumCenter:Vec2, vacuumRadius, angle, marginPx=GUIDE_ARROW.edgeMarginPx) → Vec2
 *   = vacuumCenter + (cos angle, sin angle) × (vacuumRadius + marginPx)。
 * 維度3 斷錨點座標（距離=radius+margin、方向沿 angle）。含壞版必紅（沒加 radius / angle 方向 / 沒加 margin）。
 * ⚠️ drawGuideArrows 用 getVacuumCenter/角度接線 + 三角形繪製屬狀態機(需 boot,翼騎 subagent 看圖驗箭頭落圈邊清晰)
 *    ——不補;guideArrowAnchor 純函式補足。
 */
const C = { x: 1000, y: 500 };
const R = 50;
const M = 28; // = GUIDE_ARROW.edgeMarginPx

describe('guideArrowAnchor — 落搜索圈邊緣外側、方向沿 angle', () => {
  it('常數：GUIDE_ARROW.edgeMarginPx = 28（預設 margin，非寫死）', () => {
    expect(GUIDE_ARROW.edgeMarginPx).toBe(28);
  });

  it('★ 距 vacuumCenter = vacuumRadius + marginPx（落圈邊外，不浮身體/圈心）', () => {
    const p = guideArrowAnchor(C, R, 0, M);
    expect(Math.hypot(p.x - C.x, p.y - C.y)).toBeCloseTo(R + M); // 78
    // 各角度距離皆 = radius+margin。
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4]) {
      const q = guideArrowAnchor(C, R, a, M);
      expect(Math.hypot(q.x - C.x, q.y - C.y)).toBeCloseTo(R + M);
    }
  });

  it('★ 方向沿 angle：0→右(+x)、π/2→下(+y,H5)、π→左(-x)、-π/2→上(-y)', () => {
    const r = R + M;
    const right = guideArrowAnchor(C, R, 0, M);
    expect(right.x).toBeCloseTo(C.x + r);
    expect(right.y).toBeCloseTo(C.y);
    const down = guideArrowAnchor(C, R, Math.PI / 2, M);
    expect(down.x).toBeCloseTo(C.x);
    expect(down.y).toBeCloseTo(C.y + r); // +y = 下
    const left = guideArrowAnchor(C, R, Math.PI, M);
    expect(left.x).toBeCloseTo(C.x - r);
    expect(left.y).toBeCloseTo(C.y);
    const up = guideArrowAnchor(C, R, -Math.PI / 2, M);
    expect(up.x).toBeCloseTo(C.x);
    expect(up.y).toBeCloseTo(C.y - r); // -y = 上
  });

  it('對角線 angle=π/4 → 右下 45°（cos/sin 各分量）', () => {
    const r = R + M;
    const p = guideArrowAnchor(C, R, Math.PI / 4, M);
    expect(p.x).toBeCloseTo(C.x + r * Math.SQRT1_2);
    expect(p.y).toBeCloseTo(C.y + r * Math.SQRT1_2);
  });

  it('marginPx 預設 = GUIDE_ARROW.edgeMarginPx（不傳 margin 時）', () => {
    const p = guideArrowAnchor(C, R, 0); // 用預設
    expect(Math.hypot(p.x - C.x, p.y - C.y)).toBeCloseTo(R + GUIDE_ARROW.edgeMarginPx);
  });

  it('自訂 margin 生效（margin=100 → 距離 radius+100）', () => {
    const p = guideArrowAnchor(C, R, 0, 100);
    expect(Math.hypot(p.x - C.x, p.y - C.y)).toBeCloseTo(R + 100);
  });
});
