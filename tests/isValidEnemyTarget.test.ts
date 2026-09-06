// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isValidEnemyTarget } from '@/systems/targetingMath';

/**
 * isValidEnemyTarget — 敵人有效目標判定（用戶七輪 待機玩家隔離 bug，翼騎 f1019db）。
 * 真因：怪追擊/攻擊沒 gate 待機玩家(isWaiting)→待機角色被追打。修：待機玩家不是有效目標。
 * 簽章(讀 src f1019db)：isValidEnemyTarget(player: {isWaiting?:()=>boolean} | null | undefined) → boolean
 *   = !player→false；isWaiting 是函式且 ()===true→false；否則 true(含無 isWaiting 的精簡 stub)。
 * 維度3 斷有效目標 bool(waiting→false / 非→true / null→false)。含壞版必紅(無視 waiting / null 沒擋)。
 * ⚠️ EnemySpawner e.update(null)/applyAttackDamage gate 接線屬狀態機(需 boot,翼騎 headless 驗待機不被追近 200px)——不補;isValidEnemyTarget 純函式補足。
 */
const waiting = { isWaiting: () => true };
const joined = { isWaiting: () => false };

describe('isValidEnemyTarget — 待機玩家不是有效目標', () => {
  it('★ waiting 玩家（isWaiting()=true）→ false（怪不鎖定/追擊/攻擊）', () => {
    expect(isValidEnemyTarget(waiting)).toBe(false);
  });

  it('★ 非 waiting（已加入,isWaiting()=false）→ true（正常參戰目標）', () => {
    expect(isValidEnemyTarget(joined)).toBe(true);
  });

  it('★ null / undefined → false（無目標,不炸）', () => {
    expect(isValidEnemyTarget(null)).toBe(false);
    expect(isValidEnemyTarget(undefined)).toBe(false);
  });

  it('無 isWaiting 的精簡 stub → true（相容：無此契約視為有效目標）', () => {
    expect(isValidEnemyTarget({})).toBe(true);
  });

  it('真值表：只有 waiting=true 那格 false，其餘（joined/無契約）true、null/undefined false', () => {
    expect(isValidEnemyTarget(waiting)).toBe(false);
    expect(isValidEnemyTarget(joined)).toBe(true);
    expect(isValidEnemyTarget({})).toBe(true);
    expect(isValidEnemyTarget(null)).toBe(false);
  });
});
