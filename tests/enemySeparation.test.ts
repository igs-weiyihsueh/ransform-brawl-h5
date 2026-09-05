import { describe, expect, it } from 'vitest';
import {
  SEPARATION_RADIUS_PX,
  calculateSeparation,
  combineWithSeparation,
  pushOutOfPlayer,
} from '@/systems/enemySeparation';

/**
 * 敵我碰撞（分離力 + 防穿透）純向量測試（backlog 21976cd3）。
 * 含壞版必紅：平方加權（越近越大）、超半徑=0、防穿透推到邊緣。
 */
describe('calculateSeparation — 分離力', () => {
  it('無鄰居 → 零向量', () => {
    const s = calculateSeparation({ x: 0, y: 0 }, []);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
  });

  it('鄰居超出 separationRadius → 不計（0）', () => {
    const far = { x: SEPARATION_RADIUS_PX + 10, y: 0 };
    const s = calculateSeparation({ x: 0, y: 0 }, [far]);
    expect(s.x).toBe(0);
    expect(s.y).toBe(0);
  });

  it('鄰居在右 → 分離力往左（遠離）', () => {
    const s = calculateSeparation({ x: 0, y: 0 }, [{ x: 20, y: 0 }]);
    expect(s.x).toBeLessThan(0); // 往左推
    expect(s.y).toBeCloseTo(0);
  });

  it('平方加權：越近推力越大，且比值符合平方（非線性）', () => {
    const r = SEPARATION_RADIUS_PX;
    const dNear = 10;
    const dMid = 40;
    const near = calculateSeparation({ x: 0, y: 0 }, [{ x: dNear, y: 0 }]);
    const mid = calculateSeparation({ x: 0, y: 0 }, [{ x: dMid, y: 0 }]);
    expect(Math.abs(near.x)).toBeGreaterThan(Math.abs(mid.x));
    // 實際比值 = (tNear/tMid)^2（平方加權）；線性版會是 tNear/tMid → 用此釘死平方。
    const tNear = (r - dNear) / r;
    const tMid = (r - dMid) / r;
    const actualRatio = Math.abs(near.x) / Math.abs(mid.x);
    expect(actualRatio).toBeCloseTo((tNear * tNear) / (tMid * tMid), 2); // 平方比
    expect(actualRatio).not.toBeCloseTo(tNear / tMid, 2); // 非線性比
  });

  it('多鄰居疊加（兩側 → 抵銷、單側 → 加強）', () => {
    const both = calculateSeparation({ x: 0, y: 0 }, [
      { x: 20, y: 0 },
      { x: -20, y: 0 },
    ]);
    expect(both.x).toBeCloseTo(0); // 左右抵銷
    const same = calculateSeparation({ x: 0, y: 0 }, [
      { x: 20, y: 0 },
      { x: 25, y: 0 },
    ]);
    expect(same.x).toBeLessThan(0); // 同側加強往左
  });

  // 🔴 壞版對照：若用線性 t（非 t*t），近距推力比會不同。
  it('壞版對照：平方加權 near/mid 比 ≠ 線性比', () => {
    const r = SEPARATION_RADIUS_PX;
    const dNear = 10;
    const dMid = 40;
    const tNear = (r - dNear) / r;
    const tMid = (r - dMid) / r;
    const sqRatio = (tNear * tNear) / (tMid * tMid);
    const linRatio = tNear / tMid;
    expect(sqRatio).not.toBeCloseTo(linRatio); // 平方 vs 線性 不同
    expect(sqRatio).toBeGreaterThan(linRatio); // 平方讓近距更爆
  });
});

describe('combineWithSeparation — 追擊疊加', () => {
  it('無分離力 → 純朝目標方向（正規化）', () => {
    const d = combineWithSeparation({ x: 10, y: 0 }, { x: 0, y: 0 });
    expect(d.x).toBeCloseTo(1);
    expect(d.y).toBeCloseTo(0);
  });

  it('分離力偏移最終方向', () => {
    const d = combineWithSeparation({ x: 1, y: 0 }, { x: 0, y: 1 }, 0.8);
    expect(d.y).toBeGreaterThan(0); // 被往上帶
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1); // 正規化
  });
});

describe('pushOutOfPlayer — 防穿透', () => {
  it('未穿透（dist>=minDist）→ 原位', () => {
    const p = pushOutOfPlayer({ x: 100, y: 0 }, { x: 0, y: 0 }, 50);
    expect(p).toEqual({ x: 100, y: 0 });
  });

  it('穿透（dist<minDist）→ 推到 minDist 邊緣、方向不變', () => {
    const fixed = pushOutOfPlayer({ x: 20, y: 0 }, { x: 0, y: 0 }, 50);
    expect(Math.hypot(fixed.x, fixed.y)).toBeCloseTo(50); // 邊緣
    expect(fixed.y).toBeCloseTo(0); // 同方向（右）
    expect(fixed.x).toBeCloseTo(50);
  });

  it('完全重疊（dist≈0）→ 往右推到邊緣（不 NaN）', () => {
    const fixed = pushOutOfPlayer({ x: 0, y: 0 }, { x: 0, y: 0 }, 50);
    expect(fixed.x).toBe(50);
    expect(fixed.y).toBe(0);
  });
});
