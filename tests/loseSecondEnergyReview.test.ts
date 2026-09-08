// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loseSecondEnergy, type SecondTransformState } from '@/systems/secondTransformMath';

/**
 * loseSecondEnergy 補鎖（測騎複核翼騎 a5dff87 階段3 被打倒扣的 5 測）：翼騎 5 測鑑別足
 *  —— Math.max clamp(扣超額)/amount<=0·NaN guard 壞版皆紅。
 * 兩個未鎖（跑壞版驗出）：
 *  1. ★active 不主動翻：loseSecondEnergy 把「active 態」energy 一路扣到恰 0 時,active 仍保持 true
 *     （語意：消退/解除由 decaySecondEnergy 管,loseSecondEnergy 只降 energy 不翻 active）——
 *     翼騎 active 測只扣到 0.8(未到 0),故「energy→0 時翻 active」的 mutant 不會紅。此測釘死。
 *  2. energy=0 的 no-op：翼騎測只斷 r.energy===0（Math.max 代償,故拿掉 energy<=0 guard 不紅=等價 mutant）——
 *     附帶用「回原 state 參考」把 energy<=0 早退的 no-op 語意也釘（拿掉 guard → 回新物件 → 參考不同 → 紅）。
 * 維度3 斷 energy/active/參考。與翼騎測互補。
 */
describe('loseSecondEnergy 補鎖 — active 不主動翻 + energy0 no-op 參考', () => {
  it('★ active 態 energy 扣到恰 0 → active 仍 true（不主動翻,解除交給 decay）', () => {
    const s: SecondTransformState = { energy: 0.2, active: true };
    const r = loseSecondEnergy(s, 0.2); // 0.2-0.2=0（恰 0）
    expect(r.energy).toBe(0);
    expect(r.active).toBe(true); // ★ energy 到 0 但 active 不被 loseSecondEnergy 翻掉
  });

  it('★ active 態扣超額 → energy clamp 0、active 仍 true', () => {
    const s: SecondTransformState = { energy: 0.1, active: true };
    const r = loseSecondEnergy(s, 5); // clamp 0
    expect(r.energy).toBe(0);
    expect(r.active).toBe(true); // 不主動翻
  });

  it('★ energy=0 → no-op 回原 state 參考（early-return，非造新物件）', () => {
    const s: SecondTransformState = { energy: 0, active: false };
    expect(loseSecondEnergy(s, 0.1)).toBe(s); // 同參考（拿掉 energy<=0 早退→回新物件→參考不同→紅）
  });

  it('★ active 且 energy=0 → no-op 回原 state（active 態能量已空,再被打不動)', () => {
    const s: SecondTransformState = { energy: 0, active: true };
    expect(loseSecondEnergy(s, 0.5)).toBe(s); // 同參考、active 維持 true
  });
});
