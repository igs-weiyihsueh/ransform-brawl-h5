// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { enemyFlipForAnim } from '@/systems/enemySeparation';

/**
 * enemyFlipForAnim 純函式（敵人背對攻擊回歸根治，翼騎 0dbdd18）。
 * 真因：attack 貼圖美術基準跟 move/idle 相反(預先鏡像)——同一 flipX 下 move 視覺朝左(對)、attack 朝右(背對)。
 * 修：對 attack 系動畫多翻一次補償。base=(facing<0)＝敵人慣例(move/idle 對);attack 系 → !base(相反)。
 * animKey 含 "attack"(不分大小寫、含子串前綴如 Enemy_Rush__attack)算 attack;damaged 算 move 類。
 * 維度3 斷實際 flipX 值,非 call-count。含壞版必紅(attack 沒補償=正是這次回歸的 bug)。
 * ⚠️ CharacterAnimator 記 enemyFacing / play 時重算 flipX 屬 entity 層(需 boot)不補;enemyFlipForAnim 純函式補足。
 */
describe('enemyFlipForAnim — 依動畫決定 flipX（attack 美術相反補償）', () => {
  it('move/idle：flipX = (facing<0)（現行慣例，對）', () => {
    expect(enemyFlipForAnim(-1, 'Enemy_Rush__move')).toBe(true); // 朝左 → true
    expect(enemyFlipForAnim(1, 'Enemy_Rush__move')).toBe(false); // 朝右 → false
    expect(enemyFlipForAnim(-1, 'idle')).toBe(true);
    expect(enemyFlipForAnim(1, 'idle')).toBe(false);
  });

  it('★ attack 系：相反（補償 attack 美術預鏡像）— 根治核心', () => {
    // 這正是回歸的反例：move facing<0=true，attack facing<0 必須 false(相反)。
    // 用 exact "attack" key（不涉前綴判定），純測「補償方向」本身。
    expect(enemyFlipForAnim(-1, 'attack')).toBe(false); // 朝左 → false(相反)
    expect(enemyFlipForAnim(1, 'attack')).toBe(true); // 朝右 → true(相反)
  });

  it('★ attack 與 move 在同 facing 下 flipX 相反（沒補償=回歸)', () => {
    // 同 facing<0：move=true、attack=false → 兩者相反才對。
    expect(enemyFlipForAnim(-1, 'Enemy_Rush__move')).not.toBe(
      enemyFlipForAnim(-1, 'Enemy_Rush__attack'),
    );
    expect(enemyFlipForAnim(1, 'Enemy_Rush__move')).not.toBe(
      enemyFlipForAnim(1, 'Enemy_Rush__attack'),
    );
  });

  it('animKey 判定：含 "attack" 子串/前綴 key 算 attack 系（Enemy_XXX__attack）', () => {
    // 前綴 key 也要算 attack（含子串）— 這條專抓「只認 exact attack、前綴沒算」的漏。
    // 對照組：純 "attack" key（exact）也是 attack，用來跟前綴分家。
    const exactAttackNeg0 = enemyFlipForAnim(-1, 'attack'); // exact
    const prefixAttackNeg0 = enemyFlipForAnim(-1, 'Enemy_Boss__attack'); // 前綴
    expect(exactAttackNeg0).toBe(false); // exact attack → 補償 false
    expect(prefixAttackNeg0).toBe(false); // ★ 前綴 attack 也要 → false（漏認會變 true）
    expect(prefixAttackNeg0).toBe(exactAttackNeg0); // 前綴與 exact 同待遇
    expect(enemyFlipForAnim(-1, 'Enemy_Rush__attack_02')).toBe(false); // 後綴變體
    // 不分大小寫。
    expect(enemyFlipForAnim(-1, 'Enemy_Rush__Attack')).toBe(false);
  });

  it('damaged 算 move 類（非 attack，不補償）', () => {
    expect(enemyFlipForAnim(-1, 'Enemy_Rush__damaged')).toBe(true); // 同 move
    expect(enemyFlipForAnim(1, 'Enemy_Rush__damaged')).toBe(false);
  });

  // 🔴 壞版對照：attack 若沒補償(跟 move 一樣用 facing<0) → 正是本次回歸的 bug（全背對）。
  // 用 exact "attack" key 專測補償方向（不涉前綴判定），對準 A 型回歸。
  it('壞版對照：attack facing<0 必須 false（沒補償會回 true=回歸全背對）', () => {
    expect(enemyFlipForAnim(-1, 'attack')).toBe(false);
    expect(enemyFlipForAnim(-1, 'attack')).not.toBe(enemyFlipForAnim(-1, 'move'));
  });
});
