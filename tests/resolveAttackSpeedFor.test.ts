// @vitest-environment node
import { describe, expect, it } from 'vitest';
// ⚠️ 對著波騎 af5986a 預期簽章預寫（resolveAttackSpeedFor per-char 尚未 land）。land 後讀 src 校準簽章/形狀/version/byChar 欄名再 push。
import {
  resolveAttackSpeedFor,
  validateAttackSpeed,
} from '@/config/attackSpeedSchema';

/**
 * attackSpeedSchema — 攻速 per-character（用戶要各角色各自，波騎 af5986a，additive）。
 * 全域單一 mult → byChar Record<charKey, mult>（Human/SunWukong 各一）。
 * resolveAttackSpeedFor(charKey, override) 取值序：byChar[charKey] ?? 舊 mult(相容) ?? 1.0
 *   → { mult, cooldown: base/mult, hitDelay: base/mult, animTimeScale: mult }。
 * ★mult 仍 scale 語意（>0，0/負不合法，非 chest/dash 0-合法）。
 * 舊全域 resolveAttackSpeed 簽章波騎保留、既有測不動；本檔補新 per-char。
 * 維度3 斷 per-char 取值 + 相容 fallback 序 + 連動。含壞版必紅(沒 per-char/沒相容舊 mult/mult>0 沒擋)。
 * ⚠️ 遊戲端 per-char 套 cooldown/anim timeScale 接線屬狀態機(需 boot,翼騎 headless 驗)——不補。
 */

const BASE_CD = 0.333;
const BASE_HD = 0.1;

/** per-char 格式 override（帶 version）。 */
function byCharFile(byChar: Record<string, number>): unknown {
  return { version: 1, byChar };
}
/** 舊全域格式 override（無 byChar，只 mult）。 */
function legacyFile(mult: number): unknown {
  return { version: 1, mult };
}

describe('resolveAttackSpeedFor — per-character 攻速倍率', () => {
  it('★ byChar per-char：Human=1.5 / SunWukong=2 各取各的', () => {
    const ov = byCharFile({ Human: 1.5, SunWukong: 2 });
    expect(resolveAttackSpeedFor('Human', ov).mult).toBe(1.5);
    expect(resolveAttackSpeedFor('SunWukong', ov).mult).toBe(2);
  });

  it('缺角色 → 該角色 mult=1.0（byChar 沒該 key fallback）', () => {
    const ov = byCharFile({ Human: 1.5 }); // 無 SunWukong
    expect(resolveAttackSpeedFor('SunWukong', ov).mult).toBe(1);
  });

  it('★ 舊格式相容：舊 {mult:1.8}（無 byChar）→ 任何 charKey 都 1.8（全角色共用舊值）', () => {
    const ov = legacyFile(1.8);
    expect(resolveAttackSpeedFor('Human', ov).mult).toBe(1.8);
    expect(resolveAttackSpeedFor('SunWukong', ov).mult).toBe(1.8);
  });

  it('★ 取值序：byChar[charKey] > 舊 mult > 1.0（byChar 有該角色時蓋過舊 mult）', () => {
    // 同時有 byChar 和舊 mult：byChar 有的角色取 byChar，沒有的角色退舊 mult。
    const ov = { version: 1, mult: 1.8, byChar: { Human: 1.5 } };
    expect(resolveAttackSpeedFor('Human', ov).mult).toBe(1.5); // byChar 優先
    expect(resolveAttackSpeedFor('SunWukong', ov).mult).toBe(1.8); // byChar 缺 → 退舊 mult
  });

  it('null/undefined/壞/version 錯 override → mult=1.0（行為不變）', () => {
    expect(resolveAttackSpeedFor('Human', null).mult).toBe(1);
    expect(resolveAttackSpeedFor('Human', undefined).mult).toBe(1);
    expect(resolveAttackSpeedFor('Human', { garbage: true } as unknown).mult).toBe(1);
    expect(resolveAttackSpeedFor('Human', { version: 2, byChar: { Human: 2 } } as unknown).mult).toBe(1);
  });

  it('連動：byChar Human=2 → cooldown=base/2、hitDelay=base/2、anim=2', () => {
    const r = resolveAttackSpeedFor('Human', byCharFile({ Human: 2 }), BASE_CD, BASE_HD);
    expect(r.cooldown).toBeCloseTo(0.333 / 2);
    expect(r.hitDelay).toBeCloseTo(0.1 / 2);
    expect(r.animTimeScale).toBe(2);
  });

  it('★ 方向鎖：byChar 倍率大 → 冷卻小（Human=2 cooldown < 缺角色 1.0 cooldown）', () => {
    const ov = byCharFile({ Human: 2 });
    const fast = resolveAttackSpeedFor('Human', ov, BASE_CD, BASE_HD).cooldown;
    const normal = resolveAttackSpeedFor('SunWukong', ov, BASE_CD, BASE_HD).cooldown; // 缺→1.0
    expect(fast).toBeLessThan(normal);
  });
});

describe('validateAttackSpeed — ★mult/byChar 值 >0（scale 語意，0/負擋）', () => {
  it('byChar 某值=0 → 擋', () => {
    expect(validateAttackSpeed(byCharFile({ Human: 0 })).ok).toBe(false);
  });
  it('byChar 某值=負 → 擋', () => {
    expect(validateAttackSpeed(byCharFile({ Human: -1 })).ok).toBe(false);
  });
  it('byChar 正常值 → ok', () => {
    expect(validateAttackSpeed(byCharFile({ Human: 1.5, SunWukong: 2 })).ok).toBe(true);
  });
  it('舊 mult=0 → 擋（相容格式也守 >0）', () => {
    expect(validateAttackSpeed(legacyFile(0)).ok).toBe(false);
  });
});
