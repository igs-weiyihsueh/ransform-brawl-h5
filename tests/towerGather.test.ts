import { describe, it, expect } from 'vitest';
import { towerGatherTargets } from '@/systems/towerIntro';

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
