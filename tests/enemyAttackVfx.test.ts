// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { enemyAttackVfx } from '@/systems/enemySeparation';

/**
 * enemyAttackVfx — 敵人出手視覺分類（用戶三輪#12 衝鋒兵揮斬回歸根治，翼騎 233ea4f）。
 * 真因：舊 #3 用 attack.shapeType==='circle' 判視覺，但所有近戰命中形狀恆 meleeCircle→衝鋒兵/菁英/射彈全走 AOE、slash 沒觸發。
 * 修為看 config 語意欄 attackVfx（'slash'|'aoe'|undefined），非命中形狀。
 * 簽章(讀 src 233ea4f)：enemyAttackVfx(attackKind:'melee'|'projectile', attackVfx:'slash'|'aoe'|undefined) → 'slash'|'aoe'|'none'。
 * 維度3 斷 slash/aoe/none 三分類值。含壞版必紅（衝鋒兵預設 slash / 射彈 none / 菁英 aoe）。
 * ⚠️ Enemy charge/fireAttack 改用此函式屬狀態機接線(需 boot,翼騎量化 slash1/aoeBurst1 驗過)、config attackVfx 欄屬資料——不補;此純函式補足。
 */
describe('enemyAttackVfx — 出手視覺分類（看 attackVfx 語意，非命中形狀）', () => {
  it('★ 近戰預設（attackVfx 省略 undefined）→ slash（#12 真因核心：衝鋒兵/一般近戰揮斬）', () => {
    expect(enemyAttackVfx('melee', undefined)).toBe('slash');
  });

  it('近戰 + attackVfx="slash" 顯式 → slash', () => {
    expect(enemyAttackVfx('melee', 'slash')).toBe('slash');
  });

  it('★ 近戰 + attackVfx="aoe"（菁英大範圍，預告圈+爆發）→ aoe', () => {
    expect(enemyAttackVfx('melee', 'aoe')).toBe('aoe');
  });

  it('★ 射彈（projectile）→ none（不播近戰特效，不論 attackVfx）', () => {
    expect(enemyAttackVfx('projectile', undefined)).toBe('none');
    expect(enemyAttackVfx('projectile', 'slash')).toBe('none');
    expect(enemyAttackVfx('projectile', 'aoe')).toBe('none'); // aoe 也不播（射彈優先 gate）
    expect(enemyAttackVfx('projectile', 'fan')).toBe('none'); // fan 也不播
  });

  it('★ 近戰 + attackVfx="fan"（七輪：衝鋒兵 Enemy_Rush 扇形揮砍）→ fan', () => {
    expect(enemyAttackVfx('melee', 'fan')).toBe('fan');
  });

  it('四分類值域完整：melee 分 slash/aoe/fan（undefined→slash）、projectile 恆 none', () => {
    const kinds: Array<'melee' | 'projectile'> = ['melee', 'projectile'];
    const vfxs: Array<'slash' | 'aoe' | 'fan' | undefined> = ['slash', 'aoe', 'fan', undefined];
    for (const k of kinds) {
      for (const v of vfxs) {
        const r = enemyAttackVfx(k, v);
        expect(['slash', 'aoe', 'fan', 'none']).toContain(r);
        if (k === 'projectile') expect(r).toBe('none');
      }
    }
    // 向後相容：既有三值不受 fan 新增影響。
    expect(enemyAttackVfx('melee', 'slash')).toBe('slash');
    expect(enemyAttackVfx('melee', undefined)).toBe('slash');
    expect(enemyAttackVfx('melee', 'aoe')).toBe('aoe');
  });
});
