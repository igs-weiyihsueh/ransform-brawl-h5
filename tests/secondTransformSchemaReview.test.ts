import { describe, expect, it } from 'vitest';
import { resolveSecondTransformEnabled } from '@/config/secondTransformSchema';

/**
 * secondTransformSchema 複核補強（測騎複核翼騎 31fd4b7 的 8 測）：翼騎 8 測鑑別足
 *  （忽略 override→紅 / 移 version 檢查→紅 / enabled 改 truthy→紅），且已記取 fillThreshold slip 教訓用非預設 packaged 測。
 * 唯一未鎖：`typeof override !== 'object'` 物件守衛——翼騎測的非物件(字串/數字/陣列)都因「.version undefined ≠ 1」被 version 檢查擋下,
 *   故「移除物件守衛」對這些輸入是等價 mutant（version 檢查代償）。
 * ★但用「帶 version/enabled 屬性的 function」可鑑別：typeof 'function' ≠ 'object' → 物件守衛擋(回 packaged);
 *   若移除守衛 → 讀到 fn.version=1/fn.enabled=true → 誤採用。此測釘死物件守衛 load-bearing。
 * 維度3 斷 bool。與翼騎測互補。
 */
describe('resolveSecondTransformEnabled — 物件守衛鎖定（非物件型別即使帶對的屬性也不採用）', () => {
  it('★ function 帶 version:1/enabled:true → 回 packaged(false)，不採用（typeof function ≠ object）', () => {
    const fn = (() => {}) as unknown as { version: number; enabled: boolean };
    fn.version = 1;
    fn.enabled = true;
    // 物件守衛：function 非 object → 直接 packaged(false)。移除守衛會誤讀 fn.version/enabled → true → 紅。
    expect(resolveSecondTransformEnabled(fn)).toBe(false);
    // packaged=true 時仍回 packaged（true），證明走的是 fallback 非 override.enabled。
    expect(resolveSecondTransformEnabled(fn, true)).toBe(true);
  });

  it('對照：array 帶 version:1/enabled:true → 陣列是 object 過守衛,但仍照常驗（此處 version=1 且 enabled=true → 採用 true）', () => {
    // 說明：array typeof 'object' → 過物件守衛;帶合法 version/enabled → 採用（與 function 相反,凸顯守衛只擋非-object 型別）。
    const arr = [1] as unknown as { version: number; enabled: boolean };
    arr.version = 1;
    arr.enabled = true;
    expect(resolveSecondTransformEnabled(arr)).toBe(true); // array 過守衛 + 合法欄 → 採用
    // 對照翼騎測的純陣列 [1,2]（無 version）→ version 檢查擋 → packaged。此處補「陣列帶合法欄」的另一側。
  });
});
