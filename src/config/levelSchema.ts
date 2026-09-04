/**
 * levelSchema.ts — 波次/關卡資料格式「單一來源」：型別定義 + 執行期驗證。
 *
 * ⚠️ 硬規範（架構顧問變身-leader 定，見 docs/h5_collab_spec.md §4 共用契約）：
 *   本檔【零遊戲依賴】——不准 import Phaser 或任何遊戲 runtime。
 *   純 TypeScript 型別 + 純驗證函式。因為階段2「波次編輯器」也會 import 本檔，
 *   若牽進 Phaser，編輯器就得打包整個遊戲引擎。
 *
 * 對照 Unity LevelNode 結構：
 *   levels[]（多關）→ 每關 nodes[] → 每 node:
 *     nodeType(Spawn/Reward/Event)、killQuota、maxAlive、spawnThreshold、
 *     spawnInterval、spawns[]（每筆 {enemyType, weight}）、eventPresetName（如 Guard60）。
 *
 * 遊戲載入器、WaveSystem、（未來）編輯器共用同一套 validateLevels()。
 */

/** JSON 檔頂層 schema 版本（日後 migration 依據）。目前固定為 1。 */
export const LEVELS_SCHEMA_VERSION = 1 as const;

/**
 * 敵人類型 union — 單一來源，需與 EnemySpawner.spawn / enemyConfig 的 key 對齊。
 * 編輯器匯出的 enemyType 必須是這些值，否則遊戲生不出對應怪。
 * 對應 Unity：AI_Rush / AI_Ranged / AI_Elite。
 */
export type EnemyType = 'Enemy_Rush' | 'Enemy_Ranged' | 'Enemy_Elite';

/** 執行期用的合法 EnemyType 清單（驗證與編輯器下拉選單共用）。 */
export const ENEMY_TYPES: readonly EnemyType[] = [
  'Enemy_Rush',
  'Enemy_Ranged',
  'Enemy_Elite',
] as const;

/** 節點種類。對應 Unity nodeType。 */
export type NodeType = 'Spawn' | 'Reward' | 'Event';

/** 執行期用的合法 NodeType 清單。 */
export const NODE_TYPES: readonly NodeType[] = ['Spawn', 'Reward', 'Event'] as const;

/** 生怪權重項：{敵種, 相對權重}。對應 Unity spawns[] 元素。 */
export interface SpawnEntry {
  enemyType: EnemyType;
  /** 相對權重（>0；輪盤法挑怪種，不需總和=1）。 */
  weight: number;
}

/** Spawn 節點：滴流生怪，殺到 killQuota 完成。 */
export interface SpawnNodeData {
  nodeType: 'Spawn';
  /** 完成所需擊殺數。對應 Unity killQuota。 */
  killQuota: number;
  /** 場上同時存活上限。對應 Unity maxAlive。 */
  maxAlive: number;
  /** 補怪門檻：存活 < 此值時補到 maxAlive。對應 Unity spawnThreshold。 */
  spawnThreshold: number;
  /** 生怪間隔（秒），滴流節流。對應 Unity spawnInterval。 */
  spawnInterval: number;
  /** 敵種權重表。對應 Unity spawns[]。 */
  spawns: SpawnEntry[];
}

/** Reward 節點：發獎（本階段流程未實作，schema 先定型）。 */
export interface RewardNodeData {
  nodeType: 'Reward';
  /** 發獎預設名（可選）。 */
  rewardPresetName?: string;
}

/** Event 節點：守護等事件。對應 Unity eventPresetName（如 Guard60）。 */
export interface EventNodeData {
  nodeType: 'Event';
  /** 事件預設名，如 'Guard60'。 */
  eventPresetName: string;
}

/** 節點聯集。 */
export type LevelNodeData = SpawnNodeData | RewardNodeData | EventNodeData;

/** 一關 = id + 有序節點。 */
export interface LevelData {
  id: string;
  /** 關卡顯示名（編輯器列表用）。additive optional，缺省時 UI 退回顯示 id。 */
  name?: string;
  nodes: LevelNodeData[];
}

/** JSON 檔頂層結構：version + levels[]。 */
export interface LevelsFile {
  version: number;
  levels: LevelData[];
}

// ---------------------------------------------------------------------------
// 驗證：validateLevels(json) → Result。錯誤指出「哪一關 / 哪個 node / 哪個欄位」。
// ---------------------------------------------------------------------------

/** 驗證結果：ok 時帶已收斂型別的 data；否則帶人類可讀的 errors 清單。 */
export type ValidateResult =
  | { ok: true; data: LevelsFile }
  | { ok: false; errors: string[] };

/** 內部：判斷是否為有限數字。 */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 內部：非空字串。 */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * 驗證任意 JSON 是否為合法 LevelsFile。
 *
 * 設計原則（架構顧問硬規範 §4）：**大聲失敗、精準定位**——
 * 每個錯誤字串都標出關 index/id、node index、欄位名與原因，
 * 不做任何自動修補、不靜默略過，讓載入端能明確報錯。
 *
 * @param json 通常來自 JSON.parse 的未知結構。
 */
export function validateLevels(json: unknown): ValidateResult {
  const errors: string[] = [];

  if (typeof json !== 'object' || json === null) {
    return { ok: false, errors: ['根層級必須是物件 { version, levels }。'] };
  }
  const root = json as Record<string, unknown>;

  // version
  if (!isFiniteNumber(root.version)) {
    errors.push('頂層 version 缺少或非數字（預期 version: 1）。');
  } else if (root.version !== LEVELS_SCHEMA_VERSION) {
    errors.push(
      `頂層 version=${String(root.version)} 不支援（此版本只接受 ${LEVELS_SCHEMA_VERSION}）。`,
    );
  }

  // levels
  if (!Array.isArray(root.levels)) {
    errors.push('頂層 levels 缺少或不是陣列。');
    return { ok: false, errors };
  }
  if (root.levels.length === 0) {
    errors.push('levels 為空陣列，至少要有一關。');
  }

  const seenIds = new Set<string>();
  root.levels.forEach((lvlRaw, li) => {
    const where = `levels[${li}]`;
    if (typeof lvlRaw !== 'object' || lvlRaw === null) {
      errors.push(`${where} 必須是物件 { id, nodes }。`);
      return;
    }
    const lvl = lvlRaw as Record<string, unknown>;

    if (!isNonEmptyString(lvl.id)) {
      errors.push(`${where}.id 缺少或非非空字串。`);
    } else {
      if (seenIds.has(lvl.id)) errors.push(`${where}.id "${lvl.id}" 與其他關卡重複。`);
      seenIds.add(lvl.id);
    }

    const idLabel = isNonEmptyString(lvl.id) ? lvl.id : `#${li}`;

    // name 為 optional；若提供則須為非空字串。
    if (lvl.name !== undefined && !isNonEmptyString(lvl.name)) {
      errors.push(`關 "${idLabel}" 的 name 若提供必須是非空字串。`);
    }

    if (!Array.isArray(lvl.nodes)) {
      errors.push(`關 "${idLabel}" 的 nodes 缺少或不是陣列。`);
      return;
    }
    if (lvl.nodes.length === 0) {
      errors.push(`關 "${idLabel}" 的 nodes 為空，至少要有一個節點。`);
    }

    lvl.nodes.forEach((nodeRaw, ni) => {
      validateNode(nodeRaw, idLabel, ni, errors);
    });
  });

  if (errors.length > 0) return { ok: false, errors };
  // 驗證通過：結構已確認，安全收斂型別。
  return { ok: true, data: root as unknown as LevelsFile };
}

/** 驗證單一節點，錯誤 push 進 errors（標出關/node index/欄位）。 */
function validateNode(
  nodeRaw: unknown,
  levelLabel: string,
  ni: number,
  errors: string[],
): void {
  const at = `關 "${levelLabel}" node[${ni}]`;
  if (typeof nodeRaw !== 'object' || nodeRaw === null) {
    errors.push(`${at} 必須是物件。`);
    return;
  }
  const node = nodeRaw as Record<string, unknown>;
  const nodeType = node.nodeType;

  if (!isNonEmptyString(nodeType) || !NODE_TYPES.includes(nodeType as NodeType)) {
    errors.push(
      `${at}.nodeType="${String(nodeType)}" 不合法（預期 ${NODE_TYPES.join(' / ')}）。`,
    );
    return; // nodeType 錯就無從往下驗欄位
  }

  switch (nodeType as NodeType) {
    case 'Spawn':
      validateSpawnNode(node, at, errors);
      break;
    case 'Reward':
      if (
        node.rewardPresetName !== undefined &&
        !isNonEmptyString(node.rewardPresetName)
      ) {
        errors.push(`${at}(Reward).rewardPresetName 若提供必須是非空字串。`);
      }
      break;
    case 'Event':
      if (!isNonEmptyString(node.eventPresetName)) {
        errors.push(`${at}(Event).eventPresetName 缺少或非非空字串（如 "Guard60"）。`);
      }
      break;
    default:
      break;
  }
}

/** 驗證 Spawn 節點的數值欄位與 spawns[]。 */
function validateSpawnNode(
  node: Record<string, unknown>,
  at: string,
  errors: string[],
): void {
  const numField = (key: string, opts: { positive?: boolean }): void => {
    const v = node[key];
    if (!isFiniteNumber(v)) {
      errors.push(`${at}(Spawn).${key} 缺少或非數字。`);
    } else if (opts.positive && v <= 0) {
      errors.push(`${at}(Spawn).${key}=${v} 必須 > 0。`);
    } else if (!opts.positive && v < 0) {
      errors.push(`${at}(Spawn).${key}=${v} 不可為負。`);
    }
  };

  numField('killQuota', { positive: true });
  numField('maxAlive', { positive: true });
  numField('spawnThreshold', { positive: true });
  numField('spawnInterval', { positive: true });

  // maxAlive / spawnThreshold 合理性：threshold 不應大於 maxAlive（否則永遠在補）。
  if (
    isFiniteNumber(node.maxAlive) &&
    isFiniteNumber(node.spawnThreshold) &&
    node.spawnThreshold > node.maxAlive
  ) {
    errors.push(
      `${at}(Spawn).spawnThreshold(${node.spawnThreshold}) 不應大於 maxAlive(${node.maxAlive})。`,
    );
  }

  if (!Array.isArray(node.spawns)) {
    errors.push(`${at}(Spawn).spawns 缺少或不是陣列。`);
    return;
  }
  if (node.spawns.length === 0) {
    errors.push(`${at}(Spawn).spawns 為空，至少要有一種可生怪。`);
  }
  node.spawns.forEach((entryRaw, si) => {
    const eAt = `${at}(Spawn).spawns[${si}]`;
    if (typeof entryRaw !== 'object' || entryRaw === null) {
      errors.push(`${eAt} 必須是物件 { enemyType, weight }。`);
      return;
    }
    const entry = entryRaw as Record<string, unknown>;
    if (
      !isNonEmptyString(entry.enemyType) ||
      !ENEMY_TYPES.includes(entry.enemyType as EnemyType)
    ) {
      errors.push(
        `${eAt}.enemyType="${String(entry.enemyType)}" 不合法（預期 ${ENEMY_TYPES.join(' / ')}）。`,
      );
    }
    if (!isFiniteNumber(entry.weight) || entry.weight <= 0) {
      errors.push(`${eAt}.weight 缺少或非正數。`);
    }
  });
}
