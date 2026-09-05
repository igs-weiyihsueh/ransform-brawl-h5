/**
 * enemy-editor/enemySchema.ts — 怪物編輯器的資料格式 + 驗證（純前端、零 Phaser）。
 *
 * 型別以遊戲的 src/config/enemyConfig.ts 為單一來源（只讀 import 型別 + ENEMY_AI 當初值），
 * 本檔不改遊戲檔。匯出結構自洽（{ version, enemies: Record<key, EnemyAIConfig> }），
 * 讓統籌能貼回 enemyConfig.ts 或遊戲讀。
 *
 * 依賴：import type / import ENEMY_AI（enemyConfig 只 type-import AttackData，無 Phaser）→ bundle phaser=0。
 */
import { ENEMY_AI, type EnemyAIConfig, type EnemyAttackKind } from '@/config/enemyConfig';
import type { AttackData } from '@/systems/AttackData';

export type { EnemyAIConfig, EnemyAttackKind, AttackData };

/** 匯出檔頂層。 */
export interface EnemyFile {
  version: number;
  enemies: Record<string, EnemyAIConfig>;
}

export const ENEMY_SCHEMA_VERSION = 1 as const;

/** 合法攻擊方式。 */
export const ATTACK_KINDS: readonly EnemyAttackKind[] = ['melee', 'projectile'] as const;
/** 合法判定形狀。 */
export const SHAPE_TYPES = ['circle', 'rectangle'] as const;

/** 從遊戲權威 ENEMY_AI 深拷貝一份當初值。 */
export function defaultEnemies(): Record<string, EnemyAIConfig> {
  return JSON.parse(JSON.stringify(ENEMY_AI)) as Record<string, EnemyAIConfig>;
}

/** 預設匯出檔（含所有敵人）。 */
export function defaultEnemyFile(): EnemyFile {
  return { version: ENEMY_SCHEMA_VERSION, enemies: defaultEnemies() };
}

// ---- 驗證（大聲失敗、精準定位）-------------------------------------------

export type ValidateEnemyResult =
  | { ok: true; data: EnemyFile }
  | { ok: false; errors: string[] };

export class EnemyValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`敵人設定驗證失敗（${errors.length} 項）：\n${errors.map((m) => `  - ${m}`).join('\n')}`);
    this.name = 'EnemyValidationError';
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
  obj: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
  opts: { min?: number } = {},
): void {
  const v = obj[key];
  if (!isFiniteNumber(v)) {
    errors.push(`${label}「${key}」缺少或非數字。`);
  } else if (opts.min !== undefined && v < opts.min) {
    errors.push(`${label}「${key}」=${v} 不可小於 ${opts.min}。`);
  }
}

function validateAttack(raw: unknown, label: string, errors: string[]): void {
  const a = asObject(raw);
  if (!a) {
    errors.push(`${label} 的「attack」缺少或不是物件。`);
    return;
  }
  const shape = a.shapeType;
  if (!isNonEmptyString(shape) || !SHAPE_TYPES.includes(shape as (typeof SHAPE_TYPES)[number])) {
    errors.push(`${label} 的 attack.shapeType="${String(shape)}" 不合法（預期 ${SHAPE_TYPES.join(' / ')}）。`);
  } else if (shape === 'circle') {
    checkNum(a, 'radius', `${label} 的 attack`, errors, { min: 0 });
  } else {
    checkNum(a, 'length', `${label} 的 attack`, errors, { min: 0 });
    checkNum(a, 'width', `${label} 的 attack`, errors, { min: 0 });
  }
  checkNum(a, 'offsetX', `${label} 的 attack`, errors);
  checkNum(a, 'offsetY', `${label} 的 attack`, errors);
  checkNum(a, 'damage', `${label} 的 attack`, errors, { min: 0 });
  checkNum(a, 'hitDelay', `${label} 的 attack`, errors, { min: 0 });
  checkNum(a, 'knockback', `${label} 的 attack`, errors, { min: 0 });
}

function validateEnemy(raw: unknown, key: string, errors: string[]): void {
  const e = asObject(raw);
  const label = `敵人「${key}」`;
  if (!e) {
    errors.push(`${label} 必須是物件。`);
    return;
  }
  if (!isNonEmptyString(e.characterKey)) errors.push(`${label} 的「characterKey」缺少或非非空字串。`);
  checkNum(e, 'hp', label, errors, { min: 1 });
  checkNum(e, 'moveSpeed', label, errors, { min: 0 });
  checkNum(e, 'detectRange', label, errors, { min: 0 });
  checkNum(e, 'attackRange', label, errors, { min: 0 });
  checkNum(e, 'chargeTime', label, errors, { min: 0 });
  checkNum(e, 'attackCooldown', label, errors, { min: 0 });
  checkNum(e, 'hitStun', label, errors, { min: 0 });
  checkNum(e, 'knockbackForce', label, errors, { min: 0 });

  const kind = e.attackKind;
  if (!isNonEmptyString(kind) || !ATTACK_KINDS.includes(kind as EnemyAttackKind)) {
    errors.push(`${label} 的「attackKind」="${String(kind)}" 不合法（預期 ${ATTACK_KINDS.join(' / ')}）。`);
  }
  if (kind === 'projectile') {
    checkNum(e, 'projectileSpeed', label, errors, { min: 0 });
  }
  validateAttack(e.attack, label, errors);

  // 合理性：attackRange 不應大於 detectRange（否則永遠追不到就想打）。
  if (isFiniteNumber(e.attackRange) && isFiniteNumber(e.detectRange) && e.attackRange > e.detectRange) {
    errors.push(`${label} 的 attackRange(${e.attackRange}) 不應大於 detectRange(${e.detectRange})。`);
  }
}

export function validateEnemies(json: unknown): ValidateEnemyResult {
  const errors: string[] = [];
  const root = asObject(json);
  if (!root) return { ok: false, errors: ['根層級必須是物件 { version, enemies }。'] };

  if (!isFiniteNumber(root.version)) {
    errors.push('頂層「版本 version」缺少或非數字（預期 1）。');
  } else if (root.version !== ENEMY_SCHEMA_VERSION) {
    errors.push(`頂層「版本 version」=${String(root.version)} 不支援（此版本只接受 ${ENEMY_SCHEMA_VERSION}）。`);
  }

  const enemies = asObject(root.enemies);
  if (!enemies) {
    errors.push('頂層「enemies」缺少或不是物件（預期 Record<key, 敵人設定>）。');
    return { ok: false, errors };
  }
  const keys = Object.keys(enemies);
  if (keys.length === 0) errors.push('「enemies」為空，至少要有一隻敵人。');
  for (const key of keys) {
    if (!isNonEmptyString(key)) errors.push('敵人 key 不可為空字串。');
    validateEnemy(enemies[key], key, errors);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: root as unknown as EnemyFile };
}

export function assertValidEnemies(raw: unknown): EnemyFile {
  const result = validateEnemies(raw);
  if (!result.ok) throw new EnemyValidationError(result.errors);
  return result.data;
}
