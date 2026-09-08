import { describe, expect, it } from 'vitest';
import {
  resolveSecondTransform,
  type ResolvedSecondTransform,
} from '@/config/secondTransformSchema';

/**
 * resolveSecondTransform 複核補強（測騎複核翼騎 4c6a137 的 16 測）：翼騎 16 測鑑別足
 *  —— 讀欄 crosstalk（energyPerKill 讀 decayPerSec 等）、posNum >0(0/負/NaN/字串)、fallback crosstalk 多數已鎖，
 *  且已記取教訓（逐欄用能繞過守衛的輸入測、function-with-props 測物件守衛）。
 * ★唯一未鎖：翼騎 PKG 的 scaleMult=1.4 且 attackRangeMult=1.4（兩欄 fallback 值相同）→
 *  「scaleMult fallback 誤寫成 packaged.attackRangeMult」對該 PKG 不可鑑別（兩值一樣→slip）。
 *  本檔用「五欄全不同值」PKG,逐欄單獨走 fallback,釘死 scaleMult↔attackRangeMult(及其餘)fallback 不 crosstalk。
 * 維度3 斷各欄值。與翼騎測互補。
 */

/** ★關鍵：五欄值全不同（尤其 scaleMult ≠ attackRangeMult），才能抓 fallback 串欄。 */
const PKG_DISTINCT: ResolvedSecondTransform = {
  enabled: false,
  energyPerKill: 0.11,
  decayPerSec: 0.22,
  scaleMult: 1.33,
  attackRangeMult: 1.77, // ≠ scaleMult
};

describe('resolveSecondTransform — 逐欄 fallback 不串欄（五欄不同值 PKG）', () => {
  // 逐欄：只讓「該欄」壞（觸發 fallback），其餘給合法值（採用），驗該欄 fallback 到「自己的」packaged 欄。
  const goodOverride = {
    version: 1,
    enabled: true,
    energyPerKill: 0.5,
    decayPerSec: 0.6,
    scaleMult: 2.1,
    attackRangeMult: 2.9,
  };
  const fields: (keyof ResolvedSecondTransform)[] = ['energyPerKill', 'decayPerSec', 'scaleMult', 'attackRangeMult'];

  for (const f of fields) {
    it(`★ 只有 ${f} 壞(0) → 該欄 fallback 到 packaged.${f}（不串到別欄）`, () => {
      const ov: Record<string, unknown> = { ...goodOverride, [f]: 0 }; // 只這欄壞
      const r = resolveSecondTransform(ov, PKG_DISTINCT);
      expect(r[f]).toBe(PKG_DISTINCT[f]); // ★ fallback 到自己的 packaged 欄（非別欄）
      // 其餘欄仍採用 override 合法值（未被連累）。
      for (const other of fields) {
        if (other !== f) expect(r[other]).toBe(goodOverride[other]);
      }
    });
  }

  it('★ scaleMult / attackRangeMult 同時走 fallback → 各自回自己的 packaged（釘死兩欄不互換,PKG 1.33 vs 1.77）', () => {
    const r = resolveSecondTransform(
      { version: 1, enabled: true, scaleMult: -1, attackRangeMult: NaN }, // 兩欄皆壞
      PKG_DISTINCT,
    );
    expect(r.scaleMult).toBe(1.33); // 回自己的 packaged.scaleMult
    expect(r.attackRangeMult).toBe(1.77); // 回自己的 packaged.attackRangeMult（非 1.33）
  });

  it('全欄採用（五欄不同值）→ 各欄精確對應（讀欄不串）', () => {
    const r = resolveSecondTransform(goodOverride, PKG_DISTINCT);
    expect(r).toEqual({
      enabled: true,
      energyPerKill: 0.5,
      decayPerSec: 0.6,
      scaleMult: 2.1,
      attackRangeMult: 2.9,
    });
  });
});
