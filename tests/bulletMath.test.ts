import { describe, expect, it } from 'vitest';
import { spreadDirections, trackTurn, isBulletExpired, normalize } from '@/systems/bulletMath';

/**
 * bulletMath 純函式測試（技能三層彈道）。含壞版必紅對照。
 * ★交測騎擴充（追蹤轉向邊界/曲線/多顆展開更多 case）；此為地基煙霧測。
 */

describe('spreadDirections — 扇形展開', () => {
  it('單顆(count=1) → 就是 aim 方向（不展開）', () => {
    const dirs = spreadDirections({ x: 1, y: 0 }, 1, 60);
    expect(dirs).toHaveLength(1);
    expect(dirs[0].x).toBeCloseTo(1);
    expect(dirs[0].y).toBeCloseTo(0);
  });

  it('spreadDeg=0 → 多顆全同向', () => {
    const dirs = spreadDirections({ x: 0, y: 1 }, 3, 0);
    expect(dirs).toHaveLength(3);
    for (const d of dirs) {
      expect(d.x).toBeCloseTo(0);
      expect(d.y).toBeCloseTo(1);
    }
  });

  it('3 顆 90° 展開 → 對稱分佈（中間=aim，兩側±45°）', () => {
    const dirs = spreadDirections({ x: 1, y: 0 }, 3, 90);
    // 中間顆＝aim(1,0)。
    expect(dirs[1].x).toBeCloseTo(1);
    expect(dirs[1].y).toBeCloseTo(0);
    // 兩側對稱：y 一正一負、|y| 相等。
    expect(dirs[0].y).toBeCloseTo(-dirs[2].y);
    expect(Math.abs(dirs[0].y)).toBeCloseTo(Math.sin(Math.PI / 4));
  });
});

describe('trackTurn — 追蹤轉向', () => {
  it('目標在範圍內 → 朝目標轉（受 rotationSpeed clamp）', () => {
    // 現朝右(1,0)，目標在正上方 → 應往上轉一點（y 分量變負，但受 clamp 不會一次轉滿）。
    const nd = trackTurn({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: -100 }, 90, 20, 0.1, 100);
    // 90°/s × 0.1s = 9° 轉向 → 仍偏右但略朝上。
    expect(nd.y).toBeLessThan(0);
    expect(nd.x).toBeGreaterThan(0);
  });

  it('目標超出 trackingRange → 不追（方向不變）', () => {
    // trackingRange 1 unit=100px；目標 500px 外 → 維持原方向。
    const nd = trackTurn({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: -500 }, 90, 1, 0.1, 100);
    expect(nd.x).toBeCloseTo(1);
    expect(nd.y).toBeCloseTo(0);
  });
});

describe('isBulletExpired — 壽命三態', () => {
  it('飛行距離達上限 → 過期', () => {
    expect(isBulletExpired(12, 0, 0, { distanceUnits: 12 })).toBe(true);
    expect(isBulletExpired(11.9, 0, 0, { distanceUnits: 12 })).toBe(false);
  });
  it('時間達上限 → 過期', () => {
    expect(isBulletExpired(0, 4, 0, { timeSec: 4 })).toBe(true);
  });
  it('命中數達上限(預設 1) → 過期', () => {
    expect(isBulletExpired(0, 0, 1, {})).toBe(true);
    expect(isBulletExpired(0, 0, 0, {})).toBe(false);
  });
});

describe('normalize', () => {
  it('零向量 fallback 朝右', () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
  });
  it('正規化長度=1', () => {
    const n = normalize({ x: 3, y: 4 });
    expect(Math.hypot(n.x, n.y)).toBeCloseTo(1);
  });
});
