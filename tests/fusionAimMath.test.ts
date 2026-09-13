import { describe, expect, it } from 'vitest';
import { angleDiff, selectFusionTarget, selectNearest, type AimCandidate } from '@/systems/fusionAimMath';

const params = { coneHalfAngleDeg: 40, itemWeight: 0.7, maxRangePx: 900 };
const origin = { x: 0, y: 0 };

describe('angleDiff', () => {
  it('同角→0', () => expect(angleDiff(1, 1)).toBeCloseTo(0));
  it('π 環繞：0 vs 2π→0', () => expect(angleDiff(0, Math.PI * 2)).toBeCloseTo(0));
  it('對向→π', () => expect(angleDiff(0, Math.PI)).toBeCloseTo(Math.PI));
});

describe('selectFusionTarget — 錐內選角度差最小', () => {
  it('錐內單一敵人→選它', () => {
    const cands: AimCandidate[] = [{ id: 1, x: 100, y: 0, isItem: false }];
    expect(selectFusionTarget(origin, 0, cands, params)).toBe(1);
  });
  it('錐外→null', () => {
    const cands: AimCandidate[] = [{ id: 1, x: 0, y: 100, isItem: false }]; // 90° 偏離、錐半角 40
    expect(selectFusionTarget(origin, 0, cands, params)).toBeNull();
  });
  it('多敵人選角度差最小', () => {
    const cands: AimCandidate[] = [
      { id: 1, x: 100, y: 50, isItem: false }, // ~26.5°
      { id: 2, x: 100, y: 5, isItem: false }, // ~2.9° ← 最小
    ];
    expect(selectFusionTarget(origin, 0, cands, params)).toBe(2);
  });
  it('道具略優先：角度差略大的道具仍可勝出（×0.7）', () => {
    const cands: AimCandidate[] = [
      { id: 1, x: 100, y: 20, isItem: false }, // 敵 ~11.3°
      { id: 2, x: 100, y: 26, isItem: true }, // 道具 ~14.6° ×0.7 = ~10.2° ← 勝
    ];
    expect(selectFusionTarget(origin, 0, cands, params)).toBe(2);
  });
  it('超出最大距離→不納入', () => {
    const cands: AimCandidate[] = [{ id: 1, x: 1000, y: 0, isItem: false }];
    expect(selectFusionTarget(origin, 0, cands, params)).toBeNull();
  });
});

describe('selectNearest — 靜止按攻擊鎖最近', () => {
  it('選最近', () => {
    const cands: AimCandidate[] = [
      { id: 1, x: 300, y: 0, isItem: false },
      { id: 2, x: 100, y: 0, isItem: false },
    ];
    expect(selectNearest(origin, cands, 900)).toBe(2);
  });
  it('全超距→null', () => {
    expect(selectNearest(origin, [{ id: 1, x: 1000, y: 0, isItem: false }], 900)).toBeNull();
  });
});
