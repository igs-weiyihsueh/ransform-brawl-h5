/**
 * mashTransformMath.ts — 連打變身（初次變身）填充純邏輯。零 Phaser、可單元測試（測騎）。
 *
 * 用戶新設計（非搬 Unity）：凡人撿變身道具 → 進「連打變身」鎖定狀態，靠連打攻擊鈕填魂力環，
 * 填滿（ratio>=1）完成變身。連打優先（有連打不自動填）；純沒打（idle）才自動填；守護波 scripted 期間自動快填。
 */

/** 連打填滿所需按鍵次數（15 下）。每按 +1/15。 */
export const MASH_HITS_TO_FULL = 15;

/** 每次連打攻擊填充量（ratio）。 */
export const MASH_PER_HIT = 1 / MASH_HITS_TO_FULL;

/** 判定「沒在連打」的 idle 門檻（秒）：距離上次連打超過此值 → 啟動自動填。 */
export const MASH_IDLE_TO_AUTO_SEC = 0.5;

/** 自動填速率（純沒打時）：10 秒填滿 → 每秒 +0.1 ratio。 */
export const MASH_AUTO_FILL_PER_SEC = 1 / 10;

/** 守護波 scripted（玩家被控制不能連打）自動快速填速率：~1 秒填滿 → 每秒 +1.0 ratio（不卡變身流程）。 */
export const MASH_SCRIPTED_FILL_PER_SEC = 1.0;

/** 完成變身的 ratio 門檻。 */
export const MASH_COMPLETE_RATIO = 1;

/** 連打一次後的填充比例（clamp 0..1）。 */
export function mashRatioAfterHit(ratio: number): number {
  return Math.min(1, Math.max(0, ratio) + MASH_PER_HIT);
}

/**
 * 自動填模式判定（用戶確認 1：連打優先，純沒打才自動）。
 * @param sinceLastMashSec 距上次連打的秒數
 * @returns 是否應啟動自動填（idle 超過門檻）
 */
export function shouldAutoFill(sinceLastMashSec: number): boolean {
  return sinceLastMashSec >= MASH_IDLE_TO_AUTO_SEC;
}

/**
 * 本幀自動填增量（ratio）。scripted（守護波被控）→ 快填；否則一般自動填（僅在 idle 超門檻時，由呼叫端 gate）。
 * @param dt 幀時間（秒）
 * @param scripted 是否守護波 scripted（自動快填）
 */
export function autoFillDelta(dt: number, scripted: boolean): number {
  const rate = scripted ? MASH_SCRIPTED_FILL_PER_SEC : MASH_AUTO_FILL_PER_SEC;
  return rate * Math.max(0, dt);
}

/** 是否填滿（完成變身）。用 epsilon 容忍浮點累加（15×(1/15) 可能=0.9999999）。 */
export function isMashComplete(ratio: number): boolean {
  return ratio >= MASH_COMPLETE_RATIO - 1e-9;
}
