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
/**
 * 敵人類型 — 敵種 key（字串）。可維護性根治（用戶關切「新增怪不改 code」）：
 * 型別放寬為 string（不再寫死 union），「有哪些怪」的唯一來源 = enemies 定義（enemySchema.getEnemyTypeKeys）。
 * 合法性交 runtime：validate 只驗非空字串（軟白名單）、遊戲端 getResolvedEnemies fallback。
 * 同 platform/attachFireRain 等 preset 名慣例（字串不 union 限制，decision da06fa9e）。
 * 對應 Unity：AI_Rush / AI_Ranged / AI_Elite（打包預設見 ENEMY_TYPES）。
 */
export type EnemyType = string;

/** 打包預設敵種清單（編輯器無 enemies override 時的 fallback；權威清單見 enemySchema.getEnemyTypeKeys）。 */
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

/** 訊息用：節點類型「中文（英文enum）」，找不到退回原值。 */
function nodeTypeMsg(type: string): string {
  const zh = (NODE_TYPE_MSG_LABELS as Record<string, string>)[type];
  return zh ? `${zh}（${type}）` : type;
}

/** 訊息用：合法節點類型的顯示清單。 */
function nodeTypesDisplay(): string {
  return NODE_TYPES.map((t) => nodeTypeMsg(t)).join(' / ');
}

/** 生怪權重項：{敵種, 相對權重}。對應 Unity spawns[] 元素。 */
export interface SpawnEntry {
  enemyType: EnemyType;
  /** 相對權重（>0；輪盤法挑怪種，不需總和=1）。 */
  weight: number;
}

/**
 * 刷怪 group（用戶：group 分層，對照瓢蟲 Cultivarium CultivationRule）：一條獨立的 drip 供給流。
 * 一個 Spawn node 可含多個 group 並行（如：雜兵狂刷 + 遠程零星 + 菁英偶爾一隻），各自節奏維持場上數。
 * ★純 drip 維持（無 count/產出上限）：場上該 group 的怪 < 門檻 → 每 spawnInterval 補一隻、補到 maxConcurrent。
 * ★過關仍靠 node 層 killQuota（全場擊殺累積），group 不參與過關判定、只管刷。
 */
export interface SpawnGroup {
  /** 標籤（編輯器辨識用，選填，不影響 runtime）。 */
  label?: string;
  /** 該 group 的敵種權重表（輪盤挑）。 */
  spawns: SpawnEntry[];
  /** 該 group 生怪間隔（秒，滴流節流）。 */
  spawnInterval: number;
  /** 該 group 場上同時上限（該 group 自己的怪補到此數為止）。對照瓢蟲 MaxConcurrent。 */
  maxConcurrent: number;
  /**
   * 該 group 補怪觸發門檻（選填，對照瓢蟲 MinConcurrent）：場上該 group 怪 < 此值才「開始」補、補到 maxConcurrent。
   * 省略 → 沿用「< maxConcurrent 即補」的單純維持行為（等同 threshold=maxConcurrent，不破壞行為）。
   */
  minConcurrent?: number;
}

/** 陣型類型（怪物 AI 第 2 塊，5 種隊形推進）。 */
export type FormationType = 'Line' | 'Triangle' | 'Square' | 'Circle' | 'Hexagonal';

/**
 * 陣型設定（怪物 AI 第 2 塊）：整齊列隊推進的敵人。單一來源型別（本檔 export，
 * game-side computeFormationSlots(config)/EnemyFormation 與 level-editor 陣型面板共用同一型別）。
 * ★距離/半徑單位＝unit（算座標時 ×PPU=100 轉 px，全 schema 統一 unit）；角度＝度。
 * ★零遊戲依賴：純資料型別（computeFormationSlots 純函式在 formationConfig.ts，非此檔）。
 */
export interface FormationConfig {
  /** 隊形類型。 */
  type: FormationType;
  /** 成員數 2~30（Line/Triangle/Circle 用；Square/Hexagonal 由 rows*cols 或 count 推）。 */
  count: number;
  /** 成員間隔（unit）。 */
  distance: number;
  /** Square/Hexagonal 行數（選填）。 */
  rows?: number;
  /** Square/Hexagonal 列數（選填；省略→由 count 自動接近正方排）。 */
  cols?: number;
  /** Triangle 頂角度數（選填，預設 60）。 */
  triangleAngle?: number;
  /** Circle 半徑（unit，選填）。 */
  circleRadius?: number;
  /** Hexagonal 環數（選填；1=中心+6、2=+12…；優先於 rows/cols）。 */
  hexRings?: number;
  /** 陣型朝向/推進方向（度，0=右、90=下）。 */
  facingDeg: number;
  /** 整隊移動（執行端用；編輯器可畫箭頭）。 */
  move?: { speedUnits: number; spline?: { x: number; y: number }[] };
  /** 陣型內敵種（第 2 塊：整隊單一敵種；選填，省略→game-side 預設 Enemy_Melee）。 */
  enemyType?: string;
  /** 每 slot 指定敵種（後續混編用，選填，先留欄不改名）。 */
  slotTypes?: string[];
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
  /**
   * 用戶：group 分層（additive optional，向後相容）。有 groups → 走多 group 並行 drip（各自 spawnInterval/maxConcurrent）；
   * 省略/空 → 走現有扁平單流（killQuota/maxAlive/spawnThreshold/spawnInterval/spawns）。舊 levels.json 零改動仍正常。
   * killQuota 仍 node 層全場過關（group 不帶過關數）。
   */
  groups?: SpawnGroup[];
  /**
   * 附加火雨（用戶試玩#2，additive optional，§4）：火雨 preset 名（FIRE_RAIN_PRESETS 的 key，
   * 如 'FireRain'/'FireRainLight'/'FireRainHeavy'）。省略=無火雨。
   * WaveSystem 讀此欄，該波次進行時觸發對應火雨。
   * 註：本 schema 零遊戲依賴，不 import FIRE_RAIN_PRESETS 交叉比對——只驗「非空字串」，
   * preset 名是否存在由編輯器下拉(只給合法)與遊戲端 getFireRainPreset(fallback) 把關，
   * 跟 eventPresetName 不在此檔交叉驗 GUARD_PRESETS 同慣例。
   */
  attachFireRain?: string;
  /**
   * 附加地雷（用戶：地雷=附加類，比照 attachFireRain）：地雷 preset 名（MINE_PRESETS 的 key，如 'Mine'/'MineHeavy'）。
   * 省略=無地雷。WaveSystem getActiveMinePreset 讀此欄，該波次進行時 game-side MineSystem 全場自動撒地雷。
   * 註：零遊戲依賴，只驗「非空字串」；preset 名合法性由編輯器下拉 + game-side getResolvedMinePreset(fallback) 把關。
   */
  attachMineTrap?: string;
  /**
   * 陣型（怪物 AI 第 2 塊，additive optional）：這波用哪個隊形推進（Line/Triangle/Square/Circle/Hexagonal）。
   * 省略＝散兵（現有環繞 AI）。型別 FormationConfig 由 formationConfig.ts 單一來源（type-only import，執行期零耦合）。
   * game-side EnemyFormation 讀此欄 → computeFormationSlots 算整隊座標推進。編輯器：level-editor Spawn 節點陣型子面板編。
   */
  formation?: FormationConfig;
}

/** Reward 節點：發獎（本階段流程未實作，schema 先定型）。 */
export interface RewardNodeData {
  nodeType: 'Reward';
  /** 發獎預設名（可選）。 */
  rewardPresetName?: string;
}

/**
 * Event 節點：靠 eventPresetName 分派（用戶單一架構）——
 * - 守護 preset（如 Guard60）→ 守護波（建 GuardEvent）。
 * - 火雨 preset（如 FireRain）→ 純火雨波。
 * - 魔尖塔 preset（如 Tower4，towerConfig TOWER_PRESETS）→ 魔尖塔波（限時打塔勝敗，比照守護波）。
 * 可額外附加火雨（attachFireRain）/ 地雷（attachMineTrap）。
 */
export interface EventNodeData {
  nodeType: 'Event';
  /** 事件預設名：Guard preset（守護波）/ 火雨 preset / 魔尖塔 preset。WaveSystem 依此分派。 */
  eventPresetName: string;
  /**
   * 附加火雨（additive optional）：per-node 覆蓋守護 preset 的火雨。三態：
   *   省略→沿用 preset（守護波用）；'none'→明確無；火雨 preset 名→用該火雨。
   */
  attachFireRain?: string;
  /** 附加地雷（用戶：地雷=附加類）：地雷 preset 名（MINE_PRESETS key）。省略=無。守護/魔尖塔波可額外附加。 */
  attachMineTrap?: string;
  /** 守護補怪 drip per-node 覆蓋（僅守護波用；省略＝沿用 preset）。 */
  maxAlive?: number;
  spawnThreshold?: number;
  spawnInterval?: number;
  spawns?: SpawnEntry[];
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
      validateEventNode(node, `${at}（${typeLabel}）`, errors);
      break;
    default:
      break;
  }
}

/**
 * Event 節點驗證（單一架構）：eventPresetName 非空字串（守護/火雨/魔尖塔 preset 名，遊戲端分派）。
 * 附加火雨 attachFireRain / 附加地雷 attachMineTrap 選填；守護補怪 drip 覆蓋選填。
 */
function validateEventNode(node: Record<string, unknown>, at: string, errors: string[]): void {
  // 單一架構：純 eventPresetName 分派（守護/火雨/魔尖塔 preset 都填此欄，遊戲端 isResolvedX 判）。
  if (!isNonEmptyString(node.eventPresetName)) {
    errors.push(`${at} 的「事件預設名 eventPresetName」缺少或非非空字串（如 "Guard60"/"FireRain"/"Tower4"）。`);
  }
  // 附加火雨（optional 三態）：省略/'none'/火雨 preset 名皆非空字串即過。
  if (node.attachFireRain !== undefined && !isNonEmptyString(node.attachFireRain)) {
    errors.push(`${at} 的「附加火雨 attachFireRain」若提供必須是非空字串（'none' 或火雨 preset 名）。`);
  }
  // 附加地雷（optional）：省略或地雷 preset 名。
  if (node.attachMineTrap !== undefined && !isNonEmptyString(node.attachMineTrap)) {
    errors.push(`${at} 的「附加地雷 attachMineTrap」若提供必須是非空字串（地雷 preset 名）。`);
  }
  // 守護補怪 drip per-node 覆蓋（optional，僅守護波用；省略＝沿用 preset）。
  validateEventDrip(node, at, errors);
}

/**
 * 七輪 守護補怪 drip per-node 覆蓋驗證（optional）：僅在該欄有提供時驗型別/範圍；省略＝沿用 preset。
 * spawns.enemyType 非空字串即過（軟白名單，合法性交遊戲端 getResolvedEnemies）；同已做的敵種動態化慣例。
 */
function validateEventDrip(
  node: Record<string, unknown>,
  at: string,
  errors: string[],
): void {
  const posInt = (key: string, label: string): void => {
    const v = node[key];
    if (v === undefined) return; // 省略＝沿用 preset
    if (!isFiniteNumber(v)) errors.push(`${at} 的「${label}」若提供必須是數字。`);
    else if (v < 0) errors.push(`${at} 的「${label}」=${v} 不可為負。`);
  };
  posInt('maxAlive', '場上上限 maxAlive');
  posInt('spawnThreshold', '補怪門檻 spawnThreshold');
  posInt('spawnInterval', '生怪間隔 spawnInterval');
  if (node.spawns !== undefined) {
    if (!Array.isArray(node.spawns)) {
      errors.push(`${at} 的「敵人配置 spawns」若提供必須是陣列。`);
    } else {
      if (node.spawns.length === 0) errors.push(`${at} 的「敵人配置 spawns」若提供至少要有一種可生怪。`);
      node.spawns.forEach((entryRaw, si) => {
        const eAt = `${at} 的第 ${si + 1} 筆敵人配置`;
        const entry = entryRaw as Record<string, unknown> | null;
        if (typeof entryRaw !== 'object' || entryRaw === null) {
          errors.push(`${eAt} 必須是物件（含 敵種、權重）。`);
          return;
        }
        if (!isNonEmptyString(entry!.enemyType)) {
          errors.push(`${eAt} 的「敵種 enemyType」="${String(entry!.enemyType)}" 不合法（需非空字串；敵種合法性由 enemies 定義把關）。`);
        }
        if (!isFiniteNumber(entry!.weight) || (entry!.weight as number) <= 0) {
          errors.push(`${eAt} 的「權重 weight」缺少或非正數。`);
        }
      });
    }
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
  validateSpawnEntries(node.spawns, `${at} 的`, errors);

  // attachFireRain（optional）：若提供必須是非空字串（火雨 preset 名）。省略=無火雨。
  if (node.attachFireRain !== undefined && !isNonEmptyString(node.attachFireRain)) {
    errors.push(`${at} 的「附加火雨 attachFireRain」若提供必須是非空字串（火雨 preset 名）。`);
  }
  // attachMineTrap（optional）：若提供必須是非空字串（地雷 preset 名）。省略=無地雷。
  if (node.attachMineTrap !== undefined && !isNonEmptyString(node.attachMineTrap)) {
    errors.push(`${at} 的「附加地雷 attachMineTrap」若提供必須是非空字串（地雷 preset 名）。`);
  }

  // groups（用戶：group 分層，optional additive）：若提供，每 group 各自 spawns/spawnInterval/maxConcurrent(+minConcurrent?)。
  if (node.groups !== undefined) {
    if (!Array.isArray(node.groups)) {
      errors.push(`${at} 的「刷怪分層 groups」若提供必須是陣列。`);
    } else {
      if (node.groups.length === 0) errors.push(`${at} 的「刷怪分層 groups」若提供至少要有一個 group。`);
      node.groups.forEach((gRaw, gi) => {
        const gAt = `${at} 的第 ${gi + 1} 個 group`;
        if (typeof gRaw !== 'object' || gRaw === null) {
          errors.push(`${gAt} 必須是物件。`);
          return;
        }
        const g = gRaw as Record<string, unknown>;
        if (g.label !== undefined && typeof g.label !== 'string') {
          errors.push(`${gAt} 的「標籤 label」若提供必須是字串。`);
        }
        if (!isFiniteNumber(g.spawnInterval) || (g.spawnInterval as number) <= 0) {
          errors.push(`${gAt} 的「生怪間隔 spawnInterval」缺少或非正數。`);
        }
        if (!isFiniteNumber(g.maxConcurrent) || (g.maxConcurrent as number) <= 0) {
          errors.push(`${gAt} 的「同時上限 maxConcurrent」缺少或非正數。`);
        }
        // minConcurrent optional：若提供須非負、且不大於 maxConcurrent（否則永遠在補）。
        if (g.minConcurrent !== undefined) {
          if (!isFiniteNumber(g.minConcurrent) || (g.minConcurrent as number) < 0) {
            errors.push(`${gAt} 的「補怪門檻 minConcurrent」若提供必須是非負數。`);
          } else if (isFiniteNumber(g.maxConcurrent) && (g.minConcurrent as number) > (g.maxConcurrent as number)) {
            errors.push(`${gAt} 的「補怪門檻 minConcurrent」(${g.minConcurrent}) 不應大於「同時上限 maxConcurrent」(${g.maxConcurrent})。`);
          }
        }
        if (!Array.isArray(g.spawns)) {
          errors.push(`${gAt} 的「敵人配置 spawns」缺少或不是陣列。`);
        } else {
          if (g.spawns.length === 0) errors.push(`${gAt} 的「敵人配置 spawns」為空，至少要有一種可生怪。`);
          validateSpawnEntries(g.spawns, `${gAt} 的`, errors);
        }
      });
    }
  }

  // formation（怪物 AI 第 2 塊，optional）：若提供必須是合法 FormationConfig。省略＝散兵。
  if (node.formation !== undefined) {
    validateFormation(node.formation, `${at} 的陣型 formation`, errors);
  }
}

/**
 * 陣型設定驗證（怪物 AI 第 2 塊，optional）：type 五選一、count 2~30、distance>0、facingDeg 數、enemyType 非空字串；
 * 依 type 驗選填參數（Triangle→triangleAngle、Circle→circleRadius、Square/Hex→rows/cols/hexRings）。零遊戲依賴純驗證。
 */
function validateFormation(raw: unknown, at: string, errors: string[]): void {
  if (typeof raw !== 'object' || raw === null) {
    errors.push(`${at} 必須是物件。`);
    return;
  }
  const f = raw as Record<string, unknown>;
  const TYPES = ['Line', 'Triangle', 'Square', 'Circle', 'Hexagonal'];
  if (typeof f.type !== 'string' || !TYPES.includes(f.type)) {
    errors.push(`${at} 的「隊形 type」必須是 ${TYPES.join('/')} 之一。`);
  }
  if (!isFiniteNumber(f.count) || (f.count as number) < 2 || (f.count as number) > 30) {
    errors.push(`${at} 的「成員數 count」必須是 2~30 的數。`);
  }
  if (!isFiniteNumber(f.distance) || (f.distance as number) <= 0) {
    errors.push(`${at} 的「間隔 distance」缺少或非正數（unit）。`);
  }
  if (!isFiniteNumber(f.facingDeg)) {
    errors.push(`${at} 的「朝向 facingDeg」缺少或非數（度）。`);
  }
  if (f.enemyType !== undefined && !isNonEmptyString(f.enemyType)) {
    errors.push(`${at} 的「敵種 enemyType」若提供必須是非空字串（省略→game 預設）。`);
  }
  // 選填參數（若提供須合理）。
  if (f.rows !== undefined && (!isFiniteNumber(f.rows) || (f.rows as number) < 1)) {
    errors.push(`${at} 的「行數 rows」若提供必須是 >=1 的數。`);
  }
  if (f.cols !== undefined && (!isFiniteNumber(f.cols) || (f.cols as number) < 1)) {
    errors.push(`${at} 的「列數 cols」若提供必須是 >=1 的數。`);
  }
  if (f.triangleAngle !== undefined && (!isFiniteNumber(f.triangleAngle) || (f.triangleAngle as number) <= 0)) {
    errors.push(`${at} 的「三角頂角 triangleAngle」若提供必須是正數（度）。`);
  }
  if (f.circleRadius !== undefined && (!isFiniteNumber(f.circleRadius) || (f.circleRadius as number) < 0)) {
    errors.push(`${at} 的「圓半徑 circleRadius」若提供必須是非負數（unit）。`);
  }
  if (f.hexRings !== undefined && (!isFiniteNumber(f.hexRings) || (f.hexRings as number) < 1)) {
    errors.push(`${at} 的「六角環數 hexRings」若提供必須是 >=1 的整數。`);
  }
  if (f.slotTypes !== undefined && !Array.isArray(f.slotTypes)) {
    errors.push(`${at} 的「每 slot 敵種 slotTypes」若提供必須是陣列。`);
  }
  if (f.move !== undefined) {
    const m = f.move as Record<string, unknown>;
    if (typeof m !== 'object' || m === null || !isFiniteNumber(m.speedUnits)) {
      errors.push(`${at} 的「移動 move」若提供必須含 speedUnits（數，unit/s）。`);
    }
  }
}

/** 驗證 spawns[] 內每筆 {enemyType, weight}（node.spawns 與 group.spawns 共用）。 */
function validateSpawnEntries(spawns: unknown[], atPrefix: string, errors: string[]): void {
  spawns.forEach((entryRaw, si) => {
    const eAt = `${atPrefix}第 ${si + 1} 筆敵人配置`;
    if (typeof entryRaw !== 'object' || entryRaw === null) {
      errors.push(`${eAt} 必須是物件（含 敵種、權重）。`);
      return;
    }
    const entry = entryRaw as Record<string, unknown>;
    if (!isNonEmptyString(entry.enemyType)) {
      errors.push(
        `${eAt} 的「敵種 enemyType」="${String(entry.enemyType)}" 不合法（需非空字串；敵種合法性由 enemies 定義把關）。`,
      );
    }
    if (!isFiniteNumber(entry.weight) || (entry.weight as number) <= 0) {
      errors.push(`${eAt} 的「權重 weight」缺少或非正數。`);
    }
  });
}
