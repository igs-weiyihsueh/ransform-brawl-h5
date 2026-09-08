/**
 * secondTransformSchema.ts — 二段變身 editorStore override 解析（對齊 dashSchema 範式）。
 *
 * 用戶要在編輯器自己開/關 + 調數值（不用每次找開發改 code 部署）：
 *   編輯器 → applyToGame(EDITOR_STORE_KEYS.secondTransform,
 *     { version:1, enabled, energyPerKill?, decayPerSec?, scaleMult?, attackRangeMult?, fillThreshold? })
 *   → 遊戲讀 getResolvedSecondTransform() 決定啟用+數值。
 * override 沒設 / 某欄沒設 / 壞 / version 錯 → 逐欄 fallback 打包預設 SECOND_TRANSFORM_CONFIG（現況不變）。
 *
 * 純函式（resolveSecondTransform）抽給測騎；getResolved* 讀 editorStore + cache（遊戲啟動讀一次）。
 * 開放 override 的欄：enabled（開關）+ energyPerKill/decayPerSec/scaleMult/attackRangeMult（數值）+ fillThreshold（集滿門檻，用戶要）。
 * 未開放（維持 config）：energyPerHit。
 */
import { SECOND_TRANSFORM_CONFIG } from '@/config/combatConfig';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/** 二段變身 override 檔格式（enabled 必填；數值欄 optional，缺→config 預設）。 */
export interface SecondTransformFile {
  version: number;
  enabled: boolean;
  energyPerKill?: number;
  decayPerSec?: number;
  scaleMult?: number;
  attackRangeMult?: number;
  /** 集滿觸發二段的能量門檻（ratio，(0,1]；energy cap=1，>1 永不觸發故不採用）。 */
  fillThreshold?: number;
}

/** 已解析的二段變身可調值（遊戲端讀）。 */
export interface ResolvedSecondTransform {
  enabled: boolean;
  energyPerKill: number;
  decayPerSec: number;
  scaleMult: number;
  attackRangeMult: number;
  fillThreshold: number;
}

export const SECOND_TRANSFORM_SCHEMA_VERSION = 1 as const;

/** 打包預設（逐欄 fallback 用）。 */
function packagedResolved(): ResolvedSecondTransform {
  return {
    enabled: SECOND_TRANSFORM_CONFIG.enabled,
    energyPerKill: SECOND_TRANSFORM_CONFIG.energyPerKill,
    decayPerSec: SECOND_TRANSFORM_CONFIG.decayPerSec,
    scaleMult: SECOND_TRANSFORM_CONFIG.scaleMult,
    attackRangeMult: SECOND_TRANSFORM_CONFIG.attackRangeMult,
    fillThreshold: SECOND_TRANSFORM_CONFIG.fillThreshold,
  };
}

/** 編輯器初值 / 匯出範例（用打包預設）。 */
export function defaultSecondTransformFile(): SecondTransformFile {
  return {
    version: SECOND_TRANSFORM_SCHEMA_VERSION,
    enabled: SECOND_TRANSFORM_CONFIG.enabled,
    energyPerKill: SECOND_TRANSFORM_CONFIG.energyPerKill,
    decayPerSec: SECOND_TRANSFORM_CONFIG.decayPerSec,
    scaleMult: SECOND_TRANSFORM_CONFIG.scaleMult,
    attackRangeMult: SECOND_TRANSFORM_CONFIG.attackRangeMult,
    fillThreshold: SECOND_TRANSFORM_CONFIG.fillThreshold,
  };
}

/** 有限正數（>0）守衛：數值欄需 finite 且 >0 才採用，否則 fallback。 */
function posNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/**
 * 集滿門檻守衛：ratio 需 finite 且在 (0,1] 才採用（energy cap=1，>1 永不觸發故拒；≤0 無意義）。否則 fallback。
 */
function fillNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1 ? v : undefined;
}

/**
 * 解析二段變身可調值（純函式，抽給測騎）：逐欄 override 優先、無/不合法 fallback 打包預設。
 * - override null / 非物件 / version 錯 → 全回 packaged（現況不變）。
 * - enabled 非 boolean → 用 packaged.enabled；各數值欄非有限正數 → 用 packaged 該欄（逐欄 ??，匯入相容）。
 * @param override loadOverride(secondTransform) 原始物件（未驗證）；null=無。
 * @param packaged 打包預設（預設 SECOND_TRANSFORM_CONFIG 各欄）。
 */
export function resolveSecondTransform(
  override: unknown,
  packaged: ResolvedSecondTransform = packagedResolved(),
): ResolvedSecondTransform {
  if (override === null || override === undefined || typeof override !== 'object') return { ...packaged };
  const o = override as Record<string, unknown>;
  if (o.version !== SECOND_TRANSFORM_SCHEMA_VERSION) return { ...packaged };
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : packaged.enabled,
    energyPerKill: posNum(o.energyPerKill) ?? packaged.energyPerKill,
    decayPerSec: posNum(o.decayPerSec) ?? packaged.decayPerSec,
    scaleMult: posNum(o.scaleMult) ?? packaged.scaleMult,
    attackRangeMult: posNum(o.attackRangeMult) ?? packaged.attackRangeMult,
    fillThreshold: fillNum(o.fillThreshold) ?? packaged.fillThreshold,
  };
}

/**
 * 只解析「是否啟用」（純函式；相容舊呼叫端）。委派 resolveSecondTransform。
 * @param packaged 打包預設 enabled（預設 SECOND_TRANSFORM_CONFIG.enabled=false）。
 */
export function resolveSecondTransformEnabled(
  override: unknown,
  packaged: boolean = SECOND_TRANSFORM_CONFIG.enabled,
): boolean {
  return resolveSecondTransform(override, { ...packagedResolved(), enabled: packaged }).enabled;
}

/** 已解析值 cache（遊戲啟動讀一次；重開換，符合「套用→重開生效」）。 */
let resolvedCache: ResolvedSecondTransform | null = null;

/** 遊戲端取得二段變身已解析值（override 優先 + cache）。TransformSystem 用。 */
export function getResolvedSecondTransform(): ResolvedSecondTransform {
  if (resolvedCache) return resolvedCache;
  const override = loadOverride(EDITOR_STORE_KEYS.secondTransform);
  resolvedCache = resolveSecondTransform(override);
  return resolvedCache;
}

/** 遊戲端取得二段變身是否啟用（便利；讀 getResolvedSecondTransform）。 */
export function getResolvedSecondTransformEnabled(): boolean {
  return getResolvedSecondTransform().enabled;
}

/** 清空 cache（測試/熱重載用）。 */
export function clearResolvedSecondTransformCache(): void {
  resolvedCache = null;
}
