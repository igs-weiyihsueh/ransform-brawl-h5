/**
 * secondTransformSchema.ts — 二段變身「啟用開關」editorStore override 解析（對齊 dashSchema 範式）。
 *
 * 用戶要在編輯器自己開/關二段變身（不用每次找開發改 code 部署）：
 *   編輯器 toggle → applyToGame(EDITOR_STORE_KEYS.secondTransform, { version:1, enabled:true/false })
 *   → 遊戲讀 getResolvedSecondTransformEnabled() 決定啟用。
 * override 沒設 / 壞 / version 錯 → 打包預設 SECOND_TRANSFORM_CONFIG.enabled（=false，現況不變）。
 *
 * 純函式（resolveSecondTransformEnabled）抽給測騎；getResolved* 讀 editorStore + cache（遊戲啟動讀一次）。
 * 目前只開「enabled 開關」override（用戶要的）；數值（energyPerKill 等）維持 config，不過度開放。
 */
import { SECOND_TRANSFORM_CONFIG } from '@/config/combatConfig';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/** 二段變身開關 override 檔格式。 */
export interface SecondTransformFile {
  version: number;
  enabled: boolean;
}

export const SECOND_TRANSFORM_SCHEMA_VERSION = 1 as const;

/** 編輯器初值 / 匯出範例（用打包預設 enabled）。 */
export function defaultSecondTransformFile(): SecondTransformFile {
  return { version: SECOND_TRANSFORM_SCHEMA_VERSION, enabled: SECOND_TRANSFORM_CONFIG.enabled };
}

/**
 * 解析二段變身是否啟用（純函式，抽給測騎）：
 * - override 為合法 { version:1, enabled:boolean } → 用 override.enabled。
 * - null / 非物件 / version 錯 / enabled 非 boolean → 回打包預設（packaged，預設 false）。
 * @param override loadOverride(EDITOR_STORE_KEYS.secondTransform) 的原始物件（未驗證）；null=無 override。
 * @param packaged 打包預設 enabled（預設 SECOND_TRANSFORM_CONFIG.enabled=false）。
 */
export function resolveSecondTransformEnabled(
  override: unknown,
  packaged: boolean = SECOND_TRANSFORM_CONFIG.enabled,
): boolean {
  if (override === null || override === undefined || typeof override !== 'object') return packaged;
  const o = override as { version?: unknown; enabled?: unknown };
  if (o.version !== SECOND_TRANSFORM_SCHEMA_VERSION) return packaged;
  if (typeof o.enabled !== 'boolean') return packaged;
  return o.enabled;
}

/** 已解析的啟用旗標 cache（遊戲啟動讀一次；重開換，符合「套用→重開生效」）。 */
let resolvedEnabledCache: boolean | null = null;

/** 遊戲端取得二段變身是否啟用（override 優先 + cache）。TransformSystem 用。 */
export function getResolvedSecondTransformEnabled(): boolean {
  if (resolvedEnabledCache !== null) return resolvedEnabledCache;
  const override = loadOverride(EDITOR_STORE_KEYS.secondTransform);
  resolvedEnabledCache = resolveSecondTransformEnabled(override);
  return resolvedEnabledCache;
}

/** 清空 cache（測試/熱重載用）。 */
export function clearResolvedSecondTransformCache(): void {
  resolvedEnabledCache = null;
}
