/**
 * 版本自動更新檢查——純函式層（可單元測試，不依賴 DOM/fetch）。
 *
 * 根治「GitHub Pages 更新後用戶載到舊版（index.html HTTP max-age=600 快取、無 SW）」：
 * build 時產 version.json（帶 build hash），app 啟動時記住自己的 build hash，
 * 定期 fetch version.json（cache-bust）比對——不同＝有新版部署→提示/reload。
 */

/** version.json 內容結構（build 時由 vite plugin 產出）。 */
export interface VersionInfo {
  /** build 唯一識別（commit hash 或 build 時間戳，內容變則變）。 */
  version: string;
  /** commit 短 hash（可選，人看用）。 */
  commit?: string;
  /** build 時間（ISO 字串，人看用）。 */
  builtAt?: string;
}

/**
 * 是否偵測到新版本 → 該提示/reload。
 * 規則：兩邊 version 都非空、且不相等 → true（有新版）。
 * 任一為空（尚未載到/build 未注入）→ false（不誤報）。
 * @param current 當前載入 app 的 build version（build 時注入）。
 * @param fetched 剛 fetch 到的 version.json 的 version。
 */
export function isNewVersion(current: string | null | undefined, fetched: string | null | undefined): boolean {
  if (!current || !fetched) return false;
  return current !== fetched;
}

/**
 * 給 version.json fetch 用的 cache-bust URL——加 ?t=timestamp query 確保不吃任何快取。
 * @param baseUrl version.json 路徑（相對，配合 Vite base './'）。
 * @param now 時間戳（預設 Date.now()）。
 */
export function buildVersionUrl(baseUrl: string, now: number = Date.now()): string {
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}t=${now}`;
}

/**
 * 安全解析 version.json 回應（容錯：格式不符回 null，不炸）。
 * @param raw fetch 到的 JSON（unknown）。
 */
export function parseVersionInfo(raw: unknown): VersionInfo | null {
  if (raw == null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version !== 'string' || obj.version.length === 0) return null;
  return {
    version: obj.version,
    commit: typeof obj.commit === 'string' ? obj.commit : undefined,
    builtAt: typeof obj.builtAt === 'string' ? obj.builtAt : undefined,
  };
}
