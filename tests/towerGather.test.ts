import { describe, it, expect } from 'vitest';
import { towerGatherTargets, towerSpotlightTarget } from '@/systems/towerIntro';

describe('towerGatherTargets — 塔波開場玩家聚集中央', () => {
  it('單人 → 站正中心（忽略 offset）', () => {
    const t = towerGatherTargets(960, 540, 1, 120);
    expect(t).toHaveLength(1);
    expect(t[0]).toEqual({ x: 960, y: 540 });
  });

  it('多人 → 均勻排在中心周圍一圈、離中心 = gatherOffsetPx', () => {
    const cx = 960;
    const cy = 540;
    const r = 120;
    const t = towerGatherTargets(cx, cy, 4, r);
    expect(t).toHaveLength(4);
    for (const p of t) {
      const dist = Math.hypot(p.x - cx, p.y - cy);
      expect(dist).toBeCloseTo(r, 5); // 每人離中心恰 r（聚攏一圈）
    }
    // 第一名朝正上方（-90°）
    expect(t[0].x).toBeCloseTo(cx, 5);
    expect(t[0].y).toBeCloseTo(cy - r, 5);
  });

  it('聚攏：offset 越小玩家越靠近中心', () => {
    const near = towerGatherTargets(0, 0, 3, 40);
    const far = towerGatherTargets(0, 0, 3, 200);
    const dNear = Math.hypot(near[1].x, near[1].y);
    const dFar = Math.hypot(far[1].x, far[1].y);
    expect(dNear).toBeLessThan(dFar);
  });

  it('count 下限保護：<=0 視為 1（站中心）', () => {
    const t = towerGatherTargets(100, 200, 0, 120);
    expect(t).toHaveLength(1);
    expect(t[0]).toEqual({ x: 100, y: 200 });
  });
});

describe('towerSpotlightTarget — Bug2 聚焦聚光燈打在塔上（包圍盒中心+框整組半徑）', () => {
  it('單塔 → 中心＝該塔位、半徑＝max(邊距, minRadius)', () => {
    const { center, radiusPx } = towerSpotlightTarget([{ x: 700, y: 400 }], 200, 120);
    expect(center).toEqual({ x: 700, y: 400 }); // 單塔半對角線=0
    expect(radiusPx).toBe(200); // max(0+120, 200)=200
  });

  it('多塔 → 中心＝包圍盒中心（非玩家聚集點）', () => {
    const { center } = towerSpotlightTarget([{ x: 700, y: 400 }, { x: 1220, y: 400 }], 200);
    expect(center).toEqual({ x: 960, y: 400 }); // (700+1220)/2, (400+400)/2
  });

  it('半徑框住整組塔：半對角線+邊距 ≥ minRadius 時用前者', () => {
    // 兩塔相距 1000（水平）→ 半對角線 500，+邊距 120 = 620 > minRadius 200 → 620
    const { radiusPx } = towerSpotlightTarget([{ x: 0, y: 0 }, { x: 1000, y: 0 }], 200, 120);
    expect(radiusPx).toBe(620);
  });

  it('塔很密時不小於 preset minRadius（下限保護）', () => {
    // 兩塔相距 100 → 半對角線 50 +邊距 120 = 170 < minRadius 300 → 用 300
    const { radiusPx } = towerSpotlightTarget([{ x: 0, y: 0 }, { x: 100, y: 0 }], 300, 120);
    expect(radiusPx).toBe(300);
  });

  it('空塔陣 → 保底不炸（原點 + minRadius）', () => {
    const { center, radiusPx } = towerSpotlightTarget([], 200);
    expect(center).toEqual({ x: 0, y: 0 });
    expect(radiusPx).toBe(200);
  });
});
