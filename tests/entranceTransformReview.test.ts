// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { shouldTransformDuringFloat } from '@/systems/entranceTransformMath';

/**
 * entranceTransformMath 補鎖（測騎複核翼騎 b17af4b 10 測）：翼騎 9 測鑑別足
 *  —— ease-out/往上號誌/歐氏距離/floatSec<=0 guard/isFloatDone/knockback 邊界 壞版皆紅。
 * ★一個未鎖（跑壞版驗出）：shouldTransformDuringFloat 的 `>= at` 邊界。
 *   翼騎用 shouldTransformDuringFloat(0.51, 0.6, 0.85)==true 驗邊界,但 0.51/0.6=0.8500000000000001
 *   （浮點進位落在 0.85 之上）→ `> at` 也 true → `>=`→`>` 的 mutant **不會紅**（邊界沒踩準）。
 *   要鎖 `>=` 需 elapsed/floatSec 「恰等於」at。用 floatSec=1、at=0.85、elapsed=0.85 → 0.85/1=0.85 精確 →
 *   `>=` true、`>` false → 鑑別。維度2：at 是參數（用非預設 floatSec=1 使商精確等於 at）。
 */
describe('shouldTransformDuringFloat 補鎖 — >=at 精確邊界（浮點踩準）', () => {
  it('★進度恰等於 at → 觸發（>= 邊界，非 >）', () => {
    // 0.85 / 1 = 0.85 精確 → >=0.85 為 true（若 mutant 改 >0.85 則 false → 紅）
    expect(shouldTransformDuringFloat(0.85, 1, 0.85)).toBe(true);
  });
  it('★進度略低於 at（恰 at 的前一刻）→ 不觸發', () => {
    // 0.84 / 1 = 0.84 < 0.85 → false（守住 at 下界不誤觸發）
    expect(shouldTransformDuringFloat(0.84, 1, 0.85)).toBe(false);
  });
  it('進度略高於 at → 觸發', () => {
    expect(shouldTransformDuringFloat(0.86, 1, 0.85)).toBe(true);
  });
});
