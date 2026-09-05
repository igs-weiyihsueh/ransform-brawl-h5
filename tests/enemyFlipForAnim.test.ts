// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { enemyFlipForAnim } from '@/systems/enemySeparation';

/**
 * enemyFlipForAnim 純函式（用戶#8 待機/移動背對根治，翼騎 41d6bae）。
 * 真因更深：全 3 種敵人 idle+move 原始美術都天生朝左（放大 384px 原始幀確認），
 * 敵人 base flipX 慣例整個反了 → 根治：敵人慣例改成【跟玩家一致 flipX=(facing>0)】，全動作統一、移除 attack 特例。
 *   - +1(面右) → true、-1(面左) → false（與玩家 setFacing 同式）。
 *   - idle/move/attack/前綴 key 全動作同式：animKey 不再影響結果。
 * 維度3 斷實際 flipX 值,非 call-count。含壞版必紅(改回 facing<0/恢復 attack 特例=背對回歸)。
 * ⚠️ 這是把上次(aef91bc)為 0dbdd18 測的「attack→相反」斷言【反轉】成全動作 facing>0——行為改了,斷言跟著改對(非等價保留)。
 * ⚠️ CharacterAnimator 記 enemyFacing / play 重算 flipX 屬 entity 層(需 boot)不補;enemyFlipForAnim 純函式補足。
 */
describe('enemyFlipForAnim — 全動作 flipX=facing>0（與玩家一致，#8 根治）', () => {
  it('facing>0(面右) → true、facing<0(面左) → false（與玩家 setFacing 一致）', () => {
    expect(enemyFlipForAnim(1, 'Enemy_Rush__move')).toBe(true); // 面右 → true
    expect(enemyFlipForAnim(-1, 'Enemy_Rush__move')).toBe(false); // 面左 → false
    expect(enemyFlipForAnim(1, 'idle')).toBe(true);
    expect(enemyFlipForAnim(-1, 'idle')).toBe(false);
  });

  it('★ 全動作統一：idle/move/attack/前綴 key 同 facing 下 flipX 相同（animKey 不再影響、無 attack 特例）', () => {
    // 同 facing=+1：所有動畫都 true（不再有 attack 相反分支）。
    const keys = ['idle', 'Enemy_Rush__move', 'attack', 'Enemy_Rush__attack', 'Enemy_Boss__attack_02', 'Enemy_Rush__damaged'];
    for (const k of keys) {
      expect(enemyFlipForAnim(1, k)).toBe(true); // 面右統一 true
      expect(enemyFlipForAnim(-1, k)).toBe(false); // 面左統一 false
    }
    // attack 與 move 同 facing 下【相同】（#8 前是相反，現在統一）。
    expect(enemyFlipForAnim(1, 'Enemy_Rush__attack')).toBe(
      enemyFlipForAnim(1, 'Enemy_Rush__move'),
    );
    expect(enemyFlipForAnim(-1, 'Enemy_Rush__attack')).toBe(
      enemyFlipForAnim(-1, 'Enemy_Rush__move'),
    );
  });

  it('★ 與玩家慣例一致：面右 flipX=true（敵人美術也朝左，慣例該跟玩家同，非相反）', () => {
    // 這是 #8 根治核心：敵人不再是「相反慣例」，面右就 true（跟玩家 setFacing 同式）。
    expect(enemyFlipForAnim(1)).toBe(true); // 不帶 animKey 也一樣（animKey 選填）
    expect(enemyFlipForAnim(-1)).toBe(false);
  });

  // 🔴 壞版對照：敵人若改回舊慣例 facing<0（或恢復 attack 相反特例）→ 背對回歸。
  it('壞版對照：面右(facing>0) 必須 true（改回 facing<0=背對回歸）', () => {
    expect(enemyFlipForAnim(1, 'Enemy_Rush__move')).toBe(true);
    expect(enemyFlipForAnim(-1, 'Enemy_Rush__move')).toBe(false);
  });

  // 🔴 壞版對照：attack 若殘留相反特例 → 與 move 不一致（全動作一致被破壞）。
  it('壞版對照：attack 與 idle/move 一致（殘留 attack 特例會不一致）', () => {
    expect(enemyFlipForAnim(1, 'Enemy_Rush__attack')).toBe(true); // 跟 move 同（非相反）
    expect(enemyFlipForAnim(-1, 'Enemy_Rush__attack')).toBe(false);
  });
});
