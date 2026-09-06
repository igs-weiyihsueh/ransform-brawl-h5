/**
 * skill-editor/skillSchema.ts — 招式編輯器的資料格式 + 驗證（純前端、零 Phaser）。
 *
 * 型別/值以遊戲 src/config/skillConfig.ts 為單一來源（只讀 import 型別 + CHARACTER_COMBAT 值當初值）。
 * 匯出結構自洽 { version, characters: Record<charKey, CharacterCombatProfile> }。
 *
 * 依賴：import type AttackData / import CHARACTER_COMBAT（skillConfig 只 type-import AttackData，
 * 無 Phaser）→ bundle phaser=0。
 */
import {
  CHARACTER_COMBAT,
  type CharacterCombatProfile,
  type CharacterSkillSet,
  type EnergyMode,
} from '@/config/skillConfig';
import type { AttackData } from '@/systems/AttackData';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

export type { AttackData, CharacterCombatProfile, CharacterSkillSet, EnergyMode };

/** 四招的 key 順序（清單/tab 用）。 */
export const SKILL_KEYS: readonly (keyof CharacterSkillSet)[] = [
  'normalAttack',
  'skill1',
  'skill2',
  'ultimate',
] as const;

/** 招式中文名。 */
export const SKILL_LABELS: Record<string, string> = {
  normalAttack: '普攻',
  skill1: '技能1',
  skill2: '技能2',
  ultimate: '大招',
};

export const ENERGY_MODES: readonly EnergyMode[] = ['HumanSimple', 'Full'] as const;
export const SHAPE_TYPES = ['circle', 'rectangle', 'fan'] as const;
export type ShapeType = (typeof SHAPE_TYPES)[number];

export const SKILL_SCHEMA_VERSION = 1 as const;

/** 匯出檔頂層。 */
export interface SkillFile {
  version: number;
  characters: Record<string, CharacterCombatProfile>;
}

export function defaultCharacters(): Record<string, CharacterCombatProfile> {
  return JSON.parse(JSON.stringify(CHARACTER_COMBAT)) as Record<string, CharacterCombatProfile>;
}
export function defaultSkillFile(): SkillFile {
  return { version: SKILL_SCHEMA_VERSION, characters: defaultCharacters() };
}

// ---- 驗證（大聲失敗、精準定位）-------------------------------------------

export type ValidateSkillResult =
  | { ok: true; data: SkillFile }
  | { ok: false; errors: string[] };

export class SkillValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`招式設定驗證失敗（${errors.length} 項）：\n${errors.map((m) => `  - ${m}`).join('\n')}`);
    this.name = 'SkillValidationError';
    this.errors = errors;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}
function checkNum(
  obj: Record<string, unknown>, key: string, label: string, errors: string[],
  opts: { min?: number } = {},
): void {
  const v = obj[key];
  if (!isFiniteNumber(v)) errors.push(`${label}「${key}」缺少或非數字。`);
  else if (opts.min !== undefined && v < opts.min) errors.push(`${label}「${key}」=${v} 不可小於 ${opts.min}。`);
}

function validateAttack(raw: unknown, label: string, errors: string[]): void {
  const a = asObject(raw);
  if (!a) { errors.push(`${label} 缺少或不是物件。`); return; }
  const shape = a.shapeType;
  if (!isNonEmptyString(shape) || !SHAPE_TYPES.includes(shape as ShapeType)) {
    errors.push(`${label} 的 shapeType="${String(shape)}" 不合法（預期 ${SHAPE_TYPES.join(' / ')}）。`);
  } else if (shape === 'circle') {
    checkNum(a, 'radius', label, errors, { min: 0 });
  } else if (shape === 'fan') {
    checkNum(a, 'radius', label, errors, { min: 0 });
    checkNum(a, 'angle', label, errors, { min: 0 });
    if (isFiniteNumber(a.angle) && a.angle > 360) errors.push(`${label} 的 angle=${a.angle} 不可大於 360。`);
  } else {
    checkNum(a, 'length', label, errors, { min: 0 });
    checkNum(a, 'width', label, errors, { min: 0 });
  }
  checkNum(a, 'offsetX', label, errors);
  checkNum(a, 'offsetY', label, errors);
  checkNum(a, 'damage', label, errors, { min: 0 });
  checkNum(a, 'hitDelay', label, errors, { min: 0 });
  checkNum(a, 'knockback', label, errors, { min: 0 });
  if (a.vfxKey !== undefined && !isNonEmptyString(a.vfxKey)) {
    errors.push(`${label} 的 vfxKey 若提供必須是非空字串。`);
  }
}

function validateProfile(raw: unknown, key: string, errors: string[]): void {
  const p = asObject(raw);
  const label = `角色「${key}」`;
  if (!p) { errors.push(`${label} 必須是物件。`); return; }

  if (!isNonEmptyString(p.mode) || !ENERGY_MODES.includes(p.mode as EnergyMode)) {
    errors.push(`${label} 的「mode」="${String(p.mode)}" 不合法（預期 ${ENERGY_MODES.join(' / ')}）。`);
  }
  checkNum(p, 'energyCap', label, errors, { min: 1 });
  checkNum(p, 'damageMultiplier', label, errors, { min: 0 });

  const skills = asObject(p.skills);
  if (!skills) { errors.push(`${label} 的「skills」缺少或不是物件。`); return; }
  for (const sk of SKILL_KEYS) {
    if (skills[sk] === undefined) {
      errors.push(`${label} 的 skills 缺少「${sk}（${SKILL_LABELS[sk]}）」。`);
    } else {
      validateAttack(skills[sk], `${label} 的 ${SKILL_LABELS[sk]}（${sk}）`, errors);
    }
  }
}

export function validateSkills(json: unknown): ValidateSkillResult {
  const errors: string[] = [];
  const root = asObject(json);
  if (!root) return { ok: false, errors: ['根層級必須是物件 { version, characters }。'] };

  if (!isFiniteNumber(root.version)) {
    errors.push('頂層「版本 version」缺少或非數字（預期 1）。');
  } else if (root.version !== SKILL_SCHEMA_VERSION) {
    errors.push(`頂層「版本 version」=${String(root.version)} 不支援（此版本只接受 ${SKILL_SCHEMA_VERSION}）。`);
  }

  const chars = asObject(root.characters);
  if (!chars) { errors.push('頂層「characters」缺少或不是物件。'); return { ok: false, errors }; }
  const keys = Object.keys(chars);
  if (keys.length === 0) errors.push('「characters」為空，至少要有一個角色。');
  for (const key of keys) validateProfile(chars[key], key, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: root as unknown as SkillFile };
}

export function assertValidSkills(raw: unknown): SkillFile {
  const result = validateSkills(raw);
  if (!result.ok) throw new SkillValidationError(result.errors);
  return result.data;
}

// ---- 遊戲讀取端：匯入 override 優先（skills JSON 化，接通招式編輯→遊戲生效）--------------

/**
 * 解析遊戲要用的角色戰鬥表（純函式，抽給測騎；同 resolveEnemies 模式）：
 * - override 通過 validateSkills → 用 override.characters（用戶在 skill-editor 套用的）。
 * - override 為 null / 壞 / validate 失敗 → 回打包預設 CHARACTER_COMBAT（行為 100% 不變）。
 * @param override loadOverride(EDITOR_STORE_KEYS.skills) 的原始物件（未驗證）；null=無 override。
 * @param packaged 打包預設角色戰鬥表（預設 CHARACTER_COMBAT）。
 */
export function resolveSkills(
  override: unknown,
  packaged: Record<string, CharacterCombatProfile> = CHARACTER_COMBAT,
): Record<string, CharacterCombatProfile> {
  if (override === null || override === undefined) return packaged;
  const result = validateSkills(override);
  return result.ok ? result.data.characters : packaged;
}

/** 已解析的角色戰鬥表 cache（遊戲啟動讀一次；重開換，符合「套用→重開生效」）。 */
let resolvedSkillsCache: Record<string, CharacterCombatProfile> | null = null;

/** 遊戲端取得角色戰鬥表（override 優先 + cache）。getCombatProfile 用。 */
export function getResolvedSkills(): Record<string, CharacterCombatProfile> {
  if (resolvedSkillsCache) return resolvedSkillsCache;
  const override = loadOverride(EDITOR_STORE_KEYS.skills);
  if (override !== null) {
    const result = validateSkills(override);
    if (!result.ok) console.warn('[skillSchema] skills override 驗證失敗，改用打包預設：', result.errors);
  }
  resolvedSkillsCache = resolveSkills(override);
  return resolvedSkillsCache;
}

/** 清空 cache（測試/熱重載用）。 */
export function clearResolvedSkillsCache(): void {
  resolvedSkillsCache = null;
}
