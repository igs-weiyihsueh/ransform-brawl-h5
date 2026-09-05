/**
 * progressBars — 進度條純比例計算（#7）。關卡進度 + 守護波倒數。純函式，可測。
 * 純視覺讀取；不改 WaveSystem/GuardEvent 邏輯。
 */

/** 進度條表演/佈局參數（螢幕座標）。 */
export const PROGRESS_BAR = {
  /** 關卡進度條（頂部橫條；#2 用戶反映太上面 → 往下移到 y=70）。 */
  level: { x: 460, y: 70, width: 1000, height: 18 },
  /** 守護波倒數條（關卡條下方，錯開不重疊）。 */
  guard: { x: 660, y: 104, width: 600, height: 16 },
  /** 節點 marker 半徑（當前節點放大）。 */
  markerRadius: 9,
  markerRadiusCurrent: 13,
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

/**
 * 節點 marker 在進度條上的 X 座標（沿條等距分佈）。
 * total=1 時置中；否則第 index 個落在 [barX, barX+barWidth] 等距點。
 * @param index 節點索引（0-based）。
 * @param total 總節點數。
 * @param barX 進度條左緣 X。
 * @param barWidth 進度條寬。
 */
export function nodeMarkerX(
  index: number,
  total: number,
  barX: number,
  barWidth: number,
): number {
  if (total <= 1) return barX + barWidth / 2;
  const t = index / (total - 1); // 0..1（首節點在左端、尾節點在右端）
  return barX + t * barWidth;
}

/** 節點在進度中的狀態（marker 視覺區分用）。 */
export type NodeMarkerState = 'past' | 'current' | 'future';

/**
 * 判斷第 index 個節點相對目前進度（nodeIndex）的狀態：
 * 已過（index < nodeIndex）/ 當前（== nodeIndex）/ 未到（> nodeIndex）。
 */
export function nodeMarkerState(index: number, nodeIndex: number): NodeMarkerState {
  if (index < nodeIndex) return 'past';
  if (index === nodeIndex) return 'current';
  return 'future';
}
