// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveSkills, defaultSkillFile, validateSkills } from '@/config/skillSchema';
import type { CharacterCombatProfile } from '@/config/skillConfig';

/**
 * resolveSkills — skills JSON 化：招式編輯→套用→遊戲生效（翼騎 b4ea21c，src/config/skillSchema.ts 遊戲端）。
 * 同 resolveEnemies 模式：skill-editor 調招式→localStorage(EDITOR_STORE_KEYS.skills)→遊戲 getResolvedSkills 讀 override 優先。
 * 簽章(讀 src b4ea21c)：resolveSkills(override:unknown, packaged=CHARACTER_COMBAT) →
 *   null/undefined→packaged；validateSkills(override).ok ? override.characters : packaged。
 * 維度3 斷 resolve 結果（用哪份，哨兵 packaged 區分）。含壞版必紅（合法生效 / null fallback / 壞 fallback）。
 * ⚠️ getResolvedSkills cache + getCombatProfile 接線屬狀態機(需 boot,翼騎 headless override 生效驗)、
 *    editorStore.loadOverride/validateSkills 已測——不補;resolveSkills 純函式(用 override 還打包預設的決策)補足。
 * ★ 匯入機制純函式層最後一塊(editorStore + resolveEnemies + resolveSkills 全測到)。
 */

/** 哨兵 packaged：可辨識回傳是否為打包預設。 */
const SENTINEL: Record<string, CharacterCombatProfile> = {
  __sentinel__: defaultSkillFile().characters[Object.keys(defaultSkillFile().characters)[0]],
};

/** 合法 override（改一角 energyCap，用來證明「用的是 override 不是 packaged」）。 */
function validOverrideWithCap(cap: number): { file: unknown; key: string } {
  const file = defaultSkillFile();
  const key = Object.keys(file.characters)[0];
  file.characters[key].energyCap = cap;
  return { file, key };
}

describe('resolveSkills — override 優先 / null·壞 fallback packaged（同 resolveEnemies）', () => {
  it('★ 合法 override（過 validateSkills）→ 回 override.characters（招式編輯生效）', () => {
    const { file, key } = validOverrideWithCap(999);
    expect(validateSkills(file).ok).toBe(true); // 前提：override 合法
    const r = resolveSkills(file, SENTINEL);
    expect(r[key].energyCap).toBe(999); // 用的是 override 的值
    expect(r).not.toBe(SENTINEL);
    expect(r.__sentinel__).toBeUndefined();
  });

  it('★ override=null → 回 packaged（無 override 行為不變）', () => {
    expect(resolveSkills(null, SENTINEL)).toBe(SENTINEL);
  });

  it('★ override=undefined → 回 packaged', () => {
    expect(resolveSkills(undefined, SENTINEL)).toBe(SENTINEL);
  });

  it('★ override 壞（validate 失敗：energyCap 型別錯/缺 characters/非物件）→ 回 packaged（不吃壞資料）', () => {
    // energyCap 型別錯（前置斷確為壞）。
    const bad = defaultSkillFile();
    const k = Object.keys(bad.characters)[0];
    (bad.characters[k] as unknown as Record<string, unknown>).energyCap = 'not a number';
    expect(validateSkills(bad).ok).toBe(false);
    expect(resolveSkills(bad, SENTINEL)).toBe(SENTINEL);

    // 結構壞：缺 characters / 非物件 / characters 空。
    expect(resolveSkills({ version: 1 }, SENTINEL)).toBe(SENTINEL);
    expect(resolveSkills({ version: 1, characters: {} }, SENTINEL)).toBe(SENTINEL); // 空
    expect(resolveSkills('garbage', SENTINEL)).toBe(SENTINEL);
    expect(resolveSkills(123, SENTINEL)).toBe(SENTINEL);
  });

  it('override 合法但 energyCap 不同值 → 各自回該值（非恆 packaged）', () => {
    const a = validOverrideWithCap(50);
    const b = validOverrideWithCap(200);
    expect(resolveSkills(a.file, SENTINEL)[a.key].energyCap).toBe(50);
    expect(resolveSkills(b.file, SENTINEL)[b.key].energyCap).toBe(200);
  });

  it('預設 packaged = CHARACTER_COMBAT（不傳 packaged 時，null → 回打包預設非空）', () => {
    const r = resolveSkills(null);
    expect(Object.keys(r).length).toBeGreaterThan(0);
  });
});
