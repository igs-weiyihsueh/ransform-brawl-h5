/**
 * attackSpeedSchema.ts — 攻擊速度倍率設定 + resolveAttackSpeed 純函式（用戶第十一輪 #1）。
 *   一個 attackSpeedMult（預設 1.0）統一調整體攻擊節奏（不脫節）：
 *     - 攻擊動畫加速：animTimeScale = mult（CharacterAnimator attack anim timeScale）
 *     - 冷卻縮短：cooldown = 基準 / mult（PLAYER_CONFIG.attackCooldown 0.333）
 *     - 前搖縮短：hitDelay = 基準 / mult（PLAYER_BASIC_ATTACK.hitDelay 0.1）
 *
 * 對齊 chestSchema/guardSchema 模式：零 Phaser，只 import combatConfig 基準值。編輯器 + 遊戲讀取端共用單一真相。
 *
 * ★mult 語意：倍率 **> 0**（跟 scale 同，非 chest/dash 的「0 合法」）——0/負不合法用 min 擋。
 *   用 ?? 只為防 undefined（省略 → 1.0），不是為了保留 0。
 */
import { PLAYER_CONFIG, PLAYER_BASIC_ATTACK } from '@/config/combatConfig';
import { HUMAN_KEY, SUNWUKONG_KEY } from '@/config/transformConfig';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/**
 * 匯出檔頂層（用戶第十一輪：per-character 攻速）。
 *   byChar：各可變身角色的攻速倍率 { charKey: mult }。缺角色 → 1.0。
 *   ⚠️向後相容：舊格式單一 `{ mult }`（全域）仍讀得動——當「所有角色共用該 mult」（見 resolveAttackSpeedFor）。
 */
export interface AttackSpeedFile {
  version: number;
  /** 各可變身角色攻速倍率（key=角色 charKey，值 > 0）。缺角色=1.0。 */
  byChar?: Record<string, number>;
  /** @deprecated 舊全域單一倍率（向後相容：當所有角色共用）。新資料用 byChar。 */
  mult?: number;
}

export const ATTACK_SPEED_SCHEMA_VERSION = 1 as const;
/** 預設倍率（1.0 = 不加速，等同原本節奏）。 */
export const ATTACK_SPEED_DEFAULT_MULT = 1.0;

/** 可變身角色 keys（攻速 per-char 對象）。對照 transformConfig HUMAN_KEY/SUNWUKONG_KEY（未來擴充在此加）。 */
export const ATTACK_SPEED_CHAR_KEYS: readonly string[] = [HUMAN_KEY, SUNWUKONG_KEY];

/** 基準攻擊節奏（來自 combatConfig 打包值）。 */
export const ATTACK_SPEED_BASE = {
  cooldown: PLAYER_CONFIG.attackCooldown, // 0.333
  hitDelay: PLAYER_BASIC_ATTACK.hitDelay, // 0.1
} as const;

/** resolveAttackSpeed 回傳：遊戲端接線用。 */
export interface ResolvedAttackSpeed {
  /** 倍率（> 0）。 */
  mult: number;
  /** 縮短後的冷卻（秒）= 基準 / mult。 */
  cooldown: number;
  /** 縮短後的前搖（秒）= 基準 / mult。 */
  hitDelay: number;
  /** 攻擊動畫播放倍率 = mult（CharacterAnimator attack anim timeScale）。 */
  animTimeScale: number;
}

export function defaultAttackSpeedFile(): AttackSpeedFile {
  const byChar: Record<string, number> = {};
  for (const k of ATTACK_SPEED_CHAR_KEYS) byChar[k] = ATTACK_SPEED_DEFAULT_MULT;
  return { version: ATTACK_SPEED_SCHEMA_VERSION, byChar };
}

// ---- 驗證（大聲失敗、精準定位；零遊戲依賴）------------------------------

export type ValidateAttackSpeedResult =
  | { ok: true; data: AttackSpeedFile }
  | { ok: false; errors: string[] };

export class AttackSpeedValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`攻擊速度設定驗證失敗（${errors.length} 項）：\n${errors.map((m) => `  - ${m}`).join('\n')}`);
    this.name = 'AttackSpeedValidationError';
    this.errors = errors;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

/** 驗證任意 JSON 是否為合法 AttackSpeedFile。byChar 各值 / 舊 mult 若提供皆須 > 0（★倍率 0/負不合法）。 */
export function validateAttackSpeed(json: unknown): ValidateAttackSpeedResult {
  const errors: string[] = [];
  const root = asObject(json);
  if (!root) return { ok: false, errors: ['根層級必須是物件 { version, byChar? }。'] };
  if (!isFiniteNumber(root.version)) {
    errors.push('頂層「版本 version」缺少或非數字（預期 1）。');
  } else if (root.version !== ATTACK_SPEED_SCHEMA_VERSION) {
    errors.push(`頂層「版本 version」=${String(root.version)} 不支援（此版本只接受 ${ATTACK_SPEED_SCHEMA_VERSION}）。`);
  }
  // byChar（optional）：若提供必須是物件，各值數字且 > 0。
  if (root.byChar !== undefined) {
    const bc = asObject(root.byChar);
    if (!bc) {
      errors.push('「各角色攻速 byChar」若提供必須是物件（{ 角色key: 倍率 }）。');
    } else {
      for (const [k, v] of Object.entries(bc)) {
        if (!isFiniteNumber(v)) {
          errors.push(`byChar「${k}」的倍率必須是數字。`);
        } else if (v <= 0) {
          errors.push(`byChar「${k}」=${v} 必須 > 0（倍率，0/負不合法）。`);
        }
      }
    }
  }
  // 舊全域 mult（optional，向後相容）：若提供須數字 > 0。
  if (root.mult !== undefined) {
    if (!isFiniteNumber(root.mult)) {
      errors.push('「攻擊速度倍率 mult」若提供必須是數字。');
    } else if (root.mult <= 0) {
      errors.push(`「攻擊速度倍率 mult」=${root.mult} 必須 > 0（倍率，0/負不合法）。`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: root as unknown as AttackSpeedFile };
}

export function assertValidAttackSpeed(raw: unknown): AttackSpeedFile {
  const result = validateAttackSpeed(raw);
  if (!result.ok) throw new AttackSpeedValidationError(result.errors);
  return result.data;
}

/**
 * 解析遊戲要用的攻擊速度（純函式，抽給測騎；同 resolveChest/resolveGuard 模式）。
 * - override 通過 validateAttackSpeed → mult = data.mult ?? 1.0（★?? 只防 undefined，mult 本身須 > 0 已由 validate 保證）。
 * - override 為 null / 壞 / validate 失敗 → mult = 1.0（行為 100% 不變：等同原本節奏）。
 * 回傳 { mult, cooldown: 基準/mult, hitDelay: 基準/mult, animTimeScale: mult }。
 *
 * @param override loadOverride(EDITOR_STORE_KEYS.attackSpeed) 原始物件（未驗證）；null=無 override。
 * @param baseCooldown 基準冷卻（預設 PLAYER_CONFIG.attackCooldown）。
 * @param baseHitDelay 基準前搖（預設 PLAYER_BASIC_ATTACK.hitDelay）。
 */
/**
 * 【向後相容保留】解析「全域」攻擊速度（舊簽章，測騎既有測試沿用）。
 * 讀 override.mult ?? 1.0（舊全域格式）；byChar 不在此解析。null/壞 → 1.0。
 * 新程式請用 resolveAttackSpeedFor(charKey, ...)。
 */
export function resolveAttackSpeed(
  override: unknown,
  baseCooldown: number = ATTACK_SPEED_BASE.cooldown,
  baseHitDelay: number = ATTACK_SPEED_BASE.hitDelay,
): ResolvedAttackSpeed {
  let mult = ATTACK_SPEED_DEFAULT_MULT;
  if (override !== null && override !== undefined) {
    const result = validateAttackSpeed(override);
    if (result.ok) mult = result.data.mult ?? ATTACK_SPEED_DEFAULT_MULT;
  }
  return { mult, cooldown: baseCooldown / mult, hitDelay: baseHitDelay / mult, animTimeScale: mult };
}

/**
 * 解析「某角色」的攻擊速度（per-character，用戶第十一輪；純函式，抽給測騎）。
 * 取值優先序（★?? 只防 undefined，各 mult 本身 >0 已由 validate 保證）：
 *   1. override.byChar[charKey]（該角色專屬）
 *   2. override.mult（★舊全域格式相容：舊存檔的單一 mult 當所有角色共用）
 *   3. 1.0（缺省=原本節奏）
 * override 為 null / 壞 / validate 失敗 → 1.0（行為不變、舊存檔不炸）。
 *
 * @param charKey 玩家當前變身角色 key（如 'Human' / 'SunWukong'）。
 * @param override loadOverride(EDITOR_STORE_KEYS.attackSpeed) 原始物件（未驗證）；null=無。
 */
export function resolveAttackSpeedFor(
  charKey: string,
  override: unknown,
  baseCooldown: number = ATTACK_SPEED_BASE.cooldown,
  baseHitDelay: number = ATTACK_SPEED_BASE.hitDelay,
): ResolvedAttackSpeed {
  let mult = ATTACK_SPEED_DEFAULT_MULT;
  if (override !== null && override !== undefined) {
    const result = validateAttackSpeed(override);
    if (result.ok) {
      const perChar = result.data.byChar?.[charKey];
      // byChar 該角色 → 用它；否則舊全域 mult（相容）；再否則 1.0。
      mult = perChar ?? result.data.mult ?? ATTACK_SPEED_DEFAULT_MULT;
    }
  }
  return { mult, cooldown: baseCooldown / mult, hitDelay: baseHitDelay / mult, animTimeScale: mult };
}

/** 已解析攻擊速度 cache（per charKey；遊戲啟動讀一次；重開換）。 */
const resolvedCacheByChar = new Map<string, ResolvedAttackSpeed>();
let overrideCache: unknown | undefined; // 讀一次 localStorage，per-char 解析共用

/** 【向後相容】全域攻擊速度 getter（舊呼叫點）。 */
export function getResolvedAttackSpeed(): ResolvedAttackSpeed {
  return resolveAttackSpeed(getAttackSpeedOverrideOnce());
}

/** 遊戲端取得「某角色」已解析攻擊速度（override 優先 + per-char cache）。玩家變身切角色時用當前 charKey 呼叫。 */
export function getResolvedAttackSpeedFor(charKey: string): ResolvedAttackSpeed {
  const cached = resolvedCacheByChar.get(charKey);
  if (cached) return cached;
  const override = getAttackSpeedOverrideOnce();
  const resolved = resolveAttackSpeedFor(charKey, override);
  resolvedCacheByChar.set(charKey, resolved);
  return resolved;
}

/** 讀一次 localStorage override（驗證失敗警告一次），per-char 解析共用。 */
function getAttackSpeedOverrideOnce(): unknown {
  if (overrideCache !== undefined) return overrideCache;
  const override = loadOverride(EDITOR_STORE_KEYS.attackSpeed);
  if (override !== null) {
    const result = validateAttackSpeed(override);
    if (!result.ok) console.warn('[attackSpeedSchema] attackSpeed override 驗證失敗，改用預設 1.0：', result.errors);
  }
  overrideCache = override;
  return override;
}
