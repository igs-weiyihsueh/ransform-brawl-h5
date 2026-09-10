/**
 * towerSchema.ts — 魔尖塔 preset 表格式 + 驗證（魔尖塔單獨編輯，遊戲讀取端 + event-editor 共用單一真相）。
 *
 * 對齊 fireRainSchema/guardSchema 模式：零 Phaser，只 import towerConfig 型別/值當打包預設。
 * 匯出結構 { version, presets: Record<name, TowerPreset> }。TOWER_PRESETS(towerConfig)當打包預設，
 * override(localStorage EDITOR_STORE_KEYS.tower)優先（override 同名覆蓋、可新增；未覆蓋沿用打包）。
 */
import {
  TOWER_PRESETS,
  type TowerPreset,
} from '@/config/towerConfig';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/** 匯出檔頂層（多 preset）。 */
export interface TowerFile {
  version: number;
  presets: Record<string, TowerPreset>;
}

export const TOWER_SCHEMA_VERSION = 1 as const;

/** 從打包預設深拷貝一份 preset 表當初值（editor 初值 / resolve fallback）。 */
export function defaultTowerPresets(): Record<string, TowerPreset> {
  const out: Record<string, TowerPreset> = {};
  for (const [name, p] of Object.entries(TOWER_PRESETS)) {
    out[name] = {
      ...p,
      ringSkill: { ...p.ringSkill },
      ...(p.positions ? { positions: p.positions.map((q) => ({ ...q })) } : {}),
    };
  }
  return out;
}
export function defaultTowerFile(): TowerFile {
  return { version: TOWER_SCHEMA_VERSION, presets: defaultTowerPresets() };
}

// ---- 驗證（大聲失敗、精準定位；零遊戲依賴，只驗型別/範圍）---------------

export type ValidateTowerResult =
  | { ok: true; data: TowerFile }
  | { ok: false; errors: string[] };

export class TowerValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`魔尖塔參數驗證失敗（${errors.length} 項）：\n${errors.map((m) => `  - ${m}`).join('\n')}`);
    this.name = 'TowerValidationError';
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
  obj: Record<string, unknown>, key: string, label: string, errors: string[], opts: { min?: number; gt?: number } = {},
): void {
  if (obj[key] === undefined) return;
  const v = obj[key];
  if (!isFiniteNumber(v)) { errors.push(`${label}「${key}」若提供必須是數字。`); return; }
  if (opts.min !== undefined && v < opts.min) errors.push(`${label}「${key}」=${v} 不可小於 ${opts.min}。`);
  if (opts.gt !== undefined && v <= opts.gt) errors.push(`${label}「${key}」=${v} 必須大於 ${opts.gt}。`);
}

export function validateTower(json: unknown): ValidateTowerResult {
  const errors: string[] = [];
  const root = asObject(json);
  if (!root) return { ok: false, errors: ['根層級必須是物件 { version, presets }。'] };

  if (!isFiniteNumber(root.version)) {
    errors.push('頂層「版本 version」缺少或非數字（預期 1）。');
  } else if (root.version !== TOWER_SCHEMA_VERSION) {
    errors.push(`頂層「版本 version」=${String(root.version)} 不支援（此版本只接受 ${TOWER_SCHEMA_VERSION}）。`);
  }

  const presets = asObject(root.presets);
  if (!presets) {
    errors.push('頂層「presets」缺少或不是物件。');
    return { ok: false, errors };
  }
  const names = Object.keys(presets);
  if (names.length === 0) errors.push('「presets」至少需一組魔尖塔參數。');

  for (const name of names) {
    const p = asObject(presets[name]);
    const label = `魔尖塔「${name}」`;
    if (!p) {
      errors.push(`${label} 不是物件。`);
      continue;
    }
    checkNum(p, 'towerCount', label, errors, { min: 1, int: true });
    checkNum(p, 'timeLimitSec', label, errors, { min: 1 });
    checkNum(p, 'towerHp', label, errors, { min: 1 });
    checkNumOptional(p, 'towerScale', label, errors, { gt: 0 }); // A3：塔縮放，若提供須 >0
    checkNumOptional(p, 'towerCollisionRadiusPx', label, errors, { min: 0 }); // ★真空帶＝塔 body 碰撞半徑（選填 >=0）
    // A2：塔位置（選填陣列 of {x,y}）；長度可 != towerCount（game-side 補預設）。
    if (p.positions !== undefined) {
      if (!Array.isArray(p.positions)) {
        errors.push(`${label} 的「塔位置 positions」若提供必須是陣列。`);
      } else {
        p.positions.forEach((pos, i) => {
          const po = asObject(pos);
          if (!po) { errors.push(`${label} positions[${i}] 不是物件。`); return; }
          checkNum(po, 'x', `${label} positions[${i}]`, errors);
          checkNum(po, 'y', `${label} positions[${i}]`, errors);
        });
      }
    }
    // 登場訊息（選填，比照 guardSchema）：文字若提供須字串（''合法）、秒數若提供須 >=0（0 合法）。
    if (p.introEventText !== undefined && typeof p.introEventText !== 'string') {
      errors.push(`${label}「introEventText」若提供必須是字串。`);
    }
    if (p.towerMessageText !== undefined && typeof p.towerMessageText !== 'string') {
      errors.push(`${label}「towerMessageText」若提供必須是字串。`);
    }
    checkNumOptional(p, 'eventTextDurationSec', label, errors, { min: 0 });
    // D：塔血條 UI（選填，比照 guardSchema statue UI；offsetY 可負→不設 min）。
    checkNumOptional(p, 'barWidthPx', label, errors, { min: 0 });
    checkNumOptional(p, 'barHeightPx', label, errors, { min: 0 });
    checkNumOptional(p, 'barOffsetYPx', label, errors);
    checkNumOptional(p, 'labelOffsetYPx', label, errors);
    // E：過關獎勵券（選填，>=0，0 合法）。
    checkNumOptional(p, 'rewardTickets', label, errors, { min: 0 });
    // B：開場演出（選填，比照守護波 introFocusSec/spotlightRadiusPx/maxWalkSec；gatherPointPx 物件 {x,y}）。
    checkNumOptional(p, 'introFocusSec', label, errors, { min: 0 });
    checkNumOptional(p, 'spotlightRadiusPx', label, errors, { min: 0 });
    checkNumOptional(p, 'maxWalkSec', label, errors, { min: 0 });
    if (p.gatherPointPx !== undefined) {
      const gp = asObject(p.gatherPointPx);
      if (!gp) errors.push(`${label} 的「gatherPointPx」若提供必須是物件 {x,y}。`);
      else {
        checkNum(gp, 'x', `${label} gatherPointPx`, errors);
        checkNum(gp, 'y', `${label} gatherPointPx`, errors);
      }
    }
    const ring = asObject(p.ringSkill);
    if (!ring) {
      errors.push(`${label} 的「環狀技 ringSkill」缺少或不是物件。`);
    } else {
      const rl = `${label} ringSkill`;
      checkNum(ring, 'ringCount', rl, errors, { min: 1, int: true });
      checkNum(ring, 'baseRadiusPx', rl, errors, { min: 0 });
      checkNum(ring, 'radiusStepPx', rl, errors, { min: 0 });
      checkNum(ring, 'ringIntervalSec', rl, errors, { min: 0 });
      checkNum(ring, 'ringThicknessPx', rl, errors, { min: 0 });
      checkNum(ring, 'energyCost', rl, errors, { min: 0 });
      checkNum(ring, 'warningSec', rl, errors, { min: 0 }); // C9：環預警秒數
      checkNumOptional(ring, 'vacuumRadiusPx', rl, errors, { min: 0 }); // ②真空帶半徑（選填）
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: root as unknown as TowerFile };
}

export function assertValidTower(raw: unknown): TowerFile {
  const result = validateTower(raw);
  if (!result.ok) throw new TowerValidationError(result.errors);
  return result.data;
}

// ---- 遊戲讀取端：匯入 override 優先（魔尖塔單獨編輯→套用生效）----------------

/**
 * 解析遊戲要用的魔尖塔 preset 表（純函式，抽給測騎；同 resolveFireRain 模式）：
 * - override 通過 validateTower → 打包預設 merge override.presets（override 同名覆蓋、可新增、未覆蓋沿用）。
 * - override 為 null / 壞 / validate 失敗 → 回打包預設（行為 100% 不變）。
 */
export function resolveTower(
  override: unknown,
  packaged: Record<string, TowerPreset> = TOWER_PRESETS,
): Record<string, TowerPreset> {
  if (override === null || override === undefined) return packaged;
  const result = validateTower(override);
  if (!result.ok) return packaged;
  return { ...packaged, ...result.data.presets };
}

/** 已解析的魔尖塔 preset 表 cache（遊戲啟動讀一次；重開換）。 */
let resolvedTowerCache: Record<string, TowerPreset> | null = null;

/** 遊戲端取得魔尖塔 preset 表（override 優先 + cache）。 */
export function getResolvedTowerPresets(): Record<string, TowerPreset> {
  if (resolvedTowerCache) return resolvedTowerCache;
  const override = loadOverride(EDITOR_STORE_KEYS.tower);
  if (override !== null) {
    const result = validateTower(override);
    if (!result.ok) console.warn('[towerSchema] tower override 驗證失敗，改用打包預設：', result.errors);
  }
  resolvedTowerCache = resolveTower(override);
  return resolvedTowerCache;
}

/** 清空 cache（測試/熱重載用）。 */
export function clearResolvedTowerCache(): void {
  resolvedTowerCache = null;
}

/**
 * override-aware 魔尖塔 preset 查詢（消費端用，取代 towerConfig.getTowerPreset）：
 * 先查 resolved 表（override 優先），查無回打包 fallback（TOWER_PRESETS.Tower4），不炸。
 */
export function getResolvedTowerPreset(name: string | undefined): TowerPreset {
  const table = getResolvedTowerPresets();
  return (name && table[name]) || table.Tower4 || TOWER_PRESETS.Tower4;
}

/** override-aware：name 是否為（含 override 的）魔尖塔 preset。 */
export function isResolvedTowerPreset(name: string | undefined): boolean {
  return !!name && name in getResolvedTowerPresets();
}
