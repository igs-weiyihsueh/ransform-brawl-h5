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

/**
 * 事件節點（Event）的事件類型（用戶：地雷/魔尖塔併進「事件」底下，跟守護波/火雨並列，非獨立頂層 NodeType）。
 * - 'guard'    ：守護波（eventPresetName=Guard preset，如 Guard60）。
 * - 'fireRain' ：純火雨波（eventPresetName=火雨 preset）。
 * - 'mineTrap' ：地雷陷阱（mineTrap 撒佈參數；比照火雨全場自動撒，不用手動座標）。
 * - 'towerWave'：魔尖塔（towerWave 參數；比照守護波，限時打塔勝敗）。
 * 省略＝'guard'（向後相容：舊 Event 節點無 eventType＝守護/火雨，靠 eventPresetName 判）。
 */
export type EventType = 'guard' | 'fireRain' | 'mineTrap' | 'towerWave';
export const EVENT_TYPES: readonly EventType[] = ['guard', 'fireRain', 'mineTrap', 'towerWave'] as const;

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
}

/** Reward 節點：發獎（本階段流程未實作，schema 先定型）。 */
export interface RewardNodeData {
  nodeType: 'Reward';
  /** 發獎預設名（可選）。 */
  rewardPresetName?: string;
}

/** Event 節點：守護波/火雨/地雷陷阱/魔尖塔，靠 eventType 分派（用戶：4 種事件並列在「事件」底下）。 */
export interface EventNodeData {
  nodeType: 'Event';
  /**
   * 事件類型（用戶：地雷/魔尖塔併進事件）。省略＝'guard'（向後相容：舊 Event 節點無此欄＝守護/火雨，靠 eventPresetName 判）。
   * - 'guard'/'fireRain'：用 eventPresetName（Guard/火雨 preset 名）。
   * - 'mineTrap'：用 mineTrap 撒佈參數（比照火雨自動撒，不用座標）。
   * - 'towerWave'：用 towerWave 參數（比照守護波，限時打塔勝敗）。
   */
  eventType?: EventType;
  /** 事件預設名（eventType=guard/fireRain 用；如 'Guard60'/'FireRain'）。mineTrap/towerWave 不需此欄。 */
  eventPresetName?: string;
  /**
   * 守護事件附加火雨（用戶第六輪 #1，additive optional）：per-node 覆蓋守護 preset 的火雨。三態：
   *   省略→沿用 preset；'none'→明確無；火雨 preset 名→用該火雨。（僅 guard 用）
   */
  attachFireRain?: string;
  /** 守護補怪 drip per-node 覆蓋（僅 guard 用；省略＝沿用 preset）。 */
  maxAlive?: number;
  spawnThreshold?: number;
  spawnInterval?: number;
  spawns?: SpawnEntry[];
  /** 地雷陷阱參數（eventType='mineTrap' 用）。 */
  mineTrap?: MineTrapParams;
  /** 魔尖塔參數（eventType='towerWave' 用）。 */
  towerWave?: TowerWaveParams;
}

/**
 * 地雷陷阱參數（用戶：比照火雨全場自動撒，★不用手動座標）。
 * 落點重用 fireRainMath.pickFireRainPoint（全場 MAP_BOUNDS 隨機 + 縮邊 + 不重疊）撒 count 顆。
 * 用戶只設「幾顆 + 半徑 + 延遲 + 麻痺」，位置系統自動。實體/爆炸/麻痺（翼騎 applyStun）＝遊戲端。
 */
export interface MineTrapParams {
  /** 撒幾顆地雷（>=1；全場自動撒，不用座標）。 */
  count: number;
  /** 爆炸半徑（像素；>=0）。 */
  radiusPx: number;
  /** 延遲爆炸秒數（鋪下到爆炸；預設 3；>=0）。 */
  delaySec: number;
  /** 命中麻痺秒數（預設 3；>=0）。 */
  paralyzeSec: number;
  /** 縮邊額外距離（像素，撒點內縮避免貼邊；選填，省略＝0）。 */
  edgeMarginPx?: number;
}

/**
 * 魔尖塔參數（用戶：比照守護波，限時內打完全部尖塔＝過關、限時到＝失敗但不 GameOver 進下關）。
 * 尖塔怪 entity/環狀技執行期＝征騎；勝敗判定＝波騎（走既有 advance）；本 schema 定參數讓可設。
 */
export interface TowerWaveParams {
  /** 尖塔數（預設 4；>=1 整數）。 */
  towerCount: number;
  /** 限時秒數（限時內打完全部尖塔過關；>0）。 */
  timeLimitSec: number;
  /** 每座尖塔血量（>0）。 */
  towerHp: number;
  /** 環狀技參數（尖塔週期放的環狀攻擊；征騎執行期照吃）。 */
  ringSkill: RingSkillParams;
}

/**
 * 魔尖塔環狀技參數（對接征騎環狀技執行期算法）。尖塔週期放同心環往外擴、命中扣玩家能量+麻痺。
 * 欄位名為波騎↔征騎共用契約（已知會征騎）。
 */
export interface RingSkillParams {
  /** 一次放幾層同心環（預設 3；>=1 整數）。 */
  ringCount: number;
  /** 最內環半徑（像素；>=0）。 */
  baseRadiusPx: number;
  /** 每層環往外遞增半徑（像素/層；>=0）。第 i 環半徑 = baseRadiusPx + i*radiusStepPx。 */
  radiusStepPx: number;
  /** 每層環出現間隔秒（層與層之間；預設 0.6；>0）。 */
  ringIntervalSec: number;
  /** 環厚度（像素，判定帶寬；>0）。 */
  ringThicknessPx: number;
  /** 命中扣玩家能量段數（預設 2；>=0）。 */
  energyCost: number;
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
 * Event 節點驗證：依 eventType 分派（省略＝'guard'，向後相容）。
 * - guard/fireRain：需 eventPresetName 非空字串（+ guard 的 attachFireRain/drip 覆蓋選填）。
 * - mineTrap：需 mineTrap 撒佈參數（count>=1/radius>=0/delay>=0/paralyze>=0/edgeMargin? >=0）。
 * - towerWave：需 towerWave 參數（towerCount>=1/limit>0/hp>0/ringSkill 欄位）。
 */
function validateEventNode(node: Record<string, unknown>, at: string, errors: string[]): void {
  const et = node.eventType;
  if (et !== undefined && (typeof et !== 'string' || !EVENT_TYPES.includes(et as EventType))) {
    errors.push(`${at} 的「事件類型 eventType」="${String(et)}" 不合法（預期 ${EVENT_TYPES.join(' / ')} 或省略=guard）。`);
    return;
  }
  const eventType = (et as EventType) ?? 'guard';
  if (eventType === 'guard' || eventType === 'fireRain') {
    if (!isNonEmptyString(node.eventPresetName)) {
      errors.push(`${at} 的「事件預設名 eventPresetName」缺少或非非空字串（如 "Guard60"）。`);
    }
    if (node.attachFireRain !== undefined && !isNonEmptyString(node.attachFireRain)) {
      errors.push(`${at} 的「附加火雨 attachFireRain」若提供必須是非空字串（'none' 或火雨 preset 名）。`);
    }
    validateEventDrip(node, at, errors);
  } else if (eventType === 'mineTrap') {
    validateMineTrapParams(node.mineTrap, at, errors);
  } else if (eventType === 'towerWave') {
    validateTowerWaveParams(node.towerWave, at, errors);
  }
}

/** 地雷陷阱參數驗證（用戶：火雨式自動撒，count/radius/delay/paralyze + edgeMargin?）。 */
function validateMineTrapParams(raw: unknown, at: string, errors: string[]): void {
  const m = raw as Record<string, unknown> | undefined;
  if (typeof m !== 'object' || m === null) {
    errors.push(`${at} 的「地雷參數 mineTrap」缺少或不是物件。`);
    return;
  }
  if (!isFiniteNumber(m.count) || (m.count as number) < 1 || !Number.isInteger(m.count)) {
    errors.push(`${at} mineTrap「地雷數 count」缺少或非正整數（>=1）。`);
  }
  const nonNeg = (key: string, label: string): void => {
    const v = m[key];
    if (!isFiniteNumber(v)) errors.push(`${at} mineTrap「${label} ${key}」缺少或非數字。`);
    else if ((v as number) < 0) errors.push(`${at} mineTrap「${label} ${key}」=${v} 不可為負。`);
  };
  nonNeg('radiusPx', '爆炸半徑');
  nonNeg('delaySec', '延遲爆炸秒數');
  nonNeg('paralyzeSec', '麻痺秒數');
  if (m.edgeMarginPx !== undefined && (!isFiniteNumber(m.edgeMarginPx) || (m.edgeMarginPx as number) < 0)) {
    errors.push(`${at} mineTrap「縮邊 edgeMarginPx」若提供必須是非負數。`);
  }
}

/** 魔尖塔參數驗證（towerCount>=1/limit>0/hp>0/ringSkill 欄位）。 */
function validateTowerWaveParams(raw: unknown, at: string, errors: string[]): void {
  const t = raw as Record<string, unknown> | undefined;
  if (typeof t !== 'object' || t === null) {
    errors.push(`${at} 的「魔尖塔參數 towerWave」缺少或不是物件。`);
    return;
  }
  if (!isFiniteNumber(t.towerCount) || (t.towerCount as number) < 1 || !Number.isInteger(t.towerCount)) {
    errors.push(`${at} towerWave「尖塔數 towerCount」缺少或非正整數（>=1）。`);
  }
  if (!isFiniteNumber(t.timeLimitSec) || (t.timeLimitSec as number) <= 0) {
    errors.push(`${at} towerWave「限時 timeLimitSec」缺少或非正數。`);
  }
  if (!isFiniteNumber(t.towerHp) || (t.towerHp as number) <= 0) {
    errors.push(`${at} towerWave「尖塔血量 towerHp」缺少或非正數。`);
  }
  const ring = t.ringSkill as Record<string, unknown> | undefined;
  if (typeof ring !== 'object' || ring === null) {
    errors.push(`${at} towerWave「環狀技 ringSkill」缺少或不是物件。`);
    return;
  }
  const check = (key: string, label: string, positive: boolean, int = false): void => {
    const v = ring[key];
    if (!isFiniteNumber(v)) errors.push(`${at} ringSkill「${label} ${key}」缺少或非數字。`);
    else if (positive && (v as number) <= 0) errors.push(`${at} ringSkill「${label} ${key}」=${v} 必須 > 0。`);
    else if (!positive && (v as number) < 0) errors.push(`${at} ringSkill「${label} ${key}」=${v} 不可為負。`);
    else if (int && !Number.isInteger(v)) errors.push(`${at} ringSkill「${label} ${key}」=${v} 必須是整數。`);
  };
  check('ringCount', '環數', true, true);
  check('baseRadiusPx', '最內環半徑', false);
  check('radiusStepPx', '每層遞增半徑', false);
  check('ringIntervalSec', '每層間隔', true);
  check('ringThicknessPx', '環厚', true);
  check('energyCost', '扣能量段數', false);
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
