// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveGuardDrip, GUARD_PRESETS } from '@/config/guardConfig';
import { validateLevels, LEVELS_SCHEMA_VERSION } from '@/config/levelSchema';

/**
 * 守護補怪 drip 搬節點（用戶七輪，翼騎 b9451e1，additive）：
 *  1. resolveGuardDrip(node, preset)：per-node 覆蓋 preset 補怪設定(node.X ?? preset.X，0-safe)。
 *  2. validateLevels — EventNodeData optional drip(maxAlive?/spawnThreshold?/spawnInterval?/spawns?，additive)。
 * 簽章(讀 src b9451e1)：resolveGuardDrip → GuardDrip{maxAlive,spawnThreshold,spawnInterval,spawns}，spawns 非空用 node 否則 preset。
 *   validateEventDrip：posInt(undefined 跳過/非數字擋/負擋/0 過)、spawns optional(空陣列擋/enemyType 非空字串過含未知名/weight>0)。
 * 維度3 斷 drip 解析 + validate 過擋。含壞版必紅（★0-nullish / 覆蓋生效 / spawns / additive / 空敵種擋）。
 * ⚠️ WaveSystem/GuardEvent 消費 drip 接線屬狀態機(需 boot,翼騎 headless 驗)——不補;resolveGuardDrip/validate 純函式補足。
 */
const PRESET = GUARD_PRESETS.Guard60; // maxAlive6/spawnThreshold4/spawnInterval1.0/spawns

describe('resolveGuardDrip — per-node 覆蓋 preset（node.X ?? preset.X，0-safe）', () => {
  it('無 node override（undefined）→ 全沿用 preset（4 欄＝preset）', () => {
    const d = resolveGuardDrip(undefined, PRESET);
    expect(d.maxAlive).toBe(PRESET.maxAlive);
    expect(d.spawnThreshold).toBe(PRESET.spawnThreshold);
    expect(d.spawnInterval).toBe(PRESET.spawnInterval);
    expect(d.spawns).toBe(PRESET.spawns);
  });

  it('部分覆蓋：node.maxAlive=10 覆蓋、未給 spawnInterval 沿用 preset', () => {
    const d = resolveGuardDrip({ maxAlive: 10 }, PRESET);
    expect(d.maxAlive).toBe(10); // 覆蓋
    expect(d.spawnInterval).toBe(PRESET.spawnInterval); // 沿用
    expect(d.spawnThreshold).toBe(PRESET.spawnThreshold);
  });

  it('★ 0-nullish：node.spawnThreshold=0 / maxAlive=0 → 用 0（?? 非 ||，不被 preset 蓋）', () => {
    const d = resolveGuardDrip({ spawnThreshold: 0, maxAlive: 0, spawnInterval: 0 }, PRESET);
    expect(d.spawnThreshold).toBe(0); // 非 preset 4
    expect(d.maxAlive).toBe(0); // 非 preset 6
    expect(d.spawnInterval).toBe(0); // 非 preset 1.0
  });

  it('spawns：node.spawns 非空 → 用 node；空陣列/省略 → 用 preset.spawns', () => {
    const custom = [{ enemyType: 'Enemy_Rush', weight: 2 }];
    expect(resolveGuardDrip({ spawns: custom }, PRESET).spawns).toBe(custom); // 非空用 node
    expect(resolveGuardDrip({ spawns: [] }, PRESET).spawns).toBe(PRESET.spawns); // 空 → preset
    expect(resolveGuardDrip({}, PRESET).spawns).toBe(PRESET.spawns); // 省略 → preset
  });
});

/** 合法關卡檔（Event 節點可加 optional drip）。 */
function fileWithEventDrip(drip?: Record<string, unknown>): unknown {
  const eventNode: Record<string, unknown> = { nodeType: 'Event', eventPresetName: 'Guard60', ...drip };
  return {
    version: LEVELS_SCHEMA_VERSION,
    levels: [
      {
        id: 'level-1',
        nodes: [
          { nodeType: 'Spawn', killQuota: 10, maxAlive: 5, spawnThreshold: 3, spawnInterval: 1.5, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }] },
          eventNode,
        ],
      },
    ],
  };
}
const okOf = (f: unknown) => validateLevels(f).ok;
const errsOf = (f: unknown) => { const r = validateLevels(f); return r.ok ? [] : r.errors; };
const mentions = (errs: string[], t: string) => errs.some((e) => e.includes(t));

describe('validateLevels — EventNodeData optional drip（additive）', () => {
  it('★ Event 無 drip（只 eventPresetName）→ 過（additive 相容,沿用 preset 行為不變）', () => {
    expect(okOf(fileWithEventDrip())).toBe(true);
  });

  it('Event 有合法 drip（maxAlive:8, spawnThreshold:0, spawns 合法）→ 過（★spawnThreshold=0 合法）', () => {
    expect(okOf(fileWithEventDrip({ maxAlive: 8, spawnThreshold: 0, spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }] }))).toBe(true);
  });

  it('Event drip maxAlive 非數字（"x"）→ 擋', () => {
    expect(mentions(errsOf(fileWithEventDrip({ maxAlive: 'x' })), 'maxAlive')).toBe(true);
  });

  it('Event drip maxAlive 負數 → 擋', () => {
    expect(mentions(errsOf(fileWithEventDrip({ maxAlive: -1 })), 'maxAlive')).toBe(true);
  });

  it('Event drip spawns 空敵種（enemyType:""）→ 擋', () => {
    const errs = errsOf(fileWithEventDrip({ spawns: [{ enemyType: '', weight: 1 }] }));
    expect(mentions(errs, 'enemyType')).toBe(true);
  });

  it('★ Event drip 未知敵種（"Enemy_NewBoss"）→ 過（軟白名單,合法性交遊戲端,同敵種動態化）', () => {
    expect(okOf(fileWithEventDrip({ spawns: [{ enemyType: 'Enemy_NewBoss', weight: 1 }] }))).toBe(true);
  });

  it('Event drip spawns 空陣列 → 擋（若提供至少一種）', () => {
    expect(okOf(fileWithEventDrip({ spawns: [] }))).toBe(false);
  });
});
