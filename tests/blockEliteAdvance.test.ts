import { describe, expect, it } from 'vitest';
import { blockEliteAdvance } from '@/systems/enemySeparation';

/**
 * blockEliteAdvance（用戶試玩 #1）：immovable 菁英「像牆」——菁英移動撞玩家時擋下菁英自己前進，
 * 不推玩家、也不被玩家推倒退。含壞版必紅。
 */
describe('blockEliteAdvance — 菁英像牆（不推玩家、不被玩家推）', () => {
  const P = { x: 0, y: 0 };
  const minDist = 100;

  it('菁英追玩家造成重疊 → 菁英被頂回 minDist 外緣（自己停，玩家不動）', () => {
    // 菁英從 (150,0) 移到 (60,0)，撞進玩家(minDist=100)。應被擋回外緣。
    const fixed = blockEliteAdvance({ x: 60, y: 0 }, { x: 150, y: 0 }, P, minDist);
    // 移動前距離150 > minDist100 → targetDist=min(100,150)=100 → 頂回 x=100。
    expect(fixed.x).toBeCloseTo(100, 5);
    expect(fixed.y).toBeCloseTo(0, 5);
  });

  it('沒重疊（菁英在 minDist 外）→ 菁英照走、原位不動', () => {
    const fixed = blockEliteAdvance({ x: 120, y: 0 }, { x: 150, y: 0 }, P, minDist);
    expect(fixed).toEqual({ x: 120, y: 0 });
  });

  it('玩家貼著菁英走（菁英本幀沒前進，prevDist=dist<minDist）→ 菁英不被玩家推倒退（留原位）', () => {
    // 菁英靜止在 (70,0)（prev 也 70），玩家把菁英中心逼到 70<100。
    // targetDist=min(100, prevDist=70)=70 → 菁英維持 x=70，不被玩家往外推。
    const fixed = blockEliteAdvance({ x: 70, y: 0 }, { x: 70, y: 0 }, P, minDist);
    expect(fixed.x).toBeCloseTo(70, 5);
  });

  // 🔴 壞版對照：菁英不得把自己推到「比移動前更遠」（那等於被玩家推著走 = 原 bug）。
  it('壞版對照：修正後距玩家 ≤ 移動前距離（菁英不被玩家推得更遠）', () => {
    const prev = { x: 70, y: 0 };
    const prevDist = Math.hypot(prev.x - P.x, prev.y - P.y); // 70
    const fixed = blockEliteAdvance({ x: 65, y: 0 }, prev, P, minDist);
    const fixedDist = Math.hypot(fixed.x - P.x, fixed.y - P.y);
    expect(fixedDist).toBeLessThanOrEqual(prevDist + 1e-6);
  });

  // 🔴 壞版對照：菁英前進造成的重疊必須被擋（修正後 ≥ 移動後的侵入距離，往外頂）。
  it('壞版對照：菁英前進侵入時被往外頂（修正後距離 > 侵入時距離）', () => {
    const fixed = blockEliteAdvance({ x: 60, y: 0 }, { x: 150, y: 0 }, P, minDist);
    const fixedDist = Math.hypot(fixed.x - P.x, fixed.y - P.y);
    expect(fixedDist).toBeGreaterThan(60); // 從侵入的 60 被頂回到 100
  });
});
