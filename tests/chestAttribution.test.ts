import { describe, expect, it } from 'vitest';
import { splitChestByDamage } from '@/systems/chestAttribution';

/**
 * 寶盒擊殺歸屬（傷害比例分）測試（決策 c61872a6）。
 * 含壞版必紅：按傷害比例（非平分/非 last-hit）、餘數給貢獻最大者、守恆（分完=total）。
 */
describe('splitChestByDamage — 傷害比例分', () => {
  it('規格例：total10, P1打7/P2打3 → P1得7、P2得3', () => {
    const r = splitChestByDamage(10, new Map([[0, 7], [1, 3]]));
    expect(r.get(0)).toBe(7);
    expect(r.get(1)).toBe(3);
  });

  it('守恆：分配總和 = total', () => {
    const r = splitChestByDamage(10, new Map([[0, 7], [1, 3]]));
    let sum = 0;
    for (const v of r.values()) sum += v;
    expect(sum).toBe(10);
  });

  it('餘數給貢獻最大者（total5, P1打7/P2打3: floor 3.5=3, floor 1.5=1, 餘1給P1→4/1）', () => {
    const r = splitChestByDamage(5, new Map([[0, 7], [1, 3]]));
    // 5×7/10=3.5→3, 5×3/10=1.5→1, allocated=4, 餘1給貢獻最大(P1)。
    expect(r.get(0)).toBe(4);
    expect(r.get(1)).toBe(1);
    expect(r.get(0)! + r.get(1)!).toBe(5); // 守恆
  });

  it('單一貢獻者 → 全給他', () => {
    const r = splitChestByDamage(10, new Map([[2, 50]]));
    expect(r.get(2)).toBe(10);
  });

  it('無人打（空/零傷害）→ 全給 fallback P1（防呆）', () => {
    expect(splitChestByDamage(10, new Map()).get(0)).toBe(10);
    expect(splitChestByDamage(10, new Map([[1, 0]]), 0).get(0)).toBe(10);
  });

  it('total<=0 → 空分配', () => {
    expect(splitChestByDamage(0, new Map([[0, 5]])).size).toBe(0);
  });

  // 🔴 壞版對照：平分（非比例）會給 P1=5/P2=5，與比例分 7/3 不同。
  it('壞版對照：比例分 7/3 ≠ 平分 5/5', () => {
    const r = splitChestByDamage(10, new Map([[0, 7], [1, 3]]));
    expect(r.get(0)).toBe(7);
    expect(r.get(0)).not.toBe(5); // 非平分
  });

  // 🔴 壞版對照：last-hit（全給最後打的）會給單一玩家 10，與比例分不同。
  it('壞版對照：比例分讓兩人都拿到 ≠ last-hit 單人全拿', () => {
    const r = splitChestByDamage(10, new Map([[0, 7], [1, 3]]));
    expect(r.get(1)).toBeGreaterThan(0); // 非 last-hit（P2 也拿到）
  });
});
