// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveEnemyOverlap } from '@/systems/enemySeparation';

/**
 * resolveEnemyOverlap — 敵-敵 hard 解重疊（用戶八輪#4 怪互相疊在一起根治，翼騎 739fb17，additive）。
 * agents {x,y,radius,movable}[] → 回新座標 {x,y}[]（不改原輸入）；兩兩 dist<r_i+r_j 沿連線推開、迭代收斂。
 * 簽章(讀 src 739fb17)：resolveEnemyOverlap(agents, iterations=2) →
 *   radius<=0 跳過;dist>=minDist 跳過;dist<=0.0001 完全重疊 ux=1(index 定向)避免 NaN/爆量;
 *   both movable 各推一半(對稱中點守恆);一方 immovable 只推另一方全量;both immovable 不動。
 * 維度3 斷距離/座標。含壞版必紅（完全重疊爆量 / radius0 沒跳過 / immovable 被推 / 不對稱）。
 * ⚠️ EnemySpawner de-overlap pass + Enemy.isSeparationMovable + moveTo 接線屬狀態機(需 boot,翼騎 headless 驗 5 隻疊同點解開)——不補;resolveEnemyOverlap 純函式補足。
 */
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('resolveEnemyOverlap — 敵-敵 hard 解重疊', () => {
  it('★ 都 movable 重疊 → 推開到 dist≥r_i+r_j 且對稱（中點守恆）', () => {
    // r30+r30 minDist60；初始 dist20(0,0)/(20,0) → 推開 ≥60。
    const r = resolveEnemyOverlap([
      { x: 0, y: 0, radius: 30, movable: true },
      { x: 20, y: 0, radius: 30, movable: true },
    ]);
    expect(dist(r[0], r[1])).toBeGreaterThanOrEqual(60 - 1e-6); // 推開到 ≥minDist
    expect(r[0].x + r[1].x).toBeCloseTo(0 + 20); // 中點守恆(x 和不變)
    expect(r[0].y + r[1].y).toBeCloseTo(0); // y 和守恆
    expect(r[0].x).toBeLessThan(0); // i 往左退
    expect(r[1].x).toBeGreaterThan(20); // j 往右退
  });

  it('不改原輸入（回新陣列）', () => {
    const agents = [
      { x: 0, y: 0, radius: 30, movable: true },
      { x: 20, y: 0, radius: 30, movable: true },
    ];
    resolveEnemyOverlap(agents);
    expect(agents[0]).toEqual({ x: 0, y: 0, radius: 30, movable: true }); // 原輸入不變
  });

  it('★ 一方 immovable → 該方不動、只推另一方全量', () => {
    // j immovable → j 原位、i 退到 dist≥60。
    const r = resolveEnemyOverlap([
      { x: 0, y: 0, radius: 30, movable: true },
      { x: 20, y: 0, radius: 30, movable: false },
    ]);
    expect(r[1]).toEqual({ x: 20, y: 0 }); // j(immovable) 原位不動
    expect(dist(r[0], r[1])).toBeGreaterThanOrEqual(60 - 1e-6); // i 全量退到不重疊
    expect(r[0].x).toBeLessThan(0);
  });

  it('兩者都 immovable → 都不動', () => {
    const r = resolveEnemyOverlap([
      { x: 0, y: 0, radius: 30, movable: false },
      { x: 20, y: 0, radius: 30, movable: false },
    ]);
    expect(r[0]).toEqual({ x: 0, y: 0 });
    expect(r[1]).toEqual({ x: 20, y: 0 });
  });

  it('不重疊（dist≥minDist）→ 原位不動', () => {
    const r = resolveEnemyOverlap([
      { x: 0, y: 0, radius: 30, movable: true },
      { x: 100, y: 0, radius: 30, movable: true }, // dist100 ≥ 60
    ]);
    expect(r[0]).toEqual({ x: 0, y: 0 });
    expect(r[1]).toEqual({ x: 100, y: 0 });
  });

  it('★ 完全重疊（dist≈0）→ 不 NaN、不爆量（index 定向推到 ≈minDist）', () => {
    const r = resolveEnemyOverlap([
      { x: 50, y: 50, radius: 30, movable: true },
      { x: 50, y: 50, radius: 30, movable: true }, // 同點
    ]);
    expect(Number.isFinite(r[0].x)).toBe(true); // 非 NaN
    expect(Number.isFinite(r[1].x)).toBe(true);
    const d = dist(r[0], r[1]);
    expect(d).toBeCloseTo(60, 0); // 推到剛好 minDist(非 599999 爆量)
    expect(d).toBeLessThan(1000); // 不爆量
  });

  it('★ radius<=0（grabber/dead 標記）→ 該 pair 跳過（不參與，即使幾何重疊）', () => {
    const r = resolveEnemyOverlap([
      { x: 0, y: 0, radius: 0, movable: true }, // radius 0
      { x: 5, y: 0, radius: 30, movable: true },
    ]);
    expect(r[0]).toEqual({ x: 0, y: 0 }); // 跳過,不動
    expect(r[1]).toEqual({ x: 5, y: 0 });
  });

  it('iterations 收斂：3 隻連鎖重疊,2 次迭代後兩兩不重疊', () => {
    const r = resolveEnemyOverlap([
      { x: 0, y: 0, radius: 30, movable: true },
      { x: 20, y: 0, radius: 30, movable: true },
      { x: 40, y: 0, radius: 30, movable: true },
    ], 2);
    // 收斂後相鄰對距離接近/達 minDist（迭代解開）。
    expect(dist(r[0], r[1])).toBeGreaterThan(40); // 明顯推開(2次迭代已大幅解重疊)
    expect(dist(r[1], r[2])).toBeGreaterThan(40);
  });
});
