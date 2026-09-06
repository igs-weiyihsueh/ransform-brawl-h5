// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { guardSideSpawnPoint, GUARD_SIDE_SPAWN_INSET_PX } from '@/config/guardConfig';

/**
 * guardSideSpawnPoint — 守護波怪從左右兩側交替生成（用戶三輪#9，翼騎 d806e0e）。
 * 原繞雕像環帶隨機 → 改左右緣內縮交替。純函式抽出便於斷實際座標。
 * 簽章(讀 src d806e0e)：guardSideSpawnPoint(nextLeft, bounds{minX,maxX,minY,maxY}, insetPx=200, marginPx=60, rng=Math.random) → {x,y}。
 * 邏輯：rawX = nextLeft? minX+inset : maxX-inset；x = clamp(rawX,minX,maxX)；
 *      yMin=min(minY+margin,maxY)；yMax=max(maxY-margin,yMin)；y=yMin+rng()*(yMax-yMin)。
 * 維度3 斷 x/y 實際座標值（用可控 rng）。含壞版必紅（左右交替 edgeX / Y margin / clamp）。
 * ⚠️ GuardEvent guardSpawnNextLeft 翻 flag + spawnAroundTarget 改用它屬狀態機接線(需 boot,翼騎量化 enemyXs=[360,1560...]交替驗過)——不補;此純函式補足。
 */
const B = { minX: 0, maxX: 1920, minY: 0, maxY: 1080 }; // margin60 → yMin60 yMax1020
const r = (v: number) => () => v; // 固定 rng

describe('guardSideSpawnPoint — 左右緣交替內縮生成', () => {
  it('常數：insetPx 預設 = 200（2 unit × PPU100）', () => {
    expect(GUARD_SIDE_SPAWN_INSET_PX).toBe(200);
  });

  it('★ nextLeft=true → x = minX + inset（左緣內縮 = 200）', () => {
    expect(guardSideSpawnPoint(true, B, 200, 60, r(0)).x).toBe(200);
  });

  it('★ nextLeft=false → x = maxX − inset（右緣內縮 = 1720）', () => {
    expect(guardSideSpawnPoint(false, B, 200, 60, r(0)).x).toBe(1720);
  });

  it('★ 交替：左右 x 不同（左 200 ≠ 右 1720，兩側分開）', () => {
    const left = guardSideSpawnPoint(true, B, 200, 60, r(0.5)).x;
    const right = guardSideSpawnPoint(false, B, 200, 60, r(0.5)).x;
    expect(left).toBe(200);
    expect(right).toBe(1720);
    expect(left).not.toBe(right);
  });

  it('Y 在 [minY+margin, maxY−margin]：rng=0→60、rng=1→1020、rng=0.5→540', () => {
    expect(guardSideSpawnPoint(true, B, 200, 60, r(0)).y).toBe(60); // yMin
    expect(guardSideSpawnPoint(true, B, 200, 60, r(1)).y).toBe(1020); // yMax
    expect(guardSideSpawnPoint(true, B, 200, 60, r(0.5)).y).toBe(540); // 中間
  });

  it('★ Y 有套 margin（rng=0 不是 minY=0 而是 minY+margin=60；rng=1 不是 maxY=1080 而是 1020）', () => {
    expect(guardSideSpawnPoint(true, B, 200, 60, r(0)).y).not.toBe(0);
    expect(guardSideSpawnPoint(true, B, 200, 60, r(1)).y).not.toBe(1080);
    // 自訂 margin=100 → yMin100 yMax980。
    expect(guardSideSpawnPoint(true, B, 200, 100, r(0)).y).toBe(100);
    expect(guardSideSpawnPoint(true, B, 200, 100, r(1)).y).toBe(980);
  });

  it('★ clamp 界內：inset 過大也不超出 bounds（左緣 clamp≥minX、右緣 clamp≤maxX）', () => {
    // inset 5000 > 場寬 → 左 rawX=5000 clamp 到 maxX；右 rawX=-3080 clamp 到 minX。
    const left = guardSideSpawnPoint(true, B, 5000, 60, r(0)).x;
    const right = guardSideSpawnPoint(false, B, 5000, 60, r(0)).x;
    expect(left).toBeGreaterThanOrEqual(B.minX);
    expect(left).toBeLessThanOrEqual(B.maxX);
    expect(right).toBeGreaterThanOrEqual(B.minX);
    expect(right).toBeLessThanOrEqual(B.maxX);
    expect(left).toBe(1920); // minX+5000 clamp→maxX
    expect(right).toBe(0); // maxX-5000 clamp→minX
  });

  it('非零原點 bounds：left=minX+inset、right=maxX−inset（相對邊緣非絕對座標）', () => {
    const b2 = { minX: 500, maxX: 2500, minY: 200, maxY: 800 };
    expect(guardSideSpawnPoint(true, b2, 200, 60, r(0)).x).toBe(700); // 500+200
    expect(guardSideSpawnPoint(false, b2, 200, 60, r(0)).x).toBe(2300); // 2500-200
    expect(guardSideSpawnPoint(true, b2, 200, 60, r(0)).y).toBe(260); // 200+60
  });
});
