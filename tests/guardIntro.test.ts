// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  guardCornerTargets,
  scriptedMoveStep,
  allScriptedArrived,
} from '@/systems/guardIntro';

/**
 * guardIntro 純函式（用戶 #4 守護波開場「導引走位」，翼騎 a6b1a65，對照 Unity RunGuardEvent）。
 * 四角定位點 / 單步移動+到位 snap / 全到位判定。零 Phaser 依賴。維度3 斷實際座標/位置/bool。
 * ⚠️ GuardEvent 相位機接線(introMove→reveal→focus→combat 時序)屬狀態機(需 boot),不補;
 *    純函式 guardCornerTargets/scriptedMoveStep/allScriptedArrived 補足。
 */
describe('guardCornerTargets — 雕像四角定位點（P1左上/P2右上/P3左下/P4右下）', () => {
  it('四角相對雕像中心方位正確（H5 座標：y 下為正）', () => {
    const [p1, p2, p3, p4] = guardCornerTargets(500, 300, 150);
    // P1 左上：x < cx（左）、y < cy（上）。
    expect(p1).toEqual({ x: 350, y: 150 });
    expect(p1.x).toBeLessThan(500);
    expect(p1.y).toBeLessThan(300);
    // P2 右上：x > cx（右）、y < cy（上）。
    expect(p2).toEqual({ x: 650, y: 150 });
    expect(p2.x).toBeGreaterThan(500);
    expect(p2.y).toBeLessThan(300);
    // P3 左下：x < cx（左）、y > cy（下）。
    expect(p3).toEqual({ x: 350, y: 450 });
    expect(p3.x).toBeLessThan(500);
    expect(p3.y).toBeGreaterThan(300);
    // P4 右下：x > cx（右）、y > cy（下）。
    expect(p4).toEqual({ x: 650, y: 450 });
    expect(p4.x).toBeGreaterThan(500);
    expect(p4.y).toBeGreaterThan(300);
  });

  it('offset 對稱：四角離中心距離皆 = offsetPx（水平/垂直各 offset）', () => {
    const c = { x: 0, y: 0 };
    const [p1, p2, p3, p4] = guardCornerTargets(c.x, c.y, 100);
    for (const p of [p1, p2, p3, p4]) {
      expect(Math.abs(p.x - c.x)).toBe(100);
      expect(Math.abs(p.y - c.y)).toBe(100);
    }
  });
});

describe('scriptedMoveStep — 單步朝目標移動 + 到位 snap', () => {
  it('一步朝目標移動 speedPx×dt、單位方向正確（未到位）', () => {
    // 從 (0,0) 朝 (100,0)，speed 100px/s、dt 0.1 → 走 10px、dir=(1,0)。
    const r = scriptedMoveStep({ x: 0, y: 0 }, { x: 100, y: 0 }, 100, 0.1);
    expect(r.arrived).toBe(false);
    expect(r.pos.x).toBeCloseTo(10);
    expect(r.pos.y).toBeCloseTo(0);
    expect(r.dir.x).toBeCloseTo(1);
    expect(r.dir.y).toBeCloseTo(0);
  });

  it('對角線：dir 為單位向量（|dir|=1）、位移 = speed×dt 沿該方向', () => {
    // 朝 (30,40)（距 50），speed 50、dt 0.1 → 走 5px，dir=(0.6,0.8)。
    const r = scriptedMoveStep({ x: 0, y: 0 }, { x: 30, y: 40 }, 50, 0.1);
    expect(r.arrived).toBe(false);
    expect(Math.hypot(r.dir.x, r.dir.y)).toBeCloseTo(1);
    expect(r.dir.x).toBeCloseTo(0.6);
    expect(r.dir.y).toBeCloseTo(0.8);
    expect(Math.hypot(r.pos.x, r.pos.y)).toBeCloseTo(5); // 位移 = 50×0.1
  });

  it('★ 快到時 snap 到位、不超衝（本步位移 ≥ 剩餘距離 → 貼齊 target、arrived=true、dir=0）', () => {
    // 剩 3px 但本步能走 10px（100×0.1）→ 直接 snap 到 target，不衝過去。
    const r = scriptedMoveStep({ x: 97, y: 0 }, { x: 100, y: 0 }, 100, 0.1);
    expect(r.arrived).toBe(true);
    expect(r.pos).toEqual({ x: 100, y: 0 }); // 貼齊、非 107（不超衝）
    expect(r.dir).toEqual({ x: 0, y: 0 });
  });

  it('已在目標（dist=0）→ arrived=true、留在 target', () => {
    const r = scriptedMoveStep({ x: 50, y: 50 }, { x: 50, y: 50 }, 100, 0.1);
    expect(r.arrived).toBe(true);
    expect(r.pos).toEqual({ x: 50, y: 50 });
  });

  it('arriveEps 內視為到位（距離 ≤ eps → snap）', () => {
    // 距 1.5px、eps 2 → 到位 snap（即使本步位移更小）。
    const r = scriptedMoveStep({ x: 98.5, y: 0 }, { x: 100, y: 0 }, 1, 0.1, 2);
    expect(r.arrived).toBe(true);
    expect(r.pos).toEqual({ x: 100, y: 0 });
  });
});

describe('allScriptedArrived — 全部到位才 true', () => {
  it('全到 → true', () => {
    expect(allScriptedArrived([true, true, true, true])).toBe(true);
    expect(allScriptedArrived([true])).toBe(true);
  });

  it('★ 一個沒到 → false（全員就定位才算完成）', () => {
    expect(allScriptedArrived([true, true, false, true])).toBe(false);
    expect(allScriptedArrived([false])).toBe(false);
  });

  it('邊界：空陣列 → false（無人=未完成，非 vacuous true）', () => {
    // every() 對空陣列回 true，但這裡需 length>0 守衛避免「無玩家=已完成」誤判。
    expect(allScriptedArrived([])).toBe(false);
  });
});
