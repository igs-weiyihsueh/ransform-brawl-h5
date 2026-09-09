// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveEnemies, defaultEnemyFile, validateEnemies } from '@/config/enemySchema';
import type { EnemyAIConfig } from '@/config/enemyConfig';

/**
 * resolveEnemies — enemies JSON 化：怪物編輯→套用→遊戲生效（翼騎 8ff26e6，src/config/enemySchema.ts 遊戲端）。
 * enemy-editor 調數值→localStorage(EDITOR_STORE_KEYS.enemies)→遊戲 getResolvedEnemies 讀 override 優先。
 * ★行為變更（用戶爆氣真因修）：override 從「整個 replace 打包預設」改成 **merge**——
 *   打包預設打底 + override 有的怪覆蓋、override 沒有的怪保留預設（`{...packaged, ...override.enemies}`）。
 *   根治：舊 localStorage override（沒有新怪如 Enemy_Tower）不再把 Enemy_Tower 整個蓋掉消失→塔退成小兵。
 * 簽章：resolveEnemies(override:unknown, packaged=ENEMY_AI) →
 *   null/undefined/validate 失敗→packaged；合法→{...packaged, ...override.enemies}（per-enemy key 層 shallow merge）。
 * 維度3 斷 merge 結果（override 覆蓋的 key 用 override、packaged-only 的 key 保留）。含壞版必紅。
 * ⚠️ getResolvedEnemies cache + Enemy 建構子讀值接線屬狀態機(需 boot,翼騎 headless 驗)、editorStore.loadOverride 已測——不補。
 */

/** 哨兵 packaged：__sentinel__ 是「只有 packaged 有、override 沒有」的 key，用來驗 merge 保留 packaged-only key。 */
const SENTINEL: Record<string, EnemyAIConfig> = {
  __sentinel__: defaultEnemyFile().enemies[Object.keys(defaultEnemyFile().enemies)[0]],
};

/** 合法 override（改一隻敵人 hp，用來證明「override 有的怪用 override 值」）。 */
function validOverrideWithHp(hp: number): { file: unknown; key: string } {
  const file = defaultEnemyFile();
  const key = Object.keys(file.enemies)[0];
  file.enemies[key].hp = hp;
  return { file, key };
}

describe('resolveEnemies — merge 語意（override 覆蓋有的、保留 packaged-only）/ null·壞 fallback packaged', () => {
  it('★ 合法 override → merge：override 有的 key 用 override 值、packaged-only 的 key 保留', () => {
    const { file, key } = validOverrideWithHp(999);
    expect(validateEnemies(file).ok).toBe(true); // 前提：override 合法
    const r = resolveEnemies(file, SENTINEL);
    expect(r[key].hp).toBe(999); // override 有 → 用 override 的值
    // ★merge 核心：packaged 有但 override 沒有的 __sentinel__ 應【保留】（舊 replace 會消失）。
    expect(r.__sentinel__).toBeDefined();
    expect(r.__sentinel__).toBe(SENTINEL.__sentinel__); // 原封保留 packaged 那份
  });

  it('★★ merge 修核心防退回 replace：packaged 有 Enemy_Tower、override 沒有 → 結果仍含 Enemy_Tower', () => {
    // 這正是用戶爆氣真因：舊 override 沒 Enemy_Tower，replace 語意會把塔蓋掉→退小兵。
    const tower = defaultEnemyFile().enemies[Object.keys(defaultEnemyFile().enemies)[0]];
    const packaged: Record<string, EnemyAIConfig> = { Enemy_Tower: tower, Enemy_Small: tower };
    // override 只改 Enemy_Small，完全沒提 Enemy_Tower。
    const overrideFile = defaultEnemyFile();
    const okey = Object.keys(overrideFile.enemies)[0];
    overrideFile.enemies = { Enemy_Small: overrideFile.enemies[okey] };
    expect(validateEnemies(overrideFile).ok).toBe(true);
    const r = resolveEnemies(overrideFile, packaged);
    expect(r.Enemy_Tower).toBeDefined(); // ★塔保留（merge 不整個 replace）——防退回 replace 的守衛
    expect(r.Enemy_Tower).toBe(tower); // 原封 packaged 那份
    expect(r.Enemy_Small).toBeDefined(); // override 有的也在
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

  it('override 合法但 hp 不同值 → override 該怪各自回該值（merge 覆蓋值正確）', () => {
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
