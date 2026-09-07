/**
 * dashSchema.ts — 玩家衝刺參數格式 + 驗證（衝刺範圍可調，遊戲讀取端 + dash-editor 共用單一真相）。
 *
 * 對齊 enemySchema/skillSchema/uiLayoutSchema 模式：零 Phaser，只 import DASH_CONFIG 型別/值當打包預設。
 * 匯出結構 { version, dash: DashConfig }。DASH_CONFIG(combatConfig)當打包預設，override(localStorage)優先。
 */
import { DASH_CONFIG } from '@/config/combatConfig';
import { PPU } from '@/config/gameConfig';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/** 衝刺參數（對應 combatConfig DASH_CONFIG，Unity SetDashParams）。 */
export interface DashConfig {
  /** 衝刺速度（unit/s，Unity dashSpeed）。 */
  speed: number;
  /** 衝刺持續時間（秒，Unity dashDuration）。 */
  duration: number;
  /** 衝刺命中傷害。 */
  damage: number;
  /** 衝刺命中側向擊退力道。 */
  knockback: number;
  /** 衝刺命中判定圓半徑（unit）。 */
  radius: number;
  /** 衝刺充能最大格數（十六輪充能式衝刺）。 */
  maxCharges: number;
  /** 每格衝刺充能回充時間（秒）。 */
  cooldownDuration: number;
}

/** 匯出檔頂層。 */
export interface DashFile {
  version: number;
  dash: DashConfig;
}

export const DASH_SCHEMA_VERSION = 1 as const;

/** 從打包預設 DASH_CONFIG 深拷貝一份當初值（editor 初值 / resolve fallback）。 */
export function defaultDash(): DashConfig {
  return { ...DASH_CONFIG };
}
export function defaultDashFile(): DashFile {
  return { version: DASH_SCHEMA_VERSION, dash: defaultDash() };
}

/**
 * 衝刺距離（unit）= speed × duration（純函式，可測 + editor 預覽）。
 * @param speed 衝刺速度（unit/s）。
 * @param duration 持續時間（秒）。
 */
export function dashDistance(speed: number, duration: number): number {
  return speed * duration;
}

// ---- 驗證（大聲失敗、精準定位；零遊戲依賴，只驗型別/範圍）---------------

export type ValidateDashResult =
  | { ok: true; data: DashFile }
  | { ok: false; errors: string[] };

export class DashValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`衝刺參數驗證失敗（${errors.length} 項）：\n${errors.map((m) => `  - ${m}`).join('\n')}`);
    this.name = 'DashValidationError';
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
  obj: Record<string, unknown>, key: string, errors: string[], opts: { min?: number } = {},
): void {
  const v = obj[key];
  if (!isFiniteNumber(v)) errors.push(`衝刺參數「${key}」缺少或非數字。`);
  else if (opts.min !== undefined && v < opts.min) errors.push(`衝刺參數「${key}」=${v} 不可小於 ${opts.min}。`);
}

export function validateDash(json: unknown): ValidateDashResult {
  const errors: string[] = [];
  const root = asObject(json);
  if (!root) return { ok: false, errors: ['根層級必須是物件 { version, dash }。'] };

  if (!isFiniteNumber(root.version)) {
    errors.push('頂層「版本 version」缺少或非數字（預期 1）。');
  } else if (root.version !== DASH_SCHEMA_VERSION) {
    errors.push(`頂層「版本 version」=${String(root.version)} 不支援（此版本只接受 ${DASH_SCHEMA_VERSION}）。`);
  }

  const dash = asObject(root.dash);
  if (!dash) {
    errors.push('頂層「dash」缺少或不是物件。');
    return { ok: false, errors };
  }
  checkNum(dash, 'speed', errors, { min: 0 });
  checkNum(dash, 'duration', errors, { min: 0 });
  checkNum(dash, 'damage', errors, { min: 0 });
  checkNum(dash, 'knockback', errors, { min: 0 });
  checkNum(dash, 'radius', errors, { min: 0 });
  // 十六輪 充能式衝刺欄位：向後相容——舊 override 沒這兩欄則以打包預設補（不報錯）；
  //   有給才驗範圍（maxCharges>=1、cooldownDuration>0）。
  if (dash.maxCharges === undefined) dash.maxCharges = DASH_CONFIG.maxCharges;
  else checkNum(dash, 'maxCharges', errors, { min: 1 });
  if (dash.cooldownDuration === undefined) dash.cooldownDuration = DASH_CONFIG.cooldownDuration;
  else checkNum(dash, 'cooldownDuration', errors, { min: 0 });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: root as unknown as DashFile };
}

export function assertValidDash(raw: unknown): DashFile {
  const result = validateDash(raw);
  if (!result.ok) throw new DashValidationError(result.errors);
  return result.data;
}

// ---- 遊戲讀取端：匯入 override 優先（衝刺可調→套用生效）------------------

/**
 * 解析遊戲要用的衝刺參數（純函式，抽給測騎；同 resolveEnemies/resolveSkills 模式）：
 * - override 通過 validateDash → 用 override.dash（用戶在 dash-editor 套用的）。
 * - override 為 null / 壞 / validate 失敗 → 回打包預設 DASH_CONFIG（行為 100% 不變）。
 * @param override loadOverride(EDITOR_STORE_KEYS.dash) 的原始物件（未驗證）；null=無 override。
 * @param packaged 打包預設衝刺參數（預設 DASH_CONFIG）。
 */
export function resolveDash(override: unknown, packaged: DashConfig = DASH_CONFIG): DashConfig {
  if (override === null || override === undefined) return packaged;
  const result = validateDash(override);
  return result.ok ? result.data.dash : packaged;
}

/** 已解析的衝刺參數 cache（遊戲啟動讀一次；重開換，符合「套用→重開生效」）。 */
let resolvedDashCache: DashConfig | null = null;

/** 遊戲端取得衝刺參數（override 優先 + cache）。Player/PlayerControlSystem 用。 */
export function getResolvedDash(): DashConfig {
  if (resolvedDashCache) return resolvedDashCache;
  const override = loadOverride(EDITOR_STORE_KEYS.dash);
  if (override !== null) {
    const result = validateDash(override);
    if (!result.ok) console.warn('[dashSchema] dash override 驗證失敗，改用打包預設：', result.errors);
  }
  resolvedDashCache = resolveDash(override);
  return resolvedDashCache;
}

/** 衝刺距離（px）= dashDistance(speed,duration)×PPU（getResolvedDash 便利, editor/debug）。 */
export function resolvedDashDistancePx(): number {
  const d = getResolvedDash();
  return dashDistance(d.speed, d.duration) * PPU;
}

/** 清空 cache（測試/熱重載用）。 */
export function clearResolvedDashCache(): void {
  resolvedDashCache = null;
}
