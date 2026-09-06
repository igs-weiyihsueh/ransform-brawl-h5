// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { shouldSpawnMore, shouldAdvanceSpawn } from '@/systems/waveMath';

/**
 * waveMath 純函式（用戶 #6 根治「怪沒清完就進獎勵」，翼騎 757b84e）。
 * 雙因根治：(a) drip 不超生（生產總數 kills+alive+pending 封頂於 quota）
 *          (b) advance gate 清空（kills>=quota 且場上 alive/pending 皆空才推進）。
 * 維度3 斷實際 bool。壞版=這次 bug 兩因再現（漏 quota 封頂=超生 / 只 gate kills 不看 alive=帶殘怪）必紅。
 * ⚠️ WaveSystem.updateSpawnNode 每幀接線屬狀態機(需 boot)不補;shouldSpawnMore/shouldAdvanceSpawn 純函式補足。
 *    守護波(GuardEvent 限時無配額 drip)不套此。
 */
describe('shouldSpawnMore — 不超生（生產總數封頂 quota）+ 場面節流', () => {
  it('★ 生產總數(kills+alive+pending) 達 quota → false（quota 即該波總量、不超生）', () => {
    // quota=10：已殺 6 + 場上 2 + 預警 2 = 10 → 不再生（即使佔用 4 < threshold/maxAlive）。
    expect(shouldSpawnMore(6, 2, 2, 10, 8, 5)).toBe(false);
    // 超過也 false。
    expect(shouldSpawnMore(9, 1, 1, 10, 8, 5)).toBe(false);
    // 恰達 quota（8+1+1=10）→ false（>= 邊界）。
    expect(shouldSpawnMore(8, 1, 1, 10, 8, 5)).toBe(false);
  });

  it('未達 quota 且佔用(alive+pending) < threshold 且 < maxAlive → true（可 drip）', () => {
    // 總數 3+1+0=4 < 10、佔用 1 < threshold5 且 < maxAlive8 → 生。
    expect(shouldSpawnMore(3, 1, 0, 10, 8, 5)).toBe(true);
    expect(shouldSpawnMore(0, 0, 0, 10, 8, 5)).toBe(true); // 開場空場 → 生
  });

  it('★ 佔用滿（≥threshold 或 ≥maxAlive）→ false（即使沒達 quota、節流不塞爆）', () => {
    // 總數 2+5+0=7 < 10（沒達 quota），但佔用 5 >= threshold5 → 不生（節流）。
    expect(shouldSpawnMore(2, 5, 0, 10, 8, 5)).toBe(false);
    // 佔用達 maxAlive（threshold 更大時仍受 maxAlive 卡）：alive+pending=8 >= maxAlive8。
    expect(shouldSpawnMore(0, 8, 0, 20, 8, 20)).toBe(false);
    // 佔用含 pending：alive3+pending2=5 >= threshold5 → 不生。
    expect(shouldSpawnMore(0, 3, 2, 10, 8, 5)).toBe(false);
  });

  it('邊界：佔用恰 threshold-1 → 生；恰 threshold → 不生（嚴格 <）', () => {
    expect(shouldSpawnMore(0, 4, 0, 10, 8, 5)).toBe(true); // 佔用 4 < 5
    expect(shouldSpawnMore(0, 5, 0, 10, 8, 5)).toBe(false); // 佔用 5 不 < 5
  });

  // 🔴 壞版對照：漏 quota 封頂（只看 threshold/maxAlive）→ 總數達 quota 仍生 = 超生 bug 再現。
  it('壞版對照：總數達 quota 時必 false（漏封頂會回 true=超生留殘怪）', () => {
    // 佔用 0（<threshold、<maxAlive）但已殺滿 quota → 必須 false（若只看場面條件會誤回 true）。
    expect(shouldSpawnMore(10, 0, 0, 10, 8, 5)).toBe(false);
  });
});

describe('shouldAdvanceSpawn — gate 清空才推進（不帶殘怪進下節點）', () => {
  it('★ kills>=quota 但 alive>0（有殘怪）→ false（不帶殘怪進 Reward，根治核心）', () => {
    expect(shouldAdvanceSpawn(10, 10, 2, 0)).toBe(false); // 殺滿但場上還有 2 隻
    expect(shouldAdvanceSpawn(12, 10, 1, 0)).toBe(false);
  });

  it('★ kills>=quota 但 pending>0（預警中）→ false（等生完清完才走）', () => {
    expect(shouldAdvanceSpawn(10, 10, 0, 1)).toBe(false);
  });

  it('kills>=quota 且 alive=0 且 pending=0 → true（殺滿且清空才 advance）', () => {
    expect(shouldAdvanceSpawn(10, 10, 0, 0)).toBe(true);
    expect(shouldAdvanceSpawn(11, 10, 0, 0)).toBe(true); // 超殺也算達標
  });

  it('kills < quota → false（沒殺滿不論場上如何都不推進）', () => {
    expect(shouldAdvanceSpawn(9, 10, 0, 0)).toBe(false);
    expect(shouldAdvanceSpawn(0, 10, 0, 0)).toBe(false);
  });

  // 🔴 壞版對照：只 gate kills>=quota 不看 alive → 有殘怪卻 advance = 帶殘怪進下節點 bug 再現。
  it('壞版對照：kills 達標但 alive>0 必 false（只看 kills 會誤 true=怪沒清完進獎勵）', () => {
    expect(shouldAdvanceSpawn(10, 10, 3, 0)).toBe(false);
  });
});

describe('shouldAdvanceSpawn — nextIsSpawn（六輪#5 Spawn接Spawn維持場面，781c58a）', () => {
  // behavior：下一節點也是 Spawn → 殺滿 quota 即前進(殘怪接續帶進下一波、場面不提前變空)；
  //          下一節點非 Spawn → 維持原本「殺滿且清空才進」。nextIsSpawn 預設 false=舊邏輯。
  it('★ next=Spawn（nextIsSpawn=true）：kills>=quota 即 true（殘怪 alive>0 仍前進）', () => {
    expect(shouldAdvanceSpawn(10, 10, 3, 0, true)).toBe(true); // 殘怪 3 仍 advance
    expect(shouldAdvanceSpawn(10, 10, 0, 2, true)).toBe(true); // pending 2 也不擋
    expect(shouldAdvanceSpawn(12, 10, 5, 3, true)).toBe(true);
  });

  it('next=Spawn 但 kills<quota → false（沒殺滿仍不前進）', () => {
    expect(shouldAdvanceSpawn(9, 10, 0, 0, true)).toBe(false);
  });

  it('★ next 非 Spawn（nextIsSpawn=false/省略）：要 alive=0 pending=0 才 true（維持原 gate）', () => {
    expect(shouldAdvanceSpawn(10, 10, 3, 0, false)).toBe(false); // 殘怪擋
    expect(shouldAdvanceSpawn(10, 10, 0, 0, false)).toBe(true);
    // 省略 nextIsSpawn = false（backward-compat，舊測不受影響）。
    expect(shouldAdvanceSpawn(10, 10, 3, 0)).toBe(false);
    expect(shouldAdvanceSpawn(10, 10, 0, 0)).toBe(true);
  });

  // 🔴 壞版對照：nextIsSpawn 分支若也 gate alive/pending（沒差異化）→ 殘怪 next=Spawn 那條紅。
  it('壞版對照：next=Spawn 殘怪 vs next非Spawn 殘怪 結果相反（差異化生效）', () => {
    expect(shouldAdvanceSpawn(10, 10, 3, 0, true)).toBe(true); // Spawn 接續
    expect(shouldAdvanceSpawn(10, 10, 3, 0, false)).toBe(false); // 非 Spawn 要清空
  });
});
