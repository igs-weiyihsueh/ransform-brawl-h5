import { describe, expect, it } from 'vitest';
import { lateralKnockbackDir } from '@/systems/dashMath';

/**
 * 衝刺側向擊退方向測試（純函式）。
 * 側向 = 垂直於衝刺方向，指向敵人所在側。含壞版必紅對照。
 */
describe('lateralKnockbackDir — 衝刺側向擊退', () => {
  it('往右衝、敵人在上方 → 往上推（垂直衝刺）', () => {
    const lat = lateralKnockbackDir({ x: 1, y: 0 }, { x: 50, y: -30 });
    // 垂直於 (1,0) → (0,±1)；敵人在上(y<0) → 往上(y 負)。
    expect(lat.x).toBeCloseTo(0);
    expect(lat.y).toBeLessThan(0);
  });

  it('往右衝、敵人在下方 → 往下推', () => {
    const lat = lateralKnockbackDir({ x: 1, y: 0 }, { x: 50, y: 40 });
    expect(lat.x).toBeCloseTo(0);
    expect(lat.y).toBeGreaterThan(0);
  });

  it('結果永遠垂直於衝刺方向（點積為 0）', () => {
    const dir = { x: 0.6, y: 0.8 };
    const lat = lateralKnockbackDir(dir, { x: 100, y: -20 });
    expect(dir.x * lat.x + dir.y * lat.y).toBeCloseTo(0);
  });

  it('往上衝、敵人在左 / 右 → 分別往左 / 右推', () => {
    const left = lateralKnockbackDir({ x: 0, y: -1 }, { x: -30, y: -50 });
    const right = lateralKnockbackDir({ x: 0, y: -1 }, { x: 30, y: -50 });
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
  });

  // 🔴 壞版必紅對照：若側別選反（sign 取反），敵人在上方會被往下推 → 與正確版相反。
  it('壞版對照：側別取反會把敵人往錯側推', () => {
    const dir = { x: 1, y: 0 };
    const toEnemy = { x: 50, y: -30 }; // 敵人在上
    const good = lateralKnockbackDir(dir, toEnemy);
    // 壞版：sign 反過來。
    const cross = dir.x * toEnemy.y - dir.y * toEnemy.x;
    const badSign = cross >= 0 ? -1 : 1;
    const bad = { x: -dir.y * badSign, y: dir.x * badSign };
    expect(good.y).toBeLessThan(0); // 正確：往上
    expect(bad.y).toBeGreaterThan(0); // 壞版：往下（相反）
    expect(good.y).not.toBe(bad.y);
  });
});
