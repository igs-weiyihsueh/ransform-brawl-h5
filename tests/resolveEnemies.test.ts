// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveEnemies, defaultEnemyFile, validateEnemies } from '@/config/enemySchema';
import type { EnemyAIConfig } from '@/config/enemyConfig';

/**
 * resolveEnemies — enemies JSON 化：怪物編輯→套用→遊戲生效（翼騎 8ff26e6，src/config/enemySchema.ts 遊戲端）。
 * enemy-editor 調數值→localStorage(EDITOR_STORE_KEYS.enemies)→遊戲 getResolvedEnemies 讀 override 優先。
 * resolveEnemies 決定用 override(過 validateEnemies)還是打包預設 ENEMY_AI。
 * 簽章(讀 src 8ff26e6)：resolveEnemies(override:unknown, packaged=ENEMY_AI) →
 *   null/undefined→packaged；validateEnemies(override).ok ? override.enemies : packaged。
 * 維度3 斷 resolve 結果（用哪份）。含壞版必紅（合法 override 生效 / null fallback / 壞 override fallback）。
 * ⚠️ getResolvedEnemies cache + Enemy 建構子讀值接線屬狀態機(需 boot,翼騎 headless override 99/5 生效驗)、
 *    editorStore.loadOverride 已測——不補;resolveEnemies 純函式(用 override 還打包預設的決策)補足。
 */

/** 哨兵 packaged：可辨識回傳是否為打包預設（與 override.enemies 區分）。 */
const SENTINEL: Record<string, EnemyAIConfig> = {
  __sentinel__: defaultEnemyFile().enemies[Object.keys(defaultEnemyFile().enemies)[0]],
};

/** 合法 override（改一隻敵人 hp，用來證明「用的是 override 不是 packaged」）。 */
function validOverrideWithHp(hp: number): { file: unknown; key: string } {
  const file = defaultEnemyFile();
  const key = Object.keys(file.enemies)[0];
  file.enemies[key].hp = hp;
  return { file, key };
}

describe('resolveEnemies — override 優先 / null·壞 fallback packaged', () => {
  it('★ 合法 override（過 validateEnemies）→ 回 override.enemies（用戶編輯生效）', () => {
    const { file, key } = validOverrideWithHp(999);
    expect(validateEnemies(file).ok).toBe(true); // 前提：override 合法
    const r = resolveEnemies(file, SENTINEL);
    expect(r[key].hp).toBe(999); // 用的是 override 的值
    expect(r).not.toBe(SENTINEL); // 非回打包預設
    expect(r.__sentinel__).toBeUndefined();
  });

  it('★ override=null → 回 packaged（無 override 行為不變）', () => {
    expect(resolveEnemies(null, SENTINEL)).toBe(SENTINEL);
  });

  it('★ override=undefined → 回 packaged', () => {
    expect(resolveEnemies(undefined, SENTINEL)).toBe(SENTINEL);
  });

  it('★ override 壞（validate 失敗：缺欄位/型別錯）→ 回 packaged（fallback 不用壞資料）', () => {
    // 前提：確為壞資料。
    const bad1 = { version: 1, enemies: { X: { hp: 'not a number' } } };
    expect(validateEnemies(bad1).ok).toBe(false);
    expect(resolveEnemies(bad1, SENTINEL)).toBe(SENTINEL);

    // 結構壞（非物件 / 缺 enemies）也 fallback。
    expect(resolveEnemies({ version: 1 }, SENTINEL)).toBe(SENTINEL);
    expect(resolveEnemies('garbage', SENTINEL)).toBe(SENTINEL);
    expect(resolveEnemies(123, SENTINEL)).toBe(SENTINEL);
  });

  it('override 合法但 hp 不同值 → 各自回該值（不是恆 packaged）', () => {
    const a = validOverrideWithHp(50);
    const b = validOverrideWithHp(200);
    expect(resolveEnemies(a.file, SENTINEL)[a.key].hp).toBe(50);
    expect(resolveEnemies(b.file, SENTINEL)[b.key].hp).toBe(200);
  });

  it('預設 packaged = ENEMY_AI（不傳 packaged 時，null → 回打包預設非空）', () => {
    const r = resolveEnemies(null); // 用預設 ENEMY_AI
    expect(Object.keys(r).length).toBeGreaterThan(0);
  });
});
