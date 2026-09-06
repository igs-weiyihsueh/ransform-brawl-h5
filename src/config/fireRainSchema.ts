/**
 * fireRainSchema.ts — 火雨 preset 表格式 + 驗證（火雨單獨編輯，遊戲讀取端 + firerain-editor 共用單一真相）。
 *
 * 對齊 dashSchema/enemySchema/skillSchema 模式：零 Phaser，只 import fireRainConfig 型別/值當打包預設。
 * 匯出結構 { version, presets: Record<name, FireRainPreset> }。FIRE_RAIN_PRESETS(fireRainConfig)當打包
 * 預設，override(localStorage)優先（override 的 preset 覆蓋同名、可新增；未覆蓋者沿用打包）。
 */
import {
  FIRE_RAIN_PRESETS,
  type FireRainPreset,
} from '@/config/fireRainConfig';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/** 匯出檔頂層（多 preset）。 */
export interface FireRainFile {
  version: number;
  presets: Record<string, FireRainPreset>;
}

export const FIRE_RAIN_SCHEMA_VERSION = 1 as const;

/** 從打包預設深拷貝一份 preset 表當初值（editor 初值 / resolve fallback）。 */
export function defaultFireRainPresets(): Record<string, FireRainPreset> {
  const out: Record<string, FireRainPreset> = {};
  for (const [name, p] of Object.entries(FIRE_RAIN_PRESETS)) out[name] = { ...p };
  return out;
}
export function defaultFireRainFile(): FireRainFile {
  return { version: FIRE_RAIN_SCHEMA_VERSION, presets: defaultFireRainPresets() };
}

// ---- 驗證（大聲失敗、精準定位；零遊戲依賴，只驗型別/範圍）---------------

export type ValidateFireRainResult =
  | { ok: true; data: FireRainFile }
  | { ok: false; errors: string[] };

export class FireRainValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`火雨參數驗證失敗（${errors.length} 項）：\n${errors.map((m) => `  - ${m}`).join('\n')}`);
    this.name = 'FireRainValidationError';
    this.errors = errors;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}
function checkNum(
  obj: Record<string, unknown>, key: string, label: string, errors: string[], opts: { min?: number; int?: boolean } = {},
): void {
  const v = obj[key];
  if (!isFiniteNumber(v)) errors.push(`${label}「${key}」缺少或非數字。`);
  else {
    if (opts.min !== undefined && v < opts.min) errors.push(`${label}「${key}」=${v} 不可小於 ${opts.min}。`);
    if (opts.int && !Number.isInteger(v)) errors.push(`${label}「${key}」=${v} 必須是整數。`);
  }
}

export function validateFireRain(json: unknown): ValidateFireRainResult {
  const errors: string[] = [];
  const root = asObject(json);
  if (!root) return { ok: false, errors: ['根層級必須是物件 { version, presets }。'] };

  if (!isFiniteNumber(root.version)) {
    errors.push('頂層「版本 version」缺少或非數字（預期 1）。');
  } else if (root.version !== FIRE_RAIN_SCHEMA_VERSION) {
    errors.push(`頂層「版本 version」=${String(root.version)} 不支援（此版本只接受 ${FIRE_RAIN_SCHEMA_VERSION}）。`);
  }

  const presets = asObject(root.presets);
  if (!presets) {
    errors.push('頂層「presets」缺少或不是物件。');
    return { ok: false, errors };
  }
  const names = Object.keys(presets);
  if (names.length === 0) errors.push('「presets」至少需一組火雨參數。');

  for (const name of names) {
    const p = asObject(presets[name]);
    const label = `火雨「${name}」`;
    if (!p) {
      errors.push(`${label} 不是物件。`);
      continue;
    }
    checkNum(p, 'intervalSec', label, errors, { min: 0 });
    checkNum(p, 'radiusPx', label, errors, { min: 0 });
    checkNum(p, 'warningSec', label, errors, { min: 0 });
    checkNum(p, 'damage', label, errors, { min: 0 });
    checkNum(p, 'maxConcurrent', label, errors, { min: 1, int: true });
    checkNum(p, 'burstCount', label, errors, { min: 1, int: true });
    checkNum(p, 'edgeMarginPx', label, errors, { min: 0 });
    checkNum(p, 'durationSec', label, errors, { min: 0 });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: root as unknown as FireRainFile };
}

export function assertValidFireRain(raw: unknown): FireRainFile {
  const result = validateFireRain(raw);
  if (!result.ok) throw new FireRainValidationError(result.errors);
  return result.data;
}

// ---- 遊戲讀取端：匯入 override 優先（火雨單獨編輯→套用生效）----------------

/**
 * 解析遊戲要用的火雨 preset 表（純函式，抽給測騎；同 resolveDash 模式）：
 * - override 通過 validateFireRain → 打包預設 merge override.presets（override 同名覆蓋、可新增、未覆蓋沿用）。
 * - override 為 null / 壞 / validate 失敗 → 回打包預設（行為 100% 不變）。
 * @param override loadOverride(EDITOR_STORE_KEYS.firerain) 的原始物件（未驗證）；null=無 override。
 * @param packaged 打包預設火雨 preset 表（預設 FIRE_RAIN_PRESETS）。
 */
export function resolveFireRain(
  override: unknown,
  packaged: Record<string, FireRainPreset> = FIRE_RAIN_PRESETS,
): Record<string, FireRainPreset> {
  if (override === null || override === undefined) return packaged;
  const result = validateFireRain(override);
  if (!result.ok) return packaged;
  return { ...packaged, ...result.data.presets };
}

/** 已解析的火雨 preset 表 cache（遊戲啟動讀一次；重開換）。 */
let resolvedFireRainCache: Record<string, FireRainPreset> | null = null;

/** 遊戲端取得火雨 preset 表（override 優先 + cache）。getFireRainPreset 用。 */
export function getResolvedFireRainPresets(): Record<string, FireRainPreset> {
  if (resolvedFireRainCache) return resolvedFireRainCache;
  const override = loadOverride(EDITOR_STORE_KEYS.firerain);
  if (override !== null) {
    const result = validateFireRain(override);
    if (!result.ok) console.warn('[fireRainSchema] firerain override 驗證失敗，改用打包預設：', result.errors);
  }
  resolvedFireRainCache = resolveFireRain(override);
  return resolvedFireRainCache;
}

/** 清空 cache（測試/熱重載用）。 */
export function clearResolvedFireRainCache(): void {
  resolvedFireRainCache = null;
}

/**
 * override-aware 火雨 preset 查詢（消費端用，取代 fireRainConfig.getFireRainPreset）：
 * 先查 resolved 表（override 優先），查無回打包 fallback（FIRE_RAIN_PRESETS.FireRain），不炸。
 */
export function getResolvedFireRainPreset(name: string | undefined): FireRainPreset {
  const table = getResolvedFireRainPresets();
  return (name && table[name]) || table.FireRain || FIRE_RAIN_PRESETS.FireRain;
}

/** override-aware：name 是否為（含 override 的）火雨 preset。 */
export function isResolvedFireRainPreset(name: string | undefined): boolean {
  return !!name && name in getResolvedFireRainPresets();
}
