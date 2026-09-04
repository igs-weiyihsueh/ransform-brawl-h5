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

// ---------------------------------------------------------------------------
// 以下為【驗證訊息】內部用的中文標籤（private，不 export）。
// 供 validateLevels 組錯誤字串用；不是對外的 UI 顯示 API——
// 編輯器要顯示用的中文對照放在 editor/labels.ts（presentation 屬編輯器側）。
// ⚠️ 這些只影響錯誤訊息「文字」，不影響 JSON 的英文 enum 值。
// ---------------------------------------------------------------------------

const NODE_TYPE_MSG_LABELS: Readonly<Record<NodeType, string>> = {
  Spawn: '刷怪',
  Reward: '獎勵',
  Event: '事件',
};

const ENEMY_TYPE_MSG_LABELS: Readonly<Record<EnemyType, string>> = {
  Enemy_Rush: '衝鋒兵',
  Enemy_Ranged: '遠程兵',
  Enemy_Elite: '菁英兵',
};

/** 訊息用：節點類型「中文（英文enum）」，找不到退回原值。 */
function nodeTypeMsg(type: string): string {
  const zh = (NODE_TYPE_MSG_LABELS as Record<string, string>)[type];
  return zh ? `${zh}（${type}）` : type;
}

/** 訊息用：敵種「中文（英文enum）」，找不到退回原值。 */
function enemyTypeMsg(type: string): string {
  const zh = (ENEMY_TYPE_MSG_LABELS as Record<string, string>)[type];
  return zh ? `${zh}（${type}）` : type;
}

/** 訊息用：合法節點類型的顯示清單。 */
function nodeTypesDisplay(): string {
  return NODE_TYPES.map((t) => nodeTypeMsg(t)).join(' / ');
}

/** 訊息用：合法敵種的顯示清單。 */
function enemyTypesDisplay(): string {
  return ENEMY_TYPES.map((t) => enemyTypeMsg(t)).join(' / ');
}

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

/** 關卡資料驗證失敗時拋出的錯誤（訊息已含逐條精準定位）。 */
export class LevelValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(
      `關卡資料驗證失敗（${errors.length} 項）：\n${errors.map((m) => `  - ${m}`).join('\n')}`,
    );
    this.name = 'LevelValidationError';
    this.errors = errors;
  }
}

/**
 * 驗證一份已 parse 的資料，通過回傳收斂型別的 LevelsFile；否則**大聲失敗**拋
 * LevelValidationError。遊戲載入器、WaveSystem、編輯器共用同一個驗證閘門。
 * 純函式、零依賴（不 fetch、不碰 runtime）。
 */
export function assertValidLevels(raw: unknown): LevelsFile {
  const result = validateLevels(raw);
  if (!result.ok) throw new LevelValidationError(result.errors);
  return result.data;
}

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
    errors.push('頂層「版本 version」缺少或非數字（預期 version: 1）。');
  } else if (root.version !== LEVELS_SCHEMA_VERSION) {
    errors.push(
      `頂層「版本 version」=${String(root.version)} 不支援（此版本只接受 ${LEVELS_SCHEMA_VERSION}）。`,
    );
  }

  // levels
  if (!Array.isArray(root.levels)) {
    errors.push('頂層「關卡清單 levels」缺少或不是陣列。');
    return { ok: false, errors };
  }
  if (root.levels.length === 0) {
    errors.push('「關卡清單 levels」為空，至少要有一關。');
  }

  const seenIds = new Set<string>();
  root.levels.forEach((lvlRaw, li) => {
    const where = `第 ${li + 1} 關`;
    if (typeof lvlRaw !== 'object' || lvlRaw === null) {
      errors.push(`${where} 必須是物件（含 關卡ID、節點清單）。`);
      return;
    }
    const lvl = lvlRaw as Record<string, unknown>;

    if (!isNonEmptyString(lvl.id)) {
      errors.push(`${where} 的「關卡ID id」缺少或非非空字串。`);
    } else {
      if (seenIds.has(lvl.id)) {
        errors.push(`${where} 的「關卡ID id」"${lvl.id}" 與其他關卡重複。`);
      }
      seenIds.add(lvl.id);
    }

    const idLabel = isNonEmptyString(lvl.id) ? lvl.id : `第${li + 1}關`;

    // name 為 optional；若提供則須為非空字串。
    if (lvl.name !== undefined && !isNonEmptyString(lvl.name)) {
      errors.push(`關卡「${idLabel}」的「關卡名稱 name」若提供必須是非空字串。`);
    }

    if (!Array.isArray(lvl.nodes)) {
      errors.push(`關卡「${idLabel}」的「節點清單 nodes」缺少或不是陣列。`);
      return;
    }
    if (lvl.nodes.length === 0) {
      errors.push(`關卡「${idLabel}」的「節點清單 nodes」為空，至少要有一個節點。`);
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
  const at = `關卡「${levelLabel}」第 ${ni + 1} 個節點`;
  if (typeof nodeRaw !== 'object' || nodeRaw === null) {
    errors.push(`${at} 必須是物件。`);
    return;
  }
  const node = nodeRaw as Record<string, unknown>;
  const nodeType = node.nodeType;

  if (!isNonEmptyString(nodeType) || !NODE_TYPES.includes(nodeType as NodeType)) {
    errors.push(
      `${at} 的「節點類型 nodeType」="${String(nodeType)}" 不合法（預期 ${nodeTypesDisplay()}）。`,
    );
    return; // nodeType 錯就無從往下驗欄位
  }

  const typeLabel = nodeTypeMsg(nodeType);
  switch (nodeType as NodeType) {
    case 'Spawn':
      validateSpawnNode(node, `${at}（${typeLabel}）`, errors);
      break;
    case 'Reward':
      if (
        node.rewardPresetName !== undefined &&
        !isNonEmptyString(node.rewardPresetName)
      ) {
        errors.push(
          `${at}（${typeLabel}）的「獎勵預設名 rewardPresetName」若提供必須是非空字串。`,
        );
      }
      break;
    case 'Event':
      if (!isNonEmptyString(node.eventPresetName)) {
        errors.push(
          `${at}（${typeLabel}）的「事件預設名 eventPresetName」缺少或非非空字串（如 "Guard60"）。`,
        );
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
  const fieldLabel: Record<string, string> = {
    killQuota: '殺敵數 killQuota',
    maxAlive: '場上上限 maxAlive',
    spawnThreshold: '補怪門檻 spawnThreshold',
    spawnInterval: '生怪間隔 spawnInterval',
  };
  const numField = (key: string, opts: { positive?: boolean }): void => {
    const label = fieldLabel[key] ?? key;
    const v = node[key];
    if (!isFiniteNumber(v)) {
      errors.push(`${at} 的「${label}」缺少或非數字。`);
    } else if (opts.positive && v <= 0) {
      errors.push(`${at} 的「${label}」=${v} 必須 > 0。`);
    } else if (!opts.positive && v < 0) {
      errors.push(`${at} 的「${label}」=${v} 不可為負。`);
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
      `${at} 的「補怪門檻 spawnThreshold」(${node.spawnThreshold}) 不應大於「場上上限 maxAlive」(${node.maxAlive})。`,
    );
  }

  if (!Array.isArray(node.spawns)) {
    errors.push(`${at} 的「敵人配置 spawns」缺少或不是陣列。`);
    return;
  }
  if (node.spawns.length === 0) {
    errors.push(`${at} 的「敵人配置 spawns」為空，至少要有一種可生怪。`);
  }
  node.spawns.forEach((entryRaw, si) => {
    const eAt = `${at} 的第 ${si + 1} 筆敵人配置`;
    if (typeof entryRaw !== 'object' || entryRaw === null) {
      errors.push(`${eAt} 必須是物件（含 敵種、權重）。`);
      return;
    }
    const entry = entryRaw as Record<string, unknown>;
    if (
      !isNonEmptyString(entry.enemyType) ||
      !ENEMY_TYPES.includes(entry.enemyType as EnemyType)
    ) {
      errors.push(
        `${eAt} 的「敵種 enemyType」="${String(entry.enemyType)}" 不合法（預期 ${enemyTypesDisplay()}）。`,
      );
    }
    if (!isFiniteNumber(entry.weight) || entry.weight <= 0) {
      errors.push(`${eAt} 的「權重 weight」缺少或非正數。`);
    }
  });
}
