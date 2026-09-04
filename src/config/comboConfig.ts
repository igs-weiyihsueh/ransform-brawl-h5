/**
 * comboConfig.ts — COMBO 連段系統設定（對照 Unity）。
 */

/** 計時窗基準（秒）：comboCount=0 時的窗。 */
export const COMBO_BASE_TIMEOUT = 3;
/** 計時窗下限（秒）：連段再高也不低於此。 */
export const COMBO_MIN_TIMEOUT = 0.5;
/** 每 +1 連段，計時窗縮短的秒數。 */
export const COMBO_TIMEOUT_DECAY = 0.1;
/** 計時窗剩餘 < 此秒數 → 警告閃爍。 */
export const COMBO_WARNING_TIME = 2;
/** 結算彩票倍率：tickets = ceil(comboCount × 此值)。 */
export const COMBO_TICKET_MULTIPLIER = 0.5;
/** 連段上限：達到即強制結算。 */
export const COMBO_MAX_COUNT = 100;

/**
 * 依當前連段數算計時窗：max(minTimeout, baseTimeout - count × decay)。
 * 連段越高窗越短（3s 起、每 +1 減 0.1s、最低 0.5s）。純函式，供測試。
 */
export function comboTimeoutFor(count: number): number {
  return Math.max(
    COMBO_MIN_TIMEOUT,
    COMBO_BASE_TIMEOUT - count * COMBO_TIMEOUT_DECAY,
  );
}

/** 結算彩票數：ceil(count × multiplier)。純函式，供測試。 */
export function ticketsForCombo(count: number): number {
  return Math.ceil(count * COMBO_TICKET_MULTIPLIER);
}
