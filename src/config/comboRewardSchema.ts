/**
 * comboRewardSchema.ts — COMBO 獎參數 editorStore override 解析（用戶要「COMBO 獎的參數要開放設定」，全開放 A+B）。
 *
 * 編輯器 → applyToGame(EDITOR_STORE_KEYS.comboReward, { version:1, ...欄 })
 *   → 遊戲讀 getResolvedComboReward() 決定 COMBO 獎結算/計時/報獎表演/彩票噴發數。
 * override 沒設 / 某欄沒設 / 壞 / version 錯 → 逐欄 fallback 打包預設（comboConfig / comboRewardDisplay 現值）→ 現況不變。
 *
 * 純函式（resolveComboReward）抽給測騎；getResolved* 讀 editorStore + cache（遊戲啟動讀一次）。
 * 開放欄（全 A+B，噴發純視覺動態細節[speed/gravity/spin/fall]不開，省 UI 雜）：
 *   A 結算/計時：ticketMultiplier / maxCount / baseTimeout / timeoutDecay / minTimeout / warningTime
 *   B 報獎表演/噴發：rewardDurationSec / burstMinTickets / burstMaxTickets / burstCountForMax
 */
import {
  COMBO_TICKET_MULTIPLIER,
  COMBO_MAX_COUNT,
  COMBO_BASE_TIMEOUT,
  COMBO_TIMEOUT_DECAY,
  COMBO_MIN_TIMEOUT,
  COMBO_WARNING_TIME,
} from '@/config/comboConfig';
import { COMBO_REWARD_FX, COMBO_TICKET_BURST } from '@/systems/comboRewardDisplay';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/** COMBO 獎已解析可調值（遊戲端讀）。 */
export interface ResolvedComboReward {
  // A 結算/計時
  ticketMultiplier: number;
  maxCount: number;
  baseTimeout: number;
  timeoutDecay: number;
  minTimeout: number;
  warningTime: number;
  // B 報獎表演/噴發
  rewardDurationSec: number;
  burstMinTickets: number;
  burstMaxTickets: number;
  burstCountForMax: number;
}

/** COMBO 獎 override 檔格式（version + 各欄 optional，缺→config 預設）。 */
export interface ComboRewardFile {
  version: number;
  ticketMultiplier?: number;
  maxCount?: number;
  baseTimeout?: number;
  timeoutDecay?: number;
  minTimeout?: number;
  warningTime?: number;
  rewardDurationSec?: number;
  burstMinTickets?: number;
  burstMaxTickets?: number;
  burstCountForMax?: number;
}

export const COMBO_REWARD_SCHEMA_VERSION = 1 as const;

/** 打包預設（逐欄 fallback 用）。 */
function packagedResolved(): ResolvedComboReward {
  return {
    ticketMultiplier: COMBO_TICKET_MULTIPLIER,
    maxCount: COMBO_MAX_COUNT,
    baseTimeout: COMBO_BASE_TIMEOUT,
    timeoutDecay: COMBO_TIMEOUT_DECAY,
    minTimeout: COMBO_MIN_TIMEOUT,
    warningTime: COMBO_WARNING_TIME,
    rewardDurationSec: COMBO_REWARD_FX.durationSec,
    burstMinTickets: COMBO_TICKET_BURST.minTickets,
    burstMaxTickets: COMBO_TICKET_BURST.maxTickets,
    burstCountForMax: COMBO_TICKET_BURST.countForMax,
  };
}

/** 編輯器初值 / 匯出範例（用打包預設）。 */
export function defaultComboRewardFile(): ComboRewardFile {
  return { version: COMBO_REWARD_SCHEMA_VERSION, ...packagedResolved() };
}

/**
 * 有限正數（>0）守衛：非有限正數 → undefined（fallback）。適用倍率/秒數/張數/上限（皆須 >0）。
 * timeoutDecay 允許 0（連段窗不縮），單獨用 nonNegNum。
 */
function posNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** 有限非負數（>=0）守衛：timeoutDecay 可為 0（不縮窗）。 */
function nonNegNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * 解析 COMBO 獎可調值（純函式，抽給測騎）：逐欄 override 優先、無/不合法 fallback 打包預設。
 * - override null / 非物件 / version 錯 → 全回 packaged（現況不變）。
 * - 各欄非合法（posNum >0；timeoutDecay 用 nonNegNum >=0）→ 用 packaged 該欄（逐欄 ??，匯入相容）。
 * @param override loadOverride(comboReward) 原始物件（未驗證）；null=無。
 * @param packaged 打包預設（預設 comboConfig / comboRewardDisplay 各欄）。
 */
export function resolveComboReward(
  override: unknown,
  packaged: ResolvedComboReward = packagedResolved(),
): ResolvedComboReward {
  if (override === null || override === undefined || typeof override !== 'object') return { ...packaged };
  const o = override as Record<string, unknown>;
  if (o.version !== COMBO_REWARD_SCHEMA_VERSION) return { ...packaged };
  return {
    ticketMultiplier: posNum(o.ticketMultiplier) ?? packaged.ticketMultiplier,
    maxCount: posNum(o.maxCount) ?? packaged.maxCount,
    baseTimeout: posNum(o.baseTimeout) ?? packaged.baseTimeout,
    timeoutDecay: nonNegNum(o.timeoutDecay) ?? packaged.timeoutDecay, // 可為 0
    minTimeout: posNum(o.minTimeout) ?? packaged.minTimeout,
    warningTime: posNum(o.warningTime) ?? packaged.warningTime,
    rewardDurationSec: posNum(o.rewardDurationSec) ?? packaged.rewardDurationSec,
    burstMinTickets: posNum(o.burstMinTickets) ?? packaged.burstMinTickets,
    burstMaxTickets: posNum(o.burstMaxTickets) ?? packaged.burstMaxTickets,
    burstCountForMax: posNum(o.burstCountForMax) ?? packaged.burstCountForMax,
  };
}

/** 已解析值 cache（遊戲啟動讀一次；重開換）。 */
let resolvedCache: ResolvedComboReward | null = null;

/** 遊戲端取得 COMBO 獎已解析值（override 優先 + cache）。ComboSystem/EffectSystem 用。 */
export function getResolvedComboReward(): ResolvedComboReward {
  if (resolvedCache) return resolvedCache;
  resolvedCache = resolveComboReward(loadOverride(EDITOR_STORE_KEYS.comboReward));
  return resolvedCache;
}

/** 清空 cache（測試/熱重載用）。 */
export function clearResolvedComboRewardCache(): void {
  resolvedCache = null;
}
