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
