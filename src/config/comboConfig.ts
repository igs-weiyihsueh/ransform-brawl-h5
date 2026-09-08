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
 * 連段越高窗越短（預設 3s 起、每 +1 減 0.1s、最低 0.5s）。純函式，供測試。
 * @param count 當前連段數。
 * @param baseTimeout/minTimeout/decay 可傳 override（省略用 config 預設；遊戲端傳 getResolvedComboReward()）。
 */
export function comboTimeoutFor(
  count: number,
  baseTimeout: number = COMBO_BASE_TIMEOUT,
  minTimeout: number = COMBO_MIN_TIMEOUT,
  decay: number = COMBO_TIMEOUT_DECAY,
): number {
  return Math.max(minTimeout, baseTimeout - count * decay);
}

/**
 * 結算彩票數：ceil(count × multiplier)。純函式，供測試。
 * @param multiplier 可傳 override（省略用 config 預設 COMBO_TICKET_MULTIPLIER）。
 */
export function ticketsForCombo(count: number, multiplier: number = COMBO_TICKET_MULTIPLIER): number {
  return Math.ceil(count * multiplier);
}
