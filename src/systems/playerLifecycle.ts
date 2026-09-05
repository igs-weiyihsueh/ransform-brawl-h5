/**
 * playerLifecycle — 投幣進場循環的純狀態/邏輯（對應 Unity PlayerController 投幣進場）。
 * 抽純函式供測試（投幣進場/耗盡凍結/10秒回待機/開場待機）。與 Phaser 無關。
 *
 * 狀態機：waiting →(投幣)→ entering →(落地)→ active →(Credit耗盡倒數歸0)→ returning →(回到待機點)→ waiting
 */

/** 玩家生命週期狀態。 */
export type LifecycleState = 'waiting' | 'entering' | 'active';

/**
 * 投幣時是否應觸發進場（Unity: 投幣後 if isWaiting → EnterGame）。
 * 只有 waiting 狀態投幣才進場（entering/active 投幣只加 Credit、不重複進場）。
 */
export function shouldEnterOnCoin(state: LifecycleState): boolean {
  return state === 'waiting';
}

/**
 * 耗盡倒數：回傳新的剩餘秒數（clamp 到 0）。
 */
export function tickOutOfCreditCountdown(remaining: number, dt: number): number {
  return Math.max(0, remaining - dt);
}

/**
 * 倒數是否歸零（該回待機）。remaining<=0 且原本在耗盡狀態。
 */
export function shouldReturnToWaiting(outOfCredit: boolean, remaining: number): boolean {
  return outOfCredit && remaining <= 0;
}

/**
 * active 狀態下是否可操控（移動/攻擊）：非耗盡才行。
 * waiting/entering 一律不可操控（呼叫端另擋）。
 */
export function canControlWhenActive(outOfCredit: boolean): boolean {
  return !outOfCredit;
}
