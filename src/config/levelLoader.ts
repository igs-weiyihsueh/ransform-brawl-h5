import {
  type LevelData,
  type LevelsFile,
  validateLevels,
} from '@/config/levelSchema';

/**
 * levelLoader.ts — 關卡 JSON 載入器。
 *
 * 職責：抓 public/assets/data/levels.json → JSON.parse → validateLevels 驗證 →
 * 回傳已驗證的 levels。**大聲失敗**：任何一步錯都拋例外並在 console 印出
 * 精準錯誤（哪一關/哪個 node/哪個欄位），絕不靜默生不出怪讓人誤以為別的 bug。
 *
 * 零遊戲依賴消費 schema（validateLevels）。載入用瀏覽器 fetch，
 * 路徑相對於 Vite base（import.meta.env.BASE_URL），對應 public/ 下的 assets/data/。
 */

/** 預設關卡 JSON 相對路徑（public/ 對應網站根的 assets/data/）。 */
export const DEFAULT_LEVELS_URL = 'assets/data/levels.json';

/** 載入失敗時拋出的錯誤，訊息已含精準定位。 */
export class LevelLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LevelLoadError';
  }
}

/** 把相對路徑接上 Vite base（部署在子路徑如 GitHub Pages 也正確）。 */
function resolveUrl(url: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  // 避免 base 尾斜線與 url 前斜線造成雙斜線。
  return `${base.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
}

/**
 * 載入並驗證關卡檔。成功回傳 levels[]；失敗拋 LevelLoadError（並先 console.error）。
 *
 * @param url 關卡 JSON 路徑（相對，預設 assets/data/levels.json）。
 */
export async function loadLevels(url: string = DEFAULT_LEVELS_URL): Promise<LevelData[]> {
  const full = resolveUrl(url);

  let res: Response;
  try {
    res = await fetch(full);
  } catch (e) {
    return fail(`無法讀取關卡檔 ${full}：${(e as Error).message}`);
  }
  if (!res.ok) {
    return fail(`讀取關卡檔 ${full} 失敗：HTTP ${res.status} ${res.statusText}`);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch (e) {
    return fail(`關卡檔 ${full} 不是合法 JSON：${(e as Error).message}`);
  }

  const result = validateLevels(raw);
  if (!result.ok) {
    const detail = result.errors.map((m) => `  - ${m}`).join('\n');
    return fail(`關卡檔 ${full} 驗證失敗（${result.errors.length} 項）：\n${detail}`);
  }

  return result.data.levels;
}

/**
 * 直接驗證一份已 parse 的 LevelsFile 物件（供測試/編輯器預覽用），
 * 同樣大聲失敗。
 */
export function assertValidLevels(raw: unknown): LevelsFile {
  const result = validateLevels(raw);
  if (!result.ok) {
    const detail = result.errors.map((m) => `  - ${m}`).join('\n');
    return fail(`關卡資料驗證失敗（${result.errors.length} 項）：\n${detail}`);
  }
  return result.data;
}

/** 統一的大聲失敗：先 console.error 再拋。回傳型別 never 讓呼叫端類型收斂。 */
function fail(message: string): never {
  // 大聲：確保錯誤在 console 一眼可見（不靜默）。
  console.error(`[levelLoader] ${message}`);
  throw new LevelLoadError(message);
}
