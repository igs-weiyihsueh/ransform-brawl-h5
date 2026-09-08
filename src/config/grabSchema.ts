/**
 * grabSchema.ts — 抓人「閒置觸發秒數」editorStore override 解析（對齊 secondTransform/dashSchema 範式）。
 *
 * 用戶要在編輯器自己調「閒置多少秒沒攻擊會被抓」（用戶規格 A）：
 *   編輯器 → applyToGame(EDITOR_STORE_KEYS.grab, { version:1, idleTriggerSec })
 *   → 遊戲讀 getResolvedGrabIdleTriggerSec() 決定觸發門檻。
 * override 沒設 / 壞 / version 錯 / 值不合法 → 打包預設 GRAB.idleTriggerSeconds（現況不變）。
 *
 * 純函式（resolveGrabIdleTriggerSec）抽給測騎；getResolved* 讀 editorStore + cache（遊戲啟動讀一次）。
 */
import { GRAB } from '@/systems/grabMath';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/** 抓人設定 override 檔格式。 */
export interface GrabFile {
  version: number;
  /** 閒置多少秒沒攻擊 → 觸發被抓（對齊 GRAB.idleTriggerSeconds）。 */
  idleTriggerSec: number;
}

export const GRAB_SCHEMA_VERSION = 1 as const;

/** 編輯器初值 / 匯出範例（用打包預設）。 */
export function defaultGrabFile(): GrabFile {
  return { version: GRAB_SCHEMA_VERSION, idleTriggerSec: GRAB.idleTriggerSeconds };
}

/**
 * 解析閒置觸發秒數（純函式，抽給測騎）：
 * - override 為合法 { version:1, idleTriggerSec:有限正數(>0) } → 用 override.idleTriggerSec。
 * - null / 非物件 / version 錯 / idleTriggerSec 非有限正數 → 回打包預設（packaged）。
 * @param override loadOverride(EDITOR_STORE_KEYS.grab) 的原始物件（未驗證）；null=無 override。
 * @param packaged 打包預設秒數（預設 GRAB.idleTriggerSeconds=8）。
 */
export function resolveGrabIdleTriggerSec(
  override: unknown,
  packaged: number = GRAB.idleTriggerSeconds,
): number {
  if (override === null || override === undefined || typeof override !== 'object') return packaged;
  const o = override as { version?: unknown; idleTriggerSec?: unknown };
  if (o.version !== GRAB_SCHEMA_VERSION) return packaged;
  const v = o.idleTriggerSec;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return packaged;
  return v;
}

/** 已解析的觸發秒數 cache（遊戲啟動讀一次；重開換，符合「套用→重開生效」）。 */
let resolvedCache: number | null = null;

/** 遊戲端取得閒置觸發秒數（override 優先 + cache）。GrabSystem 用。 */
export function getResolvedGrabIdleTriggerSec(): number {
  if (resolvedCache !== null) return resolvedCache;
  const override = loadOverride(EDITOR_STORE_KEYS.grab);
  resolvedCache = resolveGrabIdleTriggerSec(override);
  return resolvedCache;
}

/** 清空 cache（測試/熱重載用）。 */
export function clearResolvedGrabCache(): void {
  resolvedCache = null;
}
