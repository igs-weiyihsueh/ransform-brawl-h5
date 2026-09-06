// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateLevels, LEVELS_SCHEMA_VERSION } from '@/config/levelSchema';
import { resolveNodeFireRain } from '@/config/fireRainConfig';

/**
 * 六輪#1 守護事件火雨 editor per-node 三態（翼騎 d0d1b6f，整合波騎）。
 *  A. validate EventNodeData.attachFireRain(levelSchema,經 validateLevels)：省略/'none'/preset名過、空字串/非字串擋。
 *  B. resolveNodeFireRain(raw, presetDefault) 純函式(fireRainConfig)：★undefined→presetDefault(沿用)/★'none'→null(明確無)/其餘→raw。
 * 維度3 斷過擋/三態值。含壞版必紅。零遊戲依賴(validate 只驗非空字串,不交叉比對 preset 表)。
 * ⚠️ WaveSystem 守護分支接線(讀 node.attachFireRain 注入)屬狀態機(需 boot,翼騎 headless 三態注入驗過)、
 *    editor 下拉屬互動(波騎)——不補;resolveNodeFireRain + validate 補足。
 */

/** 合法關卡檔（Event 節點含可選 attachFireRain）。 */
function fileWithEventFireRain(attach?: unknown): unknown {
  const eventNode: Record<string, unknown> = { nodeType: 'Event', eventPresetName: 'Guard60' };
  if (attach !== undefined) eventNode.attachFireRain = attach;
  return {
    version: LEVELS_SCHEMA_VERSION,
    levels: [
      {
        id: 'level-1',
        nodes: [
          {
            nodeType: 'Spawn',
            killQuota: 10,
            maxAlive: 5,
            spawnThreshold: 3,
            spawnInterval: 1.5,
            spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }],
          },
          eventNode,
        ],
      },
    ],
  };
}
function errorsOf(raw: unknown): string[] {
  const r = validateLevels(raw);
  return r.ok ? [] : r.errors;
}
function mentions(errs: string[], token: string): boolean {
  return errs.some((e) => e.includes(token));
}

describe('A. validate EventNodeData.attachFireRain — 三態 optional（非空字串或省略）', () => {
  it('省略/undefined → 過（沿用 preset，additive 相容）', () => {
    expect(validateLevels(fileWithEventFireRain(undefined)).ok).toBe(true);
  });

  it("★ 'none' → 過（明確無火雨，非空字串合法）", () => {
    expect(validateLevels(fileWithEventFireRain('none')).ok).toBe(true);
  });

  it('preset 名（FireRain / FireRainLight / FireRainHeavy）→ 過', () => {
    for (const p of ['FireRain', 'FireRainLight', 'FireRainHeavy']) {
      expect(validateLevels(fileWithEventFireRain(p)).ok).toBe(true);
    }
  });

  it("空字串 '' → 擋（attachFireRain 提到）", () => {
    expect(mentions(errorsOf(fileWithEventFireRain('')), 'attachFireRain')).toBe(true);
  });

  it('非字串（123）→ 擋', () => {
    expect(mentions(errorsOf(fileWithEventFireRain(123)), 'attachFireRain')).toBe(true);
  });
});

describe('B. resolveNodeFireRain — 三態解析（editor 選什麼→遊戲對應）', () => {
  it('★ undefined → presetDefault（沿用 preset 預設）', () => {
    expect(resolveNodeFireRain(undefined, 'FireRain')).toBe('FireRain');
    expect(resolveNodeFireRain(undefined, undefined)).toBeNull(); // preset 也無 → null
  });

  it("★ 'none' → null（明確無火雨，蓋掉 preset）", () => {
    expect(resolveNodeFireRain('none', 'FireRain')).toBeNull(); // 蓋掉 preset 預設
    expect(resolveNodeFireRain('none', undefined)).toBeNull();
  });

  it('其餘（preset 名）→ raw（指定，覆蓋 preset）', () => {
    expect(resolveNodeFireRain('FireRainHeavy', 'FireRain')).toBe('FireRainHeavy');
    expect(resolveNodeFireRain('FireRainLight', undefined)).toBe('FireRainLight');
  });

  it('三態完整：undefined沿用 / none蓋成null / 具名覆蓋 — 互不混淆', () => {
    expect(resolveNodeFireRain(undefined, 'P')).toBe('P'); // 沿用
    expect(resolveNodeFireRain('none', 'P')).toBeNull(); // 明確無（非回 'P'）
    expect(resolveNodeFireRain('Q', 'P')).toBe('Q'); // 指定（非 'P'、非 null）
  });
});
