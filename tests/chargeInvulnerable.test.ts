// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isChargeInvulnerable } from '@/systems/enemySeparation';

/**
 * isChargeInvulnerable — 菁英蓄力不可被打斷/免疫被推（用戶六輪#3，翼騎 574b985）。
 * 菁英(immovable) charge 狀態免疫中斷(受擊不打斷蓄力、免疫被推,但血照扣≠無敵)。
 * 簽章(讀 src 574b985)：isChargeInvulnerable(state:string, immovable:boolean) → state==='charge' && immovable===true。
 * 維度3 斷 bool。只有 charge && immovable 同時成立才 true。含壞版必紅（漏 state / 漏 immovable / 恆值）。
 * ⚠️ takeHit chargeLocked(照扣血不清特效不 damaged) + resolvePenetration/pushOutOfObstacle chargeLocked 早退
 *    屬狀態機接線(需 boot,翼騎 headless 免疫被推 0px/免疫打斷仍 charge、hp 照扣 PASS)、#2 chargeFx/#4 aoeBurst 純視覺
 *    ——不補;isChargeInvulnerable 純函式補足。
 */
describe('isChargeInvulnerable — 只菁英(immovable)蓄力(charge)那刻免疫', () => {
  it('★ charge && immovable=true → true（菁英蓄力中，免疫打斷/被推）', () => {
    expect(isChargeInvulnerable('charge', true)).toBe(true);
  });

  it('★ charge && immovable=false → false（衝鋒兵/一般近戰蓄力可打斷，用戶只要菁英）', () => {
    expect(isChargeInvulnerable('charge', false)).toBe(false);
  });

  it('★ 非 charge 狀態 + immovable=true → false（菁英非蓄力不免疫，平時照樣被推）', () => {
    for (const s of ['chase', 'attack', 'idle', 'hitstun', 'dead']) {
      expect(isChargeInvulnerable(s, true)).toBe(false);
    }
  });

  it('非 charge + immovable=false → false', () => {
    expect(isChargeInvulnerable('chase', false)).toBe(false);
    expect(isChargeInvulnerable('idle', false)).toBe(false);
  });

  it('真值表：只有 (charge, immovable=true) 為 true，其餘三格皆 false', () => {
    expect(isChargeInvulnerable('charge', true)).toBe(true);
    expect(isChargeInvulnerable('charge', false)).toBe(false);
    expect(isChargeInvulnerable('chase', true)).toBe(false);
    expect(isChargeInvulnerable('chase', false)).toBe(false);
  });
});
