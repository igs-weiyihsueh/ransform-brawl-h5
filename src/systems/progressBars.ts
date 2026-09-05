/**
 * progressBars — 進度條純比例計算（#7）。關卡進度 + 守護波倒數。純函式，可測。
 * 純視覺讀取；不改 WaveSystem/GuardEvent 邏輯。
 */

/** 進度條表演/佈局參數（螢幕座標）。 */
export const PROGRESS_BAR = {
  /** 關卡進度條（頂部橫條）。 */
  level: { x: 460, y: 24, width: 1000, height: 18 },
  /** 守護波倒數條（頂部、關卡條下方）。 */
  guard: { x: 660, y: 52, width: 600, height: 16 },
} as const;

/**
 * 關卡進度比例（0..1）= 已完成節點 / 總節點。
 * nodeIndex 為目前所在節點（0-based），total 為總節點數。
 * 已完成 = nodeIndex（尚未完成當前）；跑到 total（尾端）= 1。
 */
export function levelProgressRatio(nodeIndex: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, nodeIndex / total));
}

/** 守護波倒數比例（0..1）= remaining / timeLimit。 */
export function guardTimeRatio(remaining: number, timeLimit: number): number {
  if (timeLimit <= 0) return 0;
  return Math.min(1, Math.max(0, remaining / timeLimit));
}
