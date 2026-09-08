import { describe, expect, it } from 'vitest';
import {
  resolveSecondTransform,
  type ResolvedSecondTransform,
} from '@/config/secondTransformSchema';

/**
 * resolveSecondTransform 複核補強（測騎複核翼騎 4c6a137→02706e3）：翼騎測鑑別足
 *  —— 讀欄 crosstalk、posNum/fillNum 守衛、fallback crosstalk、function-with-props 物件守衛皆已鎖。
 * 本檔專攻 fallback 串欄：用「各欄全不同值」PKG（尤其 scaleMult ≠ attackRangeMult、fillThreshold 各不同），
 *  逐欄單獨走 fallback,釘死 fallback 不誤讀他欄（A↔B fallback 互換 mutant 在 A/B 值相同時不可鑑別 → 故 PKG 各欄不同）。
 * sync 02706e3：ResolvedSecondTransform 加必填 fillThreshold（ratio (0,1]），PKG_DISTINCT/goodOverride/toEqual 補上。
 * 維度3 斷各欄值。與翼騎測互補。
 */

/** ★關鍵：各欄值全不同（尤其 scaleMult ≠ attackRangeMult），才能抓 fallback 串欄。fillThreshold 用 (0,1] 內的不同值。 */
const PKG_DISTINCT: ResolvedSecondTransform = {
  enabled: false,
  energyPerKill: 0.11,
  decayPerSec: 0.22,
  scaleMult: 1.33,
  attackRangeMult: 1.77, // ≠ scaleMult
  fillThreshold: 0.44, // ratio (0,1]，與他欄不同值（sync 02706e3 新欄）
};

describe('resolveSecondTransform — 逐欄 fallback 不串欄（各欄不同值 PKG）', () => {
  // 逐欄：只讓「該欄」壞（觸發 fallback），其餘給合法值（採用），驗該欄 fallback 到「自己的」packaged 欄。
  const goodOverride = {
    version: 1,
    enabled: true,
    energyPerKill: 0.5,
    decayPerSec: 0.6,
    scaleMult: 2.1,
    attackRangeMult: 2.9,
    fillThreshold: 0.88, // (0,1] 合法（fillNum 上限 1）
  };
  const fields: (keyof ResolvedSecondTransform)[] = ['energyPerKill', 'decayPerSec', 'scaleMult', 'attackRangeMult', 'fillThreshold'];

  for (const f of fields) {
    it(`★ 只有 ${f} 壞(0) → 該欄 fallback 到 packaged.${f}（不串到別欄）`, () => {
      const ov: Record<string, unknown> = { ...goodOverride, [f]: 0 }; // 只這欄壞（0：posNum/fillNum 皆拒）
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

  it('★ fillThreshold 壞值 >1(1.5) → fallback packaged（fillNum 上限 1，不串他欄）', () => {
    const r = resolveSecondTransform({ version: 1, enabled: true, fillThreshold: 1.5 }, PKG_DISTINCT);
    expect(r.fillThreshold).toBe(PKG_DISTINCT.fillThreshold); // 0.44，回自己的 packaged（非他欄）
  });

  it('全欄採用（各欄不同值）→ 各欄精確對應（讀欄不串）', () => {
    const r = resolveSecondTransform(goodOverride, PKG_DISTINCT);
    expect(r).toEqual({
      enabled: true,
      energyPerKill: 0.5,
      decayPerSec: 0.6,
      scaleMult: 2.1,
      attackRangeMult: 2.9,
      fillThreshold: 0.88,
    });
  });
});
