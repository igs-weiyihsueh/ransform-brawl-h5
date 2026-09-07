/**
 * hitFeelSchema.ts — 打擊手感參數格式 + 驗證 + override 解析（hitFeel 可調，遊戲讀取端 + hitfeel-editor 共用單一真相）。
 *
 * 對齊 dashSchema/guardSchema 模式：零 Phaser，只 import HIT_FEEL 型別/值當打包預設。
 * 匯出結構 { version, hitFeel: HitFeelConfig }。HIT_FEEL(hitFeelConfig)當打包預設，override(localStorage)優先。
 *
 * ★0-nullish 語意（異靈定，第十一輪）：時長/scale/距離/顏色欄位 0 皆「合法值」
 *   （microFreezeDuration=0/playerHitlagDuration=0 = 不做頓幀/hitlag，是合法設定；hitFlashColor=0x000000 黑也合法）。
 *   → resolveHitFeel 逐欄用 `??`（非 ||，|| 會把 0/false 當 falsy 誤退回預設）。這是 chest/dash 的 0-合法語意，
 *   非 scale 那種「0 不合法」——別套錯。
 */
import { HIT_FEEL, type HitFeelConfig } from '@/config/hitFeelConfig';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/** 匯出檔頂層。 */
export interface HitFeelFile {
  version: number;
  hitFeel: HitFeelConfig;
}

export const HIT_FEEL_SCHEMA_VERSION = 1 as const;

/** 從打包預設 HIT_FEEL 深拷貝一份當初值（editor 初值 / resolve fallback）。 */
export function defaultHitFeel(): HitFeelConfig {
  return { ...HIT_FEEL };
}
export function defaultHitFeelFile(): HitFeelFile {
  return { version: HIT_FEEL_SCHEMA_VERSION, hitFeel: defaultHitFeel() };
}

// ---- 驗證（大聲失敗、精準定位；零遊戲依賴，只驗型別/範圍）---------------

export type ValidateHitFeelResult =
  | { ok: true; data: HitFeelFile }
  | { ok: false; errors: string[] };

export class HitFeelValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`打擊感參數驗證失敗（${errors.length} 項）：\n${errors.map((m) => `  - ${m}`).join('\n')}`);
    this.name = 'HitFeelValidationError';
    this.errors = errors;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}
/** 數字欄位檢查：min 預設 0（時長/scale/距離皆 >=0，★0 合法只擋負）。 */
function checkNum(
  obj: Record<string, unknown>, key: string, errors: string[], opts: { min?: number; max?: number } = {},
): void {
  const v = obj[key];
  if (!isFiniteNumber(v)) { errors.push(`打擊感參數「${key}」缺少或非數字。`); return; }
  if (opts.min !== undefined && v < opts.min) errors.push(`打擊感參數「${key}」=${v} 不可小於 ${opts.min}。`);
  if (opts.max !== undefined && v > opts.max) errors.push(`打擊感參數「${key}」=${v} 不可大於 ${opts.max}。`);
}
/** 顏色欄位檢查：0xRRGGBB 整數 0..0xFFFFFF（0=黑，合法）。 */
function checkColor(obj: Record<string, unknown>, key: string, errors: string[]): void {
  const v = obj[key];
  if (!isFiniteNumber(v) || !Number.isInteger(v)) { errors.push(`打擊感參數「${key}」缺少或非整數顏色。`); return; }
  if (v < 0 || v > 0xffffff) errors.push(`打擊感參數「${key}」=${v} 超出顏色範圍 0..16777215。`);
}
function checkBool(obj: Record<string, unknown>, key: string, errors: string[]): void {
  if (typeof obj[key] !== 'boolean') errors.push(`打擊感參數「${key}」缺少或非布林。`);
}

export function validateHitFeel(json: unknown): ValidateHitFeelResult {
  const errors: string[] = [];
  const root = asObject(json);
  if (!root) return { ok: false, errors: ['根層級必須是物件 { version, hitFeel }。'] };

  if (!isFiniteNumber(root.version)) {
    errors.push('頂層「版本 version」缺少或非數字（預期 1）。');
  } else if (root.version !== HIT_FEEL_SCHEMA_VERSION) {
    errors.push(`頂層「版本 version」=${String(root.version)} 不支援（此版本只接受 ${HIT_FEEL_SCHEMA_VERSION}）。`);
  }

  const hf = asObject(root.hitFeel);
  if (!hf) {
    errors.push('頂層「hitFeel」缺少或不是物件。');
    return { ok: false, errors };
  }
  checkBool(hf, 'enabled', errors);
  checkColor(hf, 'hitFlashColor', errors);
  checkNum(hf, 'hitFlashDuration', errors, { min: 0 });
  checkNum(hf, 'punchScale', errors, { min: 0 });
  checkBool(hf, 'hitSparkEnabled', errors);
  checkColor(hf, 'hitSparkColor', errors);
  checkNum(hf, 'microFreezeDuration', errors, { min: 0 }); // ★0 合法（不做頓幀），只擋負
  checkNum(hf, 'knockbackDuration', errors, { min: 0 });
  checkNum(hf, 'knockbackForceScale', errors, { min: 0 });
  checkNum(hf, 'knockbackDistance', errors, { min: 0 });
  checkColor(hf, 'deathParticleColor', errors);
  checkNum(hf, 'playerHitlagDuration', errors, { min: 0 }); // ★0 合法（不做 hitlag），只擋負

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: root as unknown as HitFeelFile };
}

export function assertValidHitFeel(raw: unknown): HitFeelFile {
  const result = validateHitFeel(raw);
  if (!result.ok) throw new HitFeelValidationError(result.errors);
  return result.data;
}

// ---- 遊戲讀取端：匯入 override 優先（hitFeel 可調→套用生效）----------------

/**
 * 解析遊戲要用的打擊感參數（純函式，抽給測騎；同 resolveDash/resolveGuard 模式）：
 * - override 通過 validateHitFeel → 逐欄 override.hitFeel.X ?? 打包 HIT_FEEL.X（override 缺欄沿用打包）。
 * - override 為 null / 壞 / validate 失敗 → 回打包預設 HIT_FEEL（行為 100% 不變）。
 * ★0-nullish：microFreezeDuration/playerHitlagDuration 等 0 為合法值，用 ?? 不被 || 吃掉。
 *   enabled/hitSparkEnabled 為布林（false 合法）→ 同樣 ??（|| 會把 false 誤退回預設 true）。
 * @param override loadOverride(EDITOR_STORE_KEYS.hitfeel) 的原始物件（未驗證）；null=無 override。
 * @param packaged 打包預設打擊感參數（預設 HIT_FEEL）。
 */
export function resolveHitFeel(override: unknown, packaged: HitFeelConfig = HIT_FEEL): HitFeelConfig {
  if (override === null || override === undefined) return packaged;
  const result = validateHitFeel(override);
  if (!result.ok) return packaged;
  const o = result.data.hitFeel;
  // 逐欄 ??（validate 過的完整 override 每欄都有值；?? 仍是對「缺欄」的防禦 + 明確 0-合法語意）。
  return {
    enabled: o.enabled ?? packaged.enabled,
    hitFlashColor: o.hitFlashColor ?? packaged.hitFlashColor,
    hitFlashDuration: o.hitFlashDuration ?? packaged.hitFlashDuration,
    punchScale: o.punchScale ?? packaged.punchScale,
    hitSparkEnabled: o.hitSparkEnabled ?? packaged.hitSparkEnabled,
    hitSparkColor: o.hitSparkColor ?? packaged.hitSparkColor,
    microFreezeDuration: o.microFreezeDuration ?? packaged.microFreezeDuration,
    knockbackDuration: o.knockbackDuration ?? packaged.knockbackDuration,
    knockbackForceScale: o.knockbackForceScale ?? packaged.knockbackForceScale,
    knockbackDistance: o.knockbackDistance ?? packaged.knockbackDistance,
    deathParticleColor: o.deathParticleColor ?? packaged.deathParticleColor,
    playerHitlagDuration: o.playerHitlagDuration ?? packaged.playerHitlagDuration,
  };
}

/** 已解析的打擊感參數 cache（遊戲啟動讀一次；重開換，符合「套用→重開生效」）。 */
let resolvedHitFeelCache: HitFeelConfig | null = null;

/** 遊戲端取得打擊感參數（override 優先 + cache）。EnemySpawner/Enemy/Player 用。 */
export function getResolvedHitFeel(): HitFeelConfig {
  if (resolvedHitFeelCache) return resolvedHitFeelCache;
  const override = loadOverride(EDITOR_STORE_KEYS.hitfeel);
  if (override !== null) {
    const result = validateHitFeel(override);
    if (!result.ok) console.warn('[hitFeelSchema] hitFeel override 驗證失敗，改用打包預設：', result.errors);
  }
  resolvedHitFeelCache = resolveHitFeel(override);
  return resolvedHitFeelCache;
}

/** 清空 cache（測試/熱重載用）。 */
export function clearResolvedHitFeelCache(): void {
  resolvedHitFeelCache = null;
}
