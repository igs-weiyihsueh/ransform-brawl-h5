// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveSkills, defaultSkillFile, validateSkills } from '@/config/skillSchema';
import type { CharacterCombatProfile } from '@/config/skillConfig';

/**
 * resolveSkills — skills JSON 化：招式編輯→套用→遊戲生效（翼騎 b4ea21c，src/config/skillSchema.ts 遊戲端）。
 * 同 resolveEnemies 模式：skill-editor 調招式→localStorage(EDITOR_STORE_KEYS.skills)→遊戲 getResolvedSkills 讀 override 優先。
 * ★行為變更（用戶爆氣真因根治，同 resolveEnemies）：override 從「整個 replace 打包預設」改成 **merge**——
 *   打包預設打底 + override 有的角色覆蓋、override 沒有的角色保留預設（`{...packaged, ...override.characters}`）。
 *   根治：舊 localStorage override（沒有新角色技能）不再把新角色整個蓋掉消失。
 * 簽章：resolveSkills(override:unknown, packaged=CHARACTER_COMBAT) →
 *   null/undefined/validate 失敗→packaged；合法→{...packaged, ...override.characters}（per-character key 層 shallow merge）。
 * 維度3 斷 merge 結果（override 覆蓋的 key 用 override、packaged-only 的 key 保留）。含壞版必紅。
 * ⚠️ getResolvedSkills cache + getCombatProfile 接線屬狀態機(需 boot,翼騎 headless 驗)、editorStore.loadOverride/validateSkills 已測——不補。
 * ★ 匯入機制純函式層最後一塊(editorStore + resolveEnemies + resolveSkills 全測到)。
 */

/** 哨兵 packaged：__sentinel__ 是「只有 packaged 有、override 沒有」的 key，用來驗 merge 保留 packaged-only key。 */
const SENTINEL: Record<string, CharacterCombatProfile> = {
  __sentinel__: defaultSkillFile().characters[Object.keys(defaultSkillFile().characters)[0]],
};

/** 合法 override（改一角 energyCap，用來證明「override 有的角色用 override 值」）。 */
function validOverrideWithCap(cap: number): { file: unknown; key: string } {
  const file = defaultSkillFile();
  const key = Object.keys(file.characters)[0];
  file.characters[key].energyCap = cap;
  return { file, key };
}

describe('resolveSkills — merge 語意（override 覆蓋有的、保留 packaged-only）/ null·壞 fallback packaged', () => {
  it('★ 合法 override → merge：override 有的 key 用 override 值、packaged-only 的 key 保留', () => {
    const { file, key } = validOverrideWithCap(999);
    expect(validateSkills(file).ok).toBe(true); // 前提：override 合法
    const r = resolveSkills(file, SENTINEL);
    expect(r[key].energyCap).toBe(999); // override 有 → 用 override 的值
    // ★merge 核心：packaged 有但 override 沒有的 __sentinel__ 應【保留】（舊 replace 會消失）。
    expect(r.__sentinel__).toBeDefined();
    expect(r.__sentinel__).toBe(SENTINEL.__sentinel__); // 原封保留 packaged 那份
  });

  it('★★ merge 修核心防退回 replace：packaged 有新角色、override 沒有 → 結果仍含該角色', () => {
    // 同 enemies 真因：舊 override 沒新角色技能，replace 語意會把它蓋掉消失。
    const prof = defaultSkillFile().characters[Object.keys(defaultSkillFile().characters)[0]];
    const packaged: Record<string, CharacterCombatProfile> = { NewHero: prof, OldHero: prof };
    // override 只改 OldHero，完全沒提 NewHero。
    const overrideFile = defaultSkillFile();
    const okey = Object.keys(overrideFile.characters)[0];
    overrideFile.characters = { OldHero: overrideFile.characters[okey] };
    expect(validateSkills(overrideFile).ok).toBe(true);
    const r = resolveSkills(overrideFile, packaged);
    expect(r.NewHero).toBeDefined(); // ★新角色保留（merge 不整個 replace）——防退回 replace 的守衛
    expect(r.NewHero).toBe(prof); // 原封 packaged 那份
    expect(r.OldHero).toBeDefined(); // override 有的也在
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

  it('override 合法但 energyCap 不同值 → override 該角各自回該值（merge 覆蓋值正確）', () => {
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
