import { describe, expect, it } from 'vitest';
import { computeFormationSlots, type FormationConfig } from '@/config/formationConfig';
import { stepTowardNode, advanceAnchor, splinePoint, allMembersInPlace } from '@/systems/formationMath';

/**
 * 陣型系統純函式測試（怪物 AI 第 2 塊）。含壞版對照。★交測騎擴充邊界。
 */

function base(type: FormationConfig['type'], extra: Partial<FormationConfig> = {}): FormationConfig {
  return { type, count: 6, distance: 1, facingDeg: 0, ...extra };
}

describe('computeFormationSlots — 5 種隊形座標', () => {
  it('Line: count 顆、沿 y 置中、x=0（facing 0）', () => {
    const slots = computeFormationSlots(base('Line', { count: 4, distance: 2 }));
    expect(slots).toHaveLength(4);
    for (const s of slots) expect(s.x).toBeCloseTo(0);
    // 置中：y 對稱（首末相反）。
    expect(slots[0].y).toBeCloseTo(-slots[3].y);
    // 間隔 2。
    expect(Math.abs(slots[1].y - slots[0].y)).toBeCloseTo(2);
  });

  it('Circle: count 顆均分圓周、半徑一致', () => {
    const slots = computeFormationSlots(base('Circle', { count: 8, circleRadius: 3 }));
    expect(slots).toHaveLength(8);
    for (const s of slots) expect(Math.hypot(s.x, s.y)).toBeCloseTo(3);
  });

  it('Square: rows×cols 格點、count 截斷', () => {
    const slots = computeFormationSlots(base('Square', { count: 9, rows: 3, cols: 3, distance: 1 }));
    expect(slots).toHaveLength(9);
  });

  it('Hexagonal: 中心 + 每環 6×ring', () => {
    const slots = computeFormationSlots(base('Hexagonal', { count: 7, hexRings: 1, distance: 1 }));
    // 1 環 = 中心 1 + 6 = 7。
    expect(slots).toHaveLength(7);
    // 有一個中心點 (0,0)。
    expect(slots.some((s) => Math.hypot(s.x, s.y) < 1e-6)).toBe(true);
  });

  it('Triangle: count 顆、頂點在前(+x 最大)', () => {
    const slots = computeFormationSlots(base('Triangle', { count: 6, distance: 1, triangleAngle: 60 }));
    expect(slots).toHaveLength(6);
    // 頂點(第 0 顆)x 最大（facing 0 往前）。
    const maxX = Math.max(...slots.map((s) => s.x));
    expect(slots[0].x).toBeCloseTo(maxX);
  });

  it('facingDeg 旋轉：facing 90 → Line 沿 x 排（原沿 y）', () => {
    const slots = computeFormationSlots(base('Line', { count: 3, distance: 2, facingDeg: 90 }));
    // 旋轉 90°：原 (0,y) → (-y, 0)，故 x 有差異、y≈0。
    for (const s of slots) expect(s.y).toBeCloseTo(0);
  });

  it('count 夾 2~30', () => {
    expect(computeFormationSlots(base('Line', { count: 50 }))).toHaveLength(30);
  });
});

describe('formationMath — 整隊移動', () => {
  it('stepTowardNode: 遠 → 朝節點移動、不過衝', () => {
    const next = stepTowardNode({ x: 0, y: 0 }, { x: 100, y: 0 }, 300, 0.1);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThanOrEqual(100); // 不過衝
    expect(next.y).toBeCloseTo(0);
  });
  it('stepTowardNode: <1px → 吸附節點', () => {
    const next = stepTowardNode({ x: 99.6, y: 0 }, { x: 100, y: 0 }, 300, 0.1);
    expect(next).toEqual({ x: 100, y: 0 });
  });
  it('advanceAnchor: facing 0 → 往右推進', () => {
    const a = advanceAnchor({ x: 0, y: 0 }, 0, 100, 0.5);
    expect(a.x).toBeCloseTo(50);
    expect(a.y).toBeCloseTo(0);
  });
  it('splinePoint: t=0 首點、t=1 末點', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(splinePoint(pts, 0)).toEqual({ x: 0, y: 0 });
    const end = splinePoint(pts, 1);
    expect(end.x).toBeCloseTo(10);
    expect(end.y).toBeCloseTo(10);
  });
  it('allMembersInPlace: 全員近節點→true、有一遠→false', () => {
    expect(allMembersInPlace([{ cur: { x: 0, y: 0 }, node: { x: 1, y: 0 } }], 5)).toBe(true);
    expect(allMembersInPlace([{ cur: { x: 0, y: 0 }, node: { x: 100, y: 0 } }], 5)).toBe(false);
  });
});
