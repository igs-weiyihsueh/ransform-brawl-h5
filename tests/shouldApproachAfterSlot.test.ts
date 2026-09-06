// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { shouldApproachAfterSlot } from '@/systems/enemySeparation';

/**
 * shouldApproachAfterSlot — 到槽後若搆不到玩家則繼續逼近（用戶七輪#7#8，翼騎 d1a4692）。
 * 真因：surround 外圈槽半徑>攻擊範圍→怪到槽即停搆不到→卡 chase 不攻擊。
 * 修：到槽後 body 距玩家 > 攻擊範圍 → 繼續逼近到能打（slot 給環繞骨架、不擋進攻）。
 * 簽章(讀 src d1a4692)：shouldApproachAfterSlot(distBodyPx, attackPx) → distBodyPx > attackPx（嚴格 >）。
 * 維度3 斷 bool。含壞版必紅（邏輯反 / 邊界 >= / 恆值）。
 * ⚠️ moveChase 到槽後用它決定逼近/停 + getVacuumCenter 身體中心接線屬狀態機(需 boot,翼騎 headless 驗修前9卡chase→修後8-9攻擊、下方怪也打)
 *    ——不補;shouldApproachAfterSlot 純函式補足。
 */
describe('shouldApproachAfterSlot — 到槽後搆不到才逼近（distBody > attackPx）', () => {
  it('★ distBody > attackPx → true（到槽仍離玩家 body 比攻擊範圍遠→繼續逼近到能打）', () => {
    expect(shouldApproachAfterSlot(200, 100)).toBe(true);
    expect(shouldApproachAfterSlot(101, 100)).toBe(true);
  });

  it('distBody < attackPx → false（已在攻擊範圍內→停在槽可攻擊）', () => {
    expect(shouldApproachAfterSlot(50, 100)).toBe(false);
    expect(shouldApproachAfterSlot(99, 100)).toBe(false);
  });

  it('★ 邊界：distBody === attackPx → false（剛好在範圍內不用再逼近，嚴格 >）', () => {
    expect(shouldApproachAfterSlot(100, 100)).toBe(false);
  });

  it('真值表：>範圍→逼近、<=範圍→停（只 dist>attack 這側 true）', () => {
    expect(shouldApproachAfterSlot(100.01, 100)).toBe(true);
    expect(shouldApproachAfterSlot(100, 100)).toBe(false);
    expect(shouldApproachAfterSlot(99.99, 100)).toBe(false);
  });
});
