/**
 * guardSchema.ts — 守護波 preset 表格式 + 驗證（守護波單獨編輯，遊戲讀取端 + guard-editor 共用單一真相）。
 *
 * 對齊 dashSchema/fireRainSchema 模式：零 Phaser，只 import guardConfig 型別/值當打包預設。
 * 匯出結構 { version, presets: Record<name, GuardPreset> }。GUARD_PRESETS(guardConfig)當打包預設，
 * override(localStorage)優先（override 的 preset 覆蓋同名、可新增；未覆蓋者沿用打包）。
 */
import {
  GUARD_PRESETS,
  type GuardPreset,
  type GuardSpawnEntry,
} from '@/config/guardConfig';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/** 匯出檔頂層（多 preset）。 */
export interface GuardFile {
  version: number;
  presets: Record<string, GuardPreset>;
}

export const GUARD_SCHEMA_VERSION = 1 as const;

/** 從打包預設深拷貝一份 preset 表當初值（editor 初值 / resolve fallback）。 */
export function defaultGuardPresets(): Record<string, GuardPreset> {
  const out: Record<string, GuardPreset> = {};
  for (const [name, p] of Object.entries(GUARD_PRESETS)) {
    out[name] = { ...p, spawns: p.spawns.map((s) => ({ ...s })) };
  }
  return out;
}
export function defaultGuardFile(): GuardFile {
  return { version: GUARD_SCHEMA_VERSION, presets: defaultGuardPresets() };
}

// ---- 驗證（大聲失敗、精準定位；零遊戲依賴，只驗型別/範圍）---------------

export type ValidateGuardResult =
  | { ok: true; data: GuardFile }
  | { ok: false; errors: string[] };

export class GuardValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`守護波參數驗證失敗（${errors.length} 項）：\n${errors.map((m) => `  - ${m}`).join('\n')}`);
    this.name = 'GuardValidationError';
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

function checkSpawns(p: Record<string, unknown>, label: string, errors: string[]): void {
  const spawns = p.spawns;
  if (!Array.isArray(spawns)) {
    errors.push(`${label}「spawns」缺少或不是陣列。`);
    return;
  }
  if (spawns.length === 0) errors.push(`${label}「spawns」至少需一種敵種。`);
  spawns.forEach((raw, i) => {
    const s = asObject(raw) as (GuardSpawnEntry & Record<string, unknown>) | null;
    if (!s) {
      errors.push(`${label} spawns[${i}] 不是物件。`);
      return;
    }
    if (typeof s.enemyType !== 'string' || s.enemyType.trim() === '') {
      errors.push(`${label} spawns[${i}]「enemyType」=${String(s.enemyType)} 需非空字串（敵種合法性由 enemies 定義把關）。`);
    }
    checkNum(s, 'weight', `${label} spawns[${i}]`, errors, { min: 0 });
  });
}

export function validateGuard(json: unknown): ValidateGuardResult {
  const errors: string[] = [];
  const root = asObject(json);
  if (!root) return { ok: false, errors: ['根層級必須是物件 { version, presets }。'] };

  if (!isFiniteNumber(root.version)) {
    errors.push('頂層「版本 version」缺少或非數字（預期 1）。');
  } else if (root.version !== GUARD_SCHEMA_VERSION) {
    errors.push(`頂層「版本 version」=${String(root.version)} 不支援（此版本只接受 ${GUARD_SCHEMA_VERSION}）。`);
  }

  const presets = asObject(root.presets);
  if (!presets) {
    errors.push('頂層「presets」缺少或不是物件。');
    return { ok: false, errors };
  }
  const names = Object.keys(presets);
  if (names.length === 0) errors.push('「presets」至少需一組守護參數。');

  for (const name of names) {
    const p = asObject(presets[name]);
    const label = `守護波「${name}」`;
    if (!p) {
      errors.push(`${label} 不是物件。`);
      continue;
    }
    checkNum(p, 'timeLimit', label, errors, { min: 0 });
    checkNum(p, 'targetHP', label, errors, { min: 1 });
    checkNum(p, 'rewardTickets', label, errors, { min: 0 });
    checkNum(p, 'maxAlive', label, errors, { min: 0, int: true });
    checkNum(p, 'spawnThreshold', label, errors, { min: 0, int: true });
    checkNum(p, 'spawnInterval', label, errors, { min: 0 });
    checkNum(p, 'spawnRadiusPx', label, errors, { min: 0 });
    checkNum(p, 'cornerOffsetXPx', label, errors, { min: 0 });
    checkNum(p, 'cornerOffsetYPx', label, errors, { min: 0 });
    checkNum(p, 'introFocusSec', label, errors, { min: 0 });
    checkNum(p, 'maxWalkSec', label, errors, { min: 0 });
    checkNum(p, 'spotlightRadiusPx', label, errors, { min: 0 });
    checkSpawns(p, label, errors);
    // attachFireRain 選填：省略或字串皆可（火雨 preset 名，遊戲端 getFireRainPreset fallback 不炸）。
    if (p.attachFireRain !== undefined && typeof p.attachFireRain !== 'string') {
      errors.push(`${label}「attachFireRain」必須是字串（火雨 preset 名）或省略。`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: root as unknown as GuardFile };
}

export function assertValidGuard(raw: unknown): GuardFile {
  const result = validateGuard(raw);
  if (!result.ok) throw new GuardValidationError(result.errors);
  return result.data;
}

// ---- 遊戲讀取端：匯入 override 優先（守護波單獨編輯→套用生效）--------------

/**
 * 解析遊戲要用的守護波 preset 表（純函式，抽給測騎；同 resolveDash/resolveFireRain 模式）：
 * - override 通過 validateGuard → 打包預設 merge override.presets（override 同名覆蓋、可新增、未覆蓋沿用）。
 * - override 為 null / 壞 / validate 失敗 → 回打包預設（行為 100% 不變）。
 * @param override loadOverride(EDITOR_STORE_KEYS.guard) 的原始物件（未驗證）；null=無 override。
 * @param packaged 打包預設守護 preset 表（預設 GUARD_PRESETS）。
 */
export function resolveGuard(
  override: unknown,
  packaged: Record<string, GuardPreset> = GUARD_PRESETS,
): Record<string, GuardPreset> {
  if (override === null || override === undefined) return packaged;
  const result = validateGuard(override);
  if (!result.ok) return packaged;
  return { ...packaged, ...result.data.presets };
}

/** 已解析的守護 preset 表 cache（遊戲啟動讀一次；重開換）。 */
let resolvedGuardCache: Record<string, GuardPreset> | null = null;

/** 遊戲端取得守護 preset 表（override 優先 + cache）。getGuardPreset 用。 */
export function getResolvedGuardPresets(): Record<string, GuardPreset> {
  if (resolvedGuardCache) return resolvedGuardCache;
  const override = loadOverride(EDITOR_STORE_KEYS.guard);
  if (override !== null) {
    const result = validateGuard(override);
    if (!result.ok) console.warn('[guardSchema] guard override 驗證失敗，改用打包預設：', result.errors);
  }
  resolvedGuardCache = resolveGuard(override);
  return resolvedGuardCache;
}

/** 清空 cache（測試/熱重載用）。 */
export function clearResolvedGuardCache(): void {
  resolvedGuardCache = null;
}

/**
 * override-aware 守護 preset 查詢（消費端用，取代 guardConfig.getGuardPreset）：
 * 先查 resolved 表（override 優先），查無回打包 fallback（Guard60 或 GUARD_PRESETS 第一個），不炸。
 */
export function getResolvedGuardPreset(name: string | undefined): GuardPreset {
  const table = getResolvedGuardPresets();
  if (name && table[name]) return table[name];
  return table.Guard60 || GUARD_PRESETS.Guard60;
}
