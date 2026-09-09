/**
 * mineSchema.ts — 地雷 preset 表格式 + 驗證（地雷單獨編輯，遊戲讀取端 + event-editor 共用單一真相）。
 *
 * 對齊 fireRainSchema 模式：零 Phaser，只 import mineConfig 型別/值當打包預設。
 * 匯出結構 { version, presets: Record<name, MinePreset> }。MINE_PRESETS(mineConfig)當打包預設，
 * override(localStorage EDITOR_STORE_KEYS.mine)優先（override 同名覆蓋、可新增；未覆蓋沿用打包）。
 */
import {
  MINE_PRESETS,
  type MinePreset,
} from '@/config/mineConfig';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/** 匯出檔頂層（多 preset）。 */
export interface MineFile {
  version: number;
  presets: Record<string, MinePreset>;
}

export const MINE_SCHEMA_VERSION = 1 as const;

/** 從打包預設深拷貝一份 preset 表當初值（editor 初值 / resolve fallback）。 */
export function defaultMinePresets(): Record<string, MinePreset> {
  const out: Record<string, MinePreset> = {};
  for (const [name, p] of Object.entries(MINE_PRESETS)) out[name] = { ...p };
  return out;
}
export function defaultMineFile(): MineFile {
  return { version: MINE_SCHEMA_VERSION, presets: defaultMinePresets() };
}

// ---- 驗證（大聲失敗、精準定位；零遊戲依賴，只驗型別/範圍）---------------

export type ValidateMineResult =
  | { ok: true; data: MineFile }
  | { ok: false; errors: string[] };

export class MineValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`地雷參數驗證失敗（${errors.length} 項）：\n${errors.map((m) => `  - ${m}`).join('\n')}`);
    this.name = 'MineValidationError';
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
function checkNumOptional(
  obj: Record<string, unknown>, key: string, label: string, errors: string[], opts: { min?: number } = {},
): void {
  if (obj[key] === undefined) return;
  checkNum(obj, key, label, errors, opts);
}

export function validateMine(json: unknown): ValidateMineResult {
  const errors: string[] = [];
  const root = asObject(json);
  if (!root) return { ok: false, errors: ['根層級必須是物件 { version, presets }。'] };

  if (!isFiniteNumber(root.version)) {
    errors.push('頂層「版本 version」缺少或非數字（預期 1）。');
  } else if (root.version !== MINE_SCHEMA_VERSION) {
    errors.push(`頂層「版本 version」=${String(root.version)} 不支援（此版本只接受 ${MINE_SCHEMA_VERSION}）。`);
  }

  const presets = asObject(root.presets);
  if (!presets) {
    errors.push('頂層「presets」缺少或不是物件。');
    return { ok: false, errors };
  }
  const names = Object.keys(presets);
  if (names.length === 0) errors.push('「presets」至少需一組地雷參數。');

  for (const name of names) {
    const p = asObject(presets[name]);
    const label = `地雷「${name}」`;
    if (!p) {
      errors.push(`${label} 不是物件。`);
      continue;
    }
    checkNum(p, 'count', label, errors, { min: 1, int: true });
    checkNum(p, 'radiusPx', label, errors, { min: 0 });
    checkNum(p, 'delaySec', label, errors, { min: 0 });
    checkNum(p, 'paralyzeSec', label, errors, { min: 0 });
    checkNumOptional(p, 'edgeMarginPx', label, errors, { min: 0 });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: root as unknown as MineFile };
}

export function assertValidMine(raw: unknown): MineFile {
  const result = validateMine(raw);
  if (!result.ok) throw new MineValidationError(result.errors);
  return result.data;
}

// ---- 遊戲讀取端：匯入 override 優先（地雷單獨編輯→套用生效）----------------

/**
 * 解析遊戲要用的地雷 preset 表（純函式，抽給測騎；同 resolveFireRain 模式）：
 * - override 通過 validateMine → 打包預設 merge override.presets（override 同名覆蓋、可新增、未覆蓋沿用）。
 * - override 為 null / 壞 / validate 失敗 → 回打包預設（行為 100% 不變）。
 */
export function resolveMine(
  override: unknown,
  packaged: Record<string, MinePreset> = MINE_PRESETS,
): Record<string, MinePreset> {
  if (override === null || override === undefined) return packaged;
  const result = validateMine(override);
  if (!result.ok) return packaged;
  return { ...packaged, ...result.data.presets };
}

/** 已解析的地雷 preset 表 cache（遊戲啟動讀一次；重開換）。 */
let resolvedMineCache: Record<string, MinePreset> | null = null;

/** 遊戲端取得地雷 preset 表（override 優先 + cache）。 */
export function getResolvedMinePresets(): Record<string, MinePreset> {
  if (resolvedMineCache) return resolvedMineCache;
  const override = loadOverride(EDITOR_STORE_KEYS.mine);
  if (override !== null) {
    const result = validateMine(override);
    if (!result.ok) console.warn('[mineSchema] mine override 驗證失敗，改用打包預設：', result.errors);
  }
  resolvedMineCache = resolveMine(override);
  return resolvedMineCache;
}

/** 清空 cache（測試/熱重載用）。 */
export function clearResolvedMineCache(): void {
  resolvedMineCache = null;
}

/**
 * override-aware 地雷 preset 查詢（消費端用，取代 mineConfig.getResolvedMinePreset）：
 * 先查 resolved 表（override 優先），查無回打包 fallback（MINE_PRESETS.Mine），不炸。
 */
export function getResolvedMinePreset(name: string | undefined): MinePreset {
  const table = getResolvedMinePresets();
  return (name && table[name]) || table.Mine || MINE_PRESETS.Mine;
}

/** override-aware：name 是否為（含 override 的）地雷 preset。 */
export function isResolvedMinePreset(name: string | undefined): boolean {
  return !!name && name in getResolvedMinePresets();
}
