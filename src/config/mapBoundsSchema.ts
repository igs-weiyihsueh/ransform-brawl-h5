/**
 * mapBoundsSchema.ts — 地圖邊界格式 + 驗證 + override 解析（地圖邊界可調，遊戲讀取端 + mapbounds-editor 共用單一真相）。
 *
 * 對齊 dashSchema/guardSchema/hitFeelSchema 模式：零 Phaser、零遊戲 runtime 依賴（不 import mapConfig，避免循環）。
 * 邊界為 Unity 世界單位（中心原點）：{minX,maxX,minY,maxY}（unit 級，×PPU=px 在 mapConfig 換算）。
 * 匯出結構 { version, bounds: MapBoundsUnits }。打包預設由 mapConfig 傳入（MAP_BOUNDS_UNITS），override(localStorage)優先。
 *
 * ★0/負值語意（異靈定，第十五輪）：邊界座標**可負可 0**（unit 級中心原點，minX 通常負、可為 0）
 *   → resolveMapBounds 逐欄用 `??`（非 ||，|| 會把 0 當 falsy 誤退回預設）。
 *   但幾何約束 **minX < maxX / minY < maxY 必須**（validate 擋反轉/退化，避免場地寬高 <=0）。
 */
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/** 地圖邊界（Unity 世界單位，中心原點矩形）。 */
export interface MapBoundsUnits {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 匯出檔頂層。 */
export interface MapBoundsFile {
  version: number;
  bounds: MapBoundsUnits;
}

export const MAP_BOUNDS_SCHEMA_VERSION = 1 as const;

// ---- 驗證（大聲失敗、精準定位；零遊戲依賴，只驗型別/幾何）------------------

export type ValidateMapBoundsResult =
  | { ok: true; data: MapBoundsFile }
  | { ok: false; errors: string[] };

export class MapBoundsValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`地圖邊界驗證失敗（${errors.length} 項）：\n${errors.map((m) => `  - ${m}`).join('\n')}`);
    this.name = 'MapBoundsValidationError';
    this.errors = errors;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

/**
 * 驗證地圖邊界（★座標可負可 0，只擋非數字 + 幾何反轉/退化 minX>=maxX、minY>=maxY）。
 * 另擋過大範圍（|coord|>1000 unit 視為輸入錯誤，避免誤設天文數字）。
 */
export function validateMapBounds(json: unknown): ValidateMapBoundsResult {
  const errors: string[] = [];
  const root = asObject(json);
  if (!root) return { ok: false, errors: ['根層級必須是物件 { version, bounds }。'] };

  if (!isFiniteNumber(root.version)) {
    errors.push('頂層「版本 version」缺少或非數字（預期 1）。');
  } else if (root.version !== MAP_BOUNDS_SCHEMA_VERSION) {
    errors.push(`頂層「版本 version」=${String(root.version)} 不支援（此版本只接受 ${MAP_BOUNDS_SCHEMA_VERSION}）。`);
  }

  const b = asObject(root.bounds);
  if (!b) {
    errors.push('頂層「bounds」缺少或不是物件。');
    return { ok: false, errors };
  }
  const LIMIT = 1000; // unit：合理上限（避免誤設天文數字）
  for (const key of ['minX', 'maxX', 'minY', 'maxY'] as const) {
    const v = b[key];
    if (!isFiniteNumber(v)) errors.push(`地圖邊界「${key}」缺少或非數字。`); // ★0/負合法，只擋非數字
    else if (v < -LIMIT || v > LIMIT) errors.push(`地圖邊界「${key}」=${v} 超出合理範圍 ±${LIMIT} unit。`);
  }
  // 幾何約束：min < max（擋反轉/退化，場地寬高必須 >0）。
  if (isFiniteNumber(b.minX) && isFiniteNumber(b.maxX) && b.minX >= b.maxX) {
    errors.push(`地圖邊界 minX(${b.minX}) 必須小於 maxX(${b.maxX})。`);
  }
  if (isFiniteNumber(b.minY) && isFiniteNumber(b.maxY) && b.minY >= b.maxY) {
    errors.push(`地圖邊界 minY(${b.minY}) 必須小於 maxY(${b.maxY})。`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: root as unknown as MapBoundsFile };
}

export function assertValidMapBounds(raw: unknown): MapBoundsFile {
  const result = validateMapBounds(raw);
  if (!result.ok) throw new MapBoundsValidationError(result.errors);
  return result.data;
}

// ---- 遊戲讀取端：匯入 override 優先（邊界可調→套用生效）--------------------

/**
 * 解析遊戲要用的地圖邊界（純函式，抽給測騎；同 resolveDash/resolveHitFeel 模式）：
 * - override 通過 validateMapBounds → 逐欄 override.bounds.X ?? 打包 packaged.X（★0/負合法，?? 非 ||）。
 * - override 為 null / 壞 / validate 失敗 → 回打包預設（行為 100% 不變）。
 * @param override loadOverride(EDITOR_STORE_KEYS.mapBounds) 的原始物件（未驗證）；null=無 override。
 * @param packaged 打包預設邊界（由 mapConfig 傳 MAP_BOUNDS_UNITS，避免循環 import）。
 */
export function resolveMapBounds(override: unknown, packaged: MapBoundsUnits): MapBoundsUnits {
  if (override === null || override === undefined) return { ...packaged };
  const result = validateMapBounds(override);
  if (!result.ok) return { ...packaged };
  const o = result.data.bounds;
  return {
    minX: o.minX ?? packaged.minX, // ★0/負合法：?? 不被 || 吃
    maxX: o.maxX ?? packaged.maxX,
    minY: o.minY ?? packaged.minY,
    maxY: o.maxY ?? packaged.maxY,
  };
}

/** 已解析的地圖邊界 cache（模組初始化讀一次；重開換，符合「套用→重開生效」）。 */
let resolvedCache: MapBoundsUnits | null = null;

/**
 * 遊戲端取得地圖邊界（override 優先 + cache）。mapConfig 模組初始化時呼叫。
 * @param packaged 打包預設（mapConfig 傳 MAP_BOUNDS_UNITS）。
 */
export function getResolvedMapBoundsUnits(packaged: MapBoundsUnits): MapBoundsUnits {
  if (resolvedCache) return resolvedCache;
  const override = loadOverride(EDITOR_STORE_KEYS.mapBounds);
  if (override !== null) {
    const result = validateMapBounds(override);
    if (!result.ok) console.warn('[mapBoundsSchema] mapBounds override 驗證失敗，改用打包預設：', result.errors);
  }
  resolvedCache = resolveMapBounds(override, packaged);
  return resolvedCache;
}

/** 清空 cache（測試/熱重載用）。 */
export function clearResolvedMapBoundsCache(): void {
  resolvedCache = null;
}
