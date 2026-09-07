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

/** 匯出檔格式版本（結構改動時 bump，翼騎對應寫入時可判版）。 */
export const SETTINGS_EXPORT_VERSION = 1;

/** 各 store key 對應「設定名稱」+「翼騎寫入的 repo default 提示」（給匯出 JSON 標明用途）。 */
const KEY_META: Record<
  keyof typeof EDITOR_STORE_KEYS,
  { label: string; targetDefault: string }
> = {
  uiLayout: { label: 'UI/HUD 版面（位置/大小/字級/顏色等）', targetDefault: 'src/config/uiConfig.ts (DEFAULT_UI_LAYOUT 及各 resolveXXX 預設)' },
  levels: { label: '關卡/波次設定', targetDefault: 'src/config/levelConfig.ts (或關卡資料)' },
  enemies: { label: '敵人設定', targetDefault: 'src/config/enemyConfig.ts' },
  skills: { label: '技能設定', targetDefault: 'src/config/skillConfig.ts' },
  dash: { label: '衝刺(dash)設定', targetDefault: 'src/config/dashConfig.ts' },
  firerain: { label: '火雨事件設定', targetDefault: 'src/config/firerainConfig.ts' },
  guard: { label: '守護波設定', targetDefault: 'src/config/guardConfig.ts (或事件設定)' },
  chest: { label: '寶箱設定', targetDefault: 'src/config/chestConfig.ts' },
  hitfeel: { label: '打擊感(hitfeel)設定', targetDefault: 'src/config/hitfeelConfig.ts' },
  attackSpeed: { label: '攻擊速度設定', targetDefault: 'src/config/attackConfig.ts (或戰鬥設定)' },
  mapBounds: { label: '地圖邊界設定', targetDefault: 'src/config/mapConfig.ts (或場景邊界)' },
};

/** 單一 key 匯出項。 */
export interface ExportedSettingEntry {
  /** localStorage key 全名（契約字串）。 */
  storageKey: string;
  /** 人類可讀設定名稱。 */
  label: string;
  /** 翼騎對應寫進哪個 repo default config 的提示。 */
  targetDefault: string;
  /** 使用者是否實際調過（localStorage 有值）。 */
  configured: boolean;
  /** 當前值（configured 才有；已 parse 的物件）。未設定為 null。 */
  value: unknown | null;
}

/** 匯出全部設定的檔案結構。 */
export interface SettingsExport {
  format: 'transform-brawl-settings';
  version: number;
  /** ISO 匯出時間。 */
  exportedAt: string;
  /** 有幾個 key 被實際調過（configured）。 */
  configuredCount: number;
  /** 各設定 key → 值 + 用途/對應 default 提示。 */
  settings: Record<string, ExportedSettingEntry>;
}

/**
 * 匯出當前全部設定（純讀 localStorage，additive，不改任何既有套用/讀取邏輯）。
 *
 * 收集 EDITOR_STORE_KEYS 全部 key 的當前 localStorage 值，打包成結構化 JSON：
 *  - 有調過的 key → configured:true + 已 parse 的 value；
 *  - 沒調過 → configured:false + value:null（標明「用打包預設」）。
 * 每個 key 附 label（設定名稱）+ targetDefault（翼騎要寫進哪個 repo default）+ version。
 * localStorage 不可用 → 仍回一份 configuredCount:0 的骨架（呼叫端可提示無設定）。
 */
export function exportAllSettings(now: Date = new Date()): SettingsExport {
  const settings: Record<string, ExportedSettingEntry> = {};
  let configuredCount = 0;
  const available = hasLocalStorage();
  for (const [name, storageKey] of Object.entries(EDITOR_STORE_KEYS)) {
    const meta = KEY_META[name as keyof typeof EDITOR_STORE_KEYS];
    const value = available ? loadOverride(storageKey as EditorStoreKey) : null;
    const configured = value !== null;
    if (configured) configuredCount++;
    settings[name] = {
      storageKey,
      label: meta.label,
      targetDefault: meta.targetDefault,
      configured,
      value,
    };
  }
  return {
    format: 'transform-brawl-settings',
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    configuredCount,
    settings,
  };
}
