// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { attackFacing } from '@/systems/enemySeparation';

/**
 * attackFacing 純函式（用戶新#2 敵人背對攻擊，翼騎 9cd5ca8）。
 * fireAttack 出手當下強制面向玩家：右→+1、左→-1、dx≈0(幾乎正上下)→保留 currentFacing(不亂轉)。
 * 修「蓄力間玩家繞側/垂直站位 dx≈0 卡背對」。維度3 斷實際 facing 值,非 call-count。含壞版必紅。
 * ⚠️ fireAttack 每幀觸發 setFacing 屬 entity/狀態機(需 boot)不補;attackFacing 純函式補足。
 */
describe('attackFacing — 出手當下面向玩家（dx≈0 保留）', () => {
  it('玩家在右(aimX-posX > eps) → +1', () => {
    expect(attackFacing(100, 0, -1)).toBe(1); // 遠右,原本面左也轉右
    expect(attackFacing(0.5, 0, 1, 0.001)).toBe(1); // 略右超 eps
  });

  it('玩家在左(aimX-posX < -eps) → -1', () => {
    expect(attackFacing(0, 100, 1)).toBe(-1); // 遠左,原本面右也轉左
    expect(attackFacing(-0.5, 0, -1, 0.001)).toBe(-1);
  });

  it('★ dx≈0(|aimX-posX| <= eps,玩家幾乎正上下) → 保留 currentFacing（不亂轉）', () => {
    // 兩向都測:原面右保留+1、原面左保留-1。
    expect(attackFacing(500, 500, 1)).toBe(1); // dx=0、原+1 → 保留+1
    expect(attackFacing(500, 500, -1)).toBe(-1); // dx=0、原-1 → 保留-1
    // eps 內(0.0005 < 0.001)也保留。
    expect(attackFacing(500.0005, 500, 1, 0.001)).toBe(1);
    expect(attackFacing(500.0005, 500, -1, 0.001)).toBe(-1);
  });

  it('邊界：剛好 = eps（不 > eps）→ 保留 currentFacing（eps 用 > / < 嚴格）', () => {
    // dx = eps 恰好 → 不觸發 dx>eps（嚴格 >）→ 保留。
    expect(attackFacing(0.001, 0, -1, 0.001)).toBe(-1); // dx=eps → 保留-1(非+1)
    expect(attackFacing(-0.001, 0, 1, 0.001)).toBe(1); // dx=-eps → 保留+1(非-1)
    // 略超 eps 才轉。
    expect(attackFacing(0.0011, 0, -1, 0.001)).toBe(1);
  });

  // 🔴 壞版對照：dx≈0 必須保留 currentFacing（不可用 sign(0)=0 或亂跳）。
  it('壞版對照：dx=0 時回傳保留的 currentFacing（非 0、非翻轉）', () => {
    expect(attackFacing(500, 500, 1)).not.toBe(0);
    expect(attackFacing(500, 500, 1)).toBe(1); // 保留、非 0/翻轉
    expect(attackFacing(500, 500, -1)).toBe(-1);
  });

  // 🔴 壞版對照：左右方向不得反（右必+1、左必-1）。
  it('壞版對照：右→+1、左→-1（方向不反）', () => {
    expect(attackFacing(100, 0, 1)).toBe(1); // 右
    expect(attackFacing(0, 100, 1)).toBe(-1); // 左
  });
});
