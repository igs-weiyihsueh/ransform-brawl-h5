/**
 * levelSchema.validateLevels 單元測試 — QA（測騎）維護。
 *
 * 涵蓋邊界（誠實說明）：
 *   ✅ 證明 validateLevels 這隻【純驗證函式】對合法檔放行、對各類壞檔各自抓錯，
 *      且錯誤能定位到「正確的欄位」。
 *   ❌ 不證明遊戲畫面、手感、WaveSystem 實際生怪行為正確 —— 那些需 boot smoke / E2E。
 *   ❌ 不驗證 JSON 檔在 runtime 真的被載入（那是 levelLoader 的責任，另測）。
 *
 * 撰寫約束（架構顧問變身-leader 規範）：
 *   - 不 assert 錯誤訊息的【中文字面】（那是給人看、日後會潤字的 presentation）。
 *   - 改驗「錯誤數量」或「錯誤是否針對某欄位」。
 *   - 「針對某欄位」= 比對錯誤字串是否含該欄位的【英文 enum/欄位識別碼】
 *     （version / levels / nodeType / enemyType / spawnThreshold / maxAlive /
 *      killQuota / spawnInterval / eventPresetName / spawns / id / weight）。
 *     這些英文 token 是共用契約的機器識別碼，不隨中文潤字改動。
 */

import { describe, it, expect } from 'vitest';
import {
  validateLevels,
  assertValidLevels,
  LevelValidationError,
  LEVELS_SCHEMA_VERSION,
  type LevelsFile,
} from '../src/config/levelSchema';

// ---------------------------------------------------------------------------
// 測試輔助：以「合法基準檔」為陽性對照，複製後只改壞一處 → 產生各壞檔。
// 這樣每個壞檔測試都能對比同一個「本來會過」的基準，凸顯鑑別力。
// ---------------------------------------------------------------------------

/** 深拷貝（測試資料皆為單純 JSON，structuredClone 足夠）。 */
function clone<T>(v: T): T {
  return structuredClone(v);
}

/** 產生一份合法的 LevelsFile（陽性對照基準）。 */
function makeValidFile(): LevelsFile {
  return {
    version: LEVELS_SCHEMA_VERSION,
    levels: [
      {
        id: 'level-1',
        name: '第一關',
        nodes: [
          {
            nodeType: 'Spawn',
            killQuota: 10,
            maxAlive: 5,
            spawnThreshold: 3,
            spawnInterval: 1.5,
            spawns: [
              { enemyType: 'Enemy_Rush', weight: 2 },
              { enemyType: 'Enemy_Ranged', weight: 1 },
            ],
          },
          { nodeType: 'Reward', rewardPresetName: 'coin-pack' },
          { nodeType: 'Event', eventPresetName: 'Guard60' },
        ],
      },
      {
        id: 'level-2',
        nodes: [
          {
            nodeType: 'Spawn',
            killQuota: 20,
            maxAlive: 8,
            spawnThreshold: 4,
            spawnInterval: 1,
            spawns: [{ enemyType: 'Enemy_Elite', weight: 1 }],
          },
        ],
      },
    ],
  };
}

/** 便捷：驗證並取回 errors（非 ok 時）；ok 時回空陣列以利斷言數量=0。 */
function errorsOf(raw: unknown): string[] {
  const r = validateLevels(raw);
  return r.ok ? [] : r.errors;
}

/** 便捷：所有錯誤字串是否「至少一條」提到某英文欄位 token。 */
function mentionsField(errors: string[], field: string): boolean {
  return errors.some((e) => e.includes(field));
}

/** 便捷：拿第一個 Spawn 節點的引用（測試改壞用）。 */
function firstSpawnNode(file: LevelsFile): Record<string, unknown> {
  return file.levels[0].nodes[0] as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 陽性對照：合法檔必須通過（若這裡紅了，代表基準本身壞了，其他壞檔測試失去意義）。
// ---------------------------------------------------------------------------

describe('validateLevels — 陽性對照（合法檔放行）', () => {
  it('完整合法檔 → ok:true 且 0 錯誤', () => {
    const r = validateLevels(makeValidFile());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.levels).toHaveLength(2);
      expect(r.data.version).toBe(LEVELS_SCHEMA_VERSION);
    }
  });

  it('只含最小 Spawn 關的合法檔 → 通過', () => {
    const minimal: LevelsFile = {
      version: LEVELS_SCHEMA_VERSION,
      levels: [
        {
          id: 'only',
          nodes: [
            {
              nodeType: 'Spawn',
              killQuota: 1,
              maxAlive: 1,
              spawnThreshold: 1,
              spawnInterval: 1,
              spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }],
            },
          ],
        },
      ],
    };
    expect(validateLevels(minimal).ok).toBe(true);
  });

  it('name 為 optional：不提供仍通過', () => {
    const f = makeValidFile();
    delete (f.levels[0] as { name?: string }).name;
    expect(validateLevels(f).ok).toBe(true);
  });

  it('spawnThreshold == maxAlive（邊界，允許）→ 通過', () => {
    const f = makeValidFile();
    const node = firstSpawnNode(f);
    node.maxAlive = 5;
    node.spawnThreshold = 5; // 等於，非大於 → 不應報錯
    expect(validateLevels(f).ok).toBe(true);
  });

  it('assertValidLevels 對合法檔回傳收斂型別、不拋例外', () => {
    const data = assertValidLevels(makeValidFile());
    expect(data.levels[0].id).toBe('level-1');
  });
});

// ---------------------------------------------------------------------------
// 根層級 / version / levels
// ---------------------------------------------------------------------------

describe('validateLevels — 根層級與 version/levels', () => {
  it('非物件（null）→ 有錯誤，不通過', () => {
    const errors = errorsOf(null);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('非物件（字串）→ 有錯誤，不通過', () => {
    expect(errorsOf('not-an-object').length).toBeGreaterThan(0);
  });

  it('version 缺少 → 針對 version 欄位報錯', () => {
    const f = clone(makeValidFile()) as Record<string, unknown>;
    delete f.version;
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'version')).toBe(true);
  });

  it('version 非數字 → 針對 version 欄位報錯', () => {
    const f = clone(makeValidFile()) as Record<string, unknown>;
    f.version = '1';
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'version')).toBe(true);
  });

  it('version 不符（=2）→ 針對 version 欄位報錯', () => {
    const f = clone(makeValidFile()) as Record<string, unknown>;
    f.version = 2;
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'version')).toBe(true);
  });

  it('levels 缺少（非陣列）→ 針對 levels 欄位報錯', () => {
    const f = clone(makeValidFile()) as Record<string, unknown>;
    delete f.levels;
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'levels')).toBe(true);
  });

  it('levels 為空陣列 → 針對 levels 欄位報錯', () => {
    const f = clone(makeValidFile());
    f.levels = [];
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'levels')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 關卡層級：id 缺 / id 重複 / nodes 空
// ---------------------------------------------------------------------------

describe('validateLevels — 關卡 id 與 nodes', () => {
  it('關 id 缺少 → 針對 id 欄位報錯', () => {
    const f = clone(makeValidFile());
    delete (f.levels[0] as { id?: string }).id;
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'id')).toBe(true);
  });

  it('關 id 空字串 → 針對 id 欄位報錯', () => {
    const f = clone(makeValidFile());
    f.levels[0].id = '';
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'id')).toBe(true);
  });

  it('兩關 id 重複 → 針對 id 欄位報錯（且恰為重複那一項）', () => {
    const f = clone(makeValidFile());
    f.levels[1].id = f.levels[0].id; // 製造重複
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'id')).toBe(true);
    // 重複值本身應出現在某條錯誤中，證明定位到正確關卡
    expect(errors.some((e) => e.includes(f.levels[0].id))).toBe(true);
  });

  it('nodes 缺少（非陣列）→ 針對 nodes 欄位報錯', () => {
    const f = clone(makeValidFile());
    delete (f.levels[0] as { nodes?: unknown }).nodes;
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'nodes')).toBe(true);
  });

  it('nodes 為空陣列 → 針對 nodes 欄位報錯', () => {
    const f = clone(makeValidFile());
    f.levels[0].nodes = [];
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'nodes')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 節點類型 nodeType
// ---------------------------------------------------------------------------

describe('validateLevels — nodeType', () => {
  it('nodeType 非法值 → 針對 nodeType 欄位報錯', () => {
    const f = clone(makeValidFile());
    firstSpawnNode(f).nodeType = 'Bogus';
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'nodeType')).toBe(true);
  });

  it('nodeType 缺少 → 針對 nodeType 欄位報錯', () => {
    const f = clone(makeValidFile());
    delete firstSpawnNode(f).nodeType;
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'nodeType')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spawn 節點：四個數值欄位（killQuota / maxAlive / spawnThreshold / spawnInterval）
// ---------------------------------------------------------------------------

describe('validateLevels — Spawn 數值欄位', () => {
  const numericFields = [
    'killQuota',
    'maxAlive',
    'spawnThreshold',
    'spawnInterval',
  ] as const;

  for (const field of numericFields) {
    it(`${field} 缺少 → 針對 ${field} 欄位報錯`, () => {
      const f = clone(makeValidFile());
      delete firstSpawnNode(f)[field];
      const errors = errorsOf(f);
      expect(mentionsField(errors, field)).toBe(true);
    });

    it(`${field} 非數字 → 針對 ${field} 欄位報錯`, () => {
      const f = clone(makeValidFile());
      firstSpawnNode(f)[field] = 'x';
      const errors = errorsOf(f);
      expect(mentionsField(errors, field)).toBe(true);
    });

    it(`${field} 非正數（0）→ 針對 ${field} 欄位報錯`, () => {
      const f = clone(makeValidFile());
      // 先把 threshold/maxAlive 調成不觸發 threshold>maxAlive 的組合，
      // 以確保報的錯是「非正數」而非交叉檢查污染。
      const node = firstSpawnNode(f);
      node.maxAlive = 5;
      node.spawnThreshold = 3;
      node[field] = 0;
      const errors = errorsOf(f);
      expect(mentionsField(errors, field)).toBe(true);
    });
  }

  it('spawnThreshold > maxAlive → 針對 spawnThreshold 欄位報錯', () => {
    const f = clone(makeValidFile());
    const node = firstSpawnNode(f);
    node.maxAlive = 5;
    node.spawnThreshold = 9; // > maxAlive
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'spawnThreshold')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spawn 節點：spawns[]（空 / enemyType 非法 / weight 非正）
// ---------------------------------------------------------------------------

describe('validateLevels — spawns[]', () => {
  it('spawns 缺少（非陣列）→ 針對 spawns 欄位報錯', () => {
    const f = clone(makeValidFile());
    delete firstSpawnNode(f).spawns;
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'spawns')).toBe(true);
  });

  it('spawns 為空陣列 → 針對 spawns 欄位報錯', () => {
    const f = clone(makeValidFile());
    firstSpawnNode(f).spawns = [];
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'spawns')).toBe(true);
  });

  it('spawns[].enemyType 非法 → 針對 enemyType 欄位報錯', () => {
    const f = clone(makeValidFile());
    (firstSpawnNode(f).spawns as Array<Record<string, unknown>>)[0].enemyType =
      'Enemy_Unknown';
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'enemyType')).toBe(true);
  });

  it('spawns[].weight 非正數（0）→ 針對 weight 欄位報錯', () => {
    const f = clone(makeValidFile());
    (firstSpawnNode(f).spawns as Array<Record<string, unknown>>)[0].weight = 0;
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'weight')).toBe(true);
  });

  it('spawns[].weight 缺少 → 針對 weight 欄位報錯', () => {
    const f = clone(makeValidFile());
    delete (firstSpawnNode(f).spawns as Array<Record<string, unknown>>)[0].weight;
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'weight')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Event 節點：eventPresetName 缺
// ---------------------------------------------------------------------------

describe('validateLevels — Event 節點', () => {
  it('Event 節點缺 eventPresetName → 針對 eventPresetName 欄位報錯', () => {
    const f = clone(makeValidFile());
    // level-1 第 3 個節點是 Event
    const eventNode = f.levels[0].nodes[2] as unknown as Record<string, unknown>;
    delete eventNode.eventPresetName;
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'eventPresetName')).toBe(true);
  });

  it('Event 節點 eventPresetName 空字串 → 針對 eventPresetName 欄位報錯', () => {
    const f = clone(makeValidFile());
    const eventNode = f.levels[0].nodes[2] as unknown as Record<string, unknown>;
    eventNode.eventPresetName = '';
    const errors = errorsOf(f);
    expect(mentionsField(errors, 'eventPresetName')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 錯誤數量鑑別：多處壞 → 多條錯誤（證明不是抓到一個就停）
// ---------------------------------------------------------------------------

describe('validateLevels — 錯誤數量鑑別', () => {
  it('同時弄壞兩個獨立欄位 → 至少 2 條錯誤，且各自針對其欄位', () => {
    const f = clone(makeValidFile());
    const node = firstSpawnNode(f);
    delete node.killQuota; // 壞點 1
    (node.spawns as Array<Record<string, unknown>>)[0].enemyType = 'Nope'; // 壞點 2
    const errors = errorsOf(f);
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(mentionsField(errors, 'killQuota')).toBe(true);
    expect(mentionsField(errors, 'enemyType')).toBe(true);
  });

  it('合法檔錯誤數 = 0（與壞檔形成數量對比）', () => {
    expect(errorsOf(makeValidFile())).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// assertValidLevels 的大聲失敗行為
// ---------------------------------------------------------------------------

describe('assertValidLevels — 大聲失敗', () => {
  it('壞檔 → 拋 LevelValidationError 且 errors 陣列非空', () => {
    const f = clone(makeValidFile());
    f.levels = [];
    let caught: unknown;
    try {
      assertValidLevels(f);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LevelValidationError);
    expect((caught as LevelValidationError).errors.length).toBeGreaterThan(0);
  });
});
