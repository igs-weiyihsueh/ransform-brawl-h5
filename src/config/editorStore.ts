/**
 * 編輯器「套用到遊戲」localStorage 契約（匯入機制，異靈定 key）。
 *
 * 零遊戲依賴、純函式——**編輯器端(寫)與遊戲讀取端(翼騎，讀)共用此檔**，
 * 確保 key 與讀寫行為單一真相，避免兩邊各拼字串出錯。
 *
 * 流程：編輯器 validate 過 → applyToGame(key, json 物件) 存 localStorage
 *      → 遊戲啟動 loadOverride(key) 優先讀（無則用打包預設）。
 *      清除 → clearOverride(key) 回打包預設。
 */

/** 各編輯器/資料的 localStorage key（契約，勿改字串）。 */
export const EDITOR_STORE_KEYS = {
  uiLayout: 'transformbrawl:uiLayout',
  levels: 'transformbrawl:levels',
  enemies: 'transformbrawl:enemies',
  skills: 'transformbrawl:skills',
  dash: 'transformbrawl:dash',
  firerain: 'transformbrawl:firerain',
  guard: 'transformbrawl:guard',
  chest: 'transformbrawl:chest',
  hitfeel: 'transformbrawl:hitfeel',
  attackSpeed: 'transformbrawl:attackSpeed',
  mapBounds: 'transformbrawl:mapBounds',
  secondTransform: 'transformbrawl:secondTransform',
  grab: 'transformbrawl:grab',
} as const;

export type EditorStoreKey = (typeof EDITOR_STORE_KEYS)[keyof typeof EDITOR_STORE_KEYS];

/** localStorage 是否可用（SSR/隱私模式/受限環境安全檢查）。 */
function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * 套用到遊戲：把（已驗證的）資料物件序列化存進 localStorage。
 * 回傳是否成功（localStorage 不可用/配額滿時 false）。呼叫端應先 validate。
 */
export function applyToGame(key: EditorStoreKey, data: unknown): boolean {
  if (!hasLocalStorage()) return false;
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/**
 * 遊戲讀取端用（翼騎）：讀取套用中的 override 原始 JSON 物件；無 / 壞 JSON 回 null。
 * 讀到後仍應各自 validate（本函式只負責讀+parse，不驗 schema，保持零依賴）。
 */
export function loadOverride(key: EditorStoreKey): unknown | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** 清除套用：移除 override，遊戲回打包預設。 */
export function clearOverride(key: EditorStoreKey): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

/** 目前是否有套用中的 override（給編輯器顯示狀態）。 */
export function hasOverride(key: EditorStoreKey): boolean {
  if (!hasLocalStorage()) return false;
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/**
 * 各 override key 對應的「設定名稱」與「翼騎要寫進的 repo default config 位置」對照
 * （匯出 JSON 用，讓翼騎知道每份 override 該對應到哪個打包預設）。additive，純說明用。
 */
export const EDITOR_STORE_META: Record<
  keyof typeof EDITOR_STORE_KEYS,
  { key: EditorStoreKey; label: string; target: string }
> = {
  uiLayout: { key: EDITOR_STORE_KEYS.uiLayout, label: 'UI 版面', target: 'src/config/uiLayoutSchema.ts (預設版面)' },
  levels: { key: EDITOR_STORE_KEYS.levels, label: '關卡', target: 'src/config/levelSchema.ts / levels 資料' },
  enemies: { key: EDITOR_STORE_KEYS.enemies, label: '怪物', target: 'src/config/enemyConfig.ts ENEMY_AI' },
  skills: { key: EDITOR_STORE_KEYS.skills, label: '招式', target: 'src/config/skill 設定' },
  dash: { key: EDITOR_STORE_KEYS.dash, label: '衝刺', target: 'src/config/combatConfig.ts DASH_CONFIG' },
  firerain: { key: EDITOR_STORE_KEYS.firerain, label: '火雨', target: 'src/config 火雨 preset' },
  guard: { key: EDITOR_STORE_KEYS.guard, label: '守護波', target: 'src/config/guardConfig.ts GUARD_PRESETS' },
  chest: { key: EDITOR_STORE_KEYS.chest, label: '寶箱', target: 'src/config/chestConfig 設定' },
  hitfeel: { key: EDITOR_STORE_KEYS.hitfeel, label: '打擊感', target: 'src/config/hitFeelConfig.ts HIT_FEEL' },
  attackSpeed: { key: EDITOR_STORE_KEYS.attackSpeed, label: '攻擊速度', target: 'src/config 攻擊速度設定' },
  mapBounds: { key: EDITOR_STORE_KEYS.mapBounds, label: '地圖邊界', target: 'src/config/mapConfig.ts MAP_BOUNDS_UNITS' },
  secondTransform: { key: EDITOR_STORE_KEYS.secondTransform, label: '二段變身', target: 'src/config/combatConfig.ts SECOND_TRANSFORM_CONFIG' },
  grab: { key: EDITOR_STORE_KEYS.grab, label: '被抓觸發', target: 'src/systems/grabMath.ts GRAB.idleTriggerSeconds' },
} as const;

/** 匯出全部設定的結構（下載 JSON 的頂層）。 */
export interface ExportedSettings {
  /** 匯出格式版本。 */
  exportVersion: number;
  /** 匯出時間（ISO）。 */
  exportedAt: string;
  /**
   * 各設定的 override 值（只含用戶實際調過、localStorage 有存的 key）。
   * value = 該 override 的原始 JSON 物件（含其自身 version），可直接對照寫進 repo default。
   */
  settings: Record<string, { key: string; label: string; target: string; value: unknown }>;
  /** 未設定（localStorage 無值、吃打包預設）的設定名清單，供翼騎確認哪些不用改。 */
  unset: string[];
}

export const SETTINGS_EXPORT_VERSION = 1 as const;

/**
 * 匯出當前全部設定（純讀 localStorage，additive；不改任何套用/讀取邏輯）。
 * 只收有存 override 的 key（用戶實際調過的）→ 結構化物件（每 key 標 label + 翼騎對應 target + 原始值）；
 * 沒調的列進 unset。localStorage 不可用時回空 settings（graceful，不炸）。
 */
export function exportAllSettings(now: Date = new Date()): ExportedSettings {
  const settings: ExportedSettings['settings'] = {};
  const unset: string[] = [];
  for (const name of Object.keys(EDITOR_STORE_META) as (keyof typeof EDITOR_STORE_KEYS)[]) {
    const meta = EDITOR_STORE_META[name];
    const raw = loadOverride(meta.key); // 已 graceful（localStorage 不可用/壞 JSON→null）
    if (raw !== null) {
      settings[name] = { key: meta.key, label: meta.label, target: meta.target, value: raw };
    } else {
      unset.push(name);
    }
  }
  return {
    exportVersion: SETTINGS_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    settings,
    unset,
  };
}

/** 匯出檔名（帶日期戳）：transform-brawl-settings-YYYYMMDD.json。 */
export function exportSettingsFilename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `transform-brawl-settings-${y}${m}${d}.json`;
}

/** 匯入結果（給 UI 顯示狀態）。 */
export interface ImportSettingsResult {
  /** 成功寫入 localStorage 的設定名（label）。 */
  imported: string[];
  /** JSON 沒帶到、保持不變的設定名（label）。 */
  skipped: string[];
  /** JSON 有、但不認得的 key 名（略過）。 */
  unknown: string[];
  /** 是否有任何一項成功匯入。 */
  ok: boolean;
}

/**
 * 從匯出結構取出「各設定名 → override 值」的對照（純函式，抽給測騎，容錯）。
 * 相容兩種格式：
 *  - 完整匯出檔 `{ settings: { name: { value } } }`（exportAllSettings 產物）。
 *  - 裸對照 `{ name: value }`（value 直接是各 override 物件，如 {version,hitFeel}）。
 * 只回 EDITOR_STORE_META 認得的 name；value===undefined 的略過（缺項不動）。
 * @returns { values: {name→value}, unknown: 不認得的 name[] }
 */
export function parseImportedSettings(json: unknown): {
  values: Partial<Record<keyof typeof EDITOR_STORE_KEYS, unknown>>;
  unknown: string[];
} {
  const values: Partial<Record<keyof typeof EDITOR_STORE_KEYS, unknown>> = {};
  const unknown: string[] = [];
  const root = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
  if (!root) return { values, unknown };
  // 完整匯出檔：取 root.settings；否則整個 root 當裸對照。
  const settingsObj =
    root.settings && typeof root.settings === 'object'
      ? (root.settings as Record<string, unknown>)
      : root;
  const known = new Set(Object.keys(EDITOR_STORE_META));
  for (const name of Object.keys(settingsObj)) {
    if (name === 'exportVersion' || name === 'exportedAt' || name === 'unset') continue; // 完整檔的 meta 欄位
    if (!known.has(name)) { unknown.push(name); continue; }
    const entry = settingsObj[name];
    // 完整檔 entry={key,label,target,value} → 取 value；裸對照 entry 直接是 value。
    const value =
      entry && typeof entry === 'object' && 'value' in (entry as object)
        ? (entry as { value: unknown }).value
        : entry;
    if (value === undefined) continue; // 缺項不動
    values[name as keyof typeof EDITOR_STORE_KEYS] = value;
  }
  return { values, unknown };
}

/**
 * 匯入全部設定到 localStorage（applyToGame 分派，對齊 exportAllSettings 反向；additive、容錯）。
 * - 依 EDITOR_STORE_META 分派：JSON 有值的設定 → applyToGame(meta.key, value) 存 localStorage。
 * - ★缺項保持不變（不清空原有 override）；不認得的 key 略過（列 unknown）。
 * - 版本/欄位不符不在此擋（各編輯器 resolve/validate 讀取時逐欄相容 merge）——匯入只負責分派存值。
 * @param json 已 parse 的匯入 JSON（呼叫端負責 JSON.parse + try/catch 格式錯）。
 * @returns 匯入結果（imported/skipped/unknown/ok）。localStorage 不可用時 imported 空、ok=false。
 */
export function importAllSettings(json: unknown): ImportSettingsResult {
  const { values, unknown } = parseImportedSettings(json);
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const name of Object.keys(EDITOR_STORE_META) as (keyof typeof EDITOR_STORE_KEYS)[]) {
    const meta = EDITOR_STORE_META[name];
    if (name in values) {
      const ok = applyToGame(meta.key, values[name]);
      if (ok) imported.push(meta.label);
      else skipped.push(meta.label); // localStorage 不可用
    } else {
      skipped.push(meta.label); // JSON 沒帶到 → 保持不變
    }
  }
  return { imported, skipped, unknown, ok: imported.length > 0 };
}
