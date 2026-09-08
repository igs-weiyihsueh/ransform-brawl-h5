/**
 * comboRewardDisplay — COMBO 結算報獎表演的純呈現邏輯（第3項）。
 * 報獎文字/華麗度參數抽純函式方便測試。⚠️ 純視覺；不涉及 combo 數值。
 */

/** COMBO 報獎表演參數（一般 vs 滿檔）。 */
export const COMBO_REWARD_FX = {
  durationSec: 1.2,
  risePx: 100,
  /** 一般結算文字大小 / 滿檔更大。 */
  fontSizeNormal: 32,
  fontSizeMax: 56,
  /** 起手放大彈跳的峰值 scale。 */
  popScale: 1.4,
  popSec: 0.25,
  /** 文字上方偏移（相對玩家位置往上，H5 Y 下為正 → 減）。 */
  offsetYPx: 90,
} as const;

/**
 * COMBO 報獎文字：「COMBO xN  +M」。滿檔加驚嘆點綴。
 */
export function comboRewardLabel(count: number, tickets: number, isMax: boolean): string {
  const base = `COMBO x${count}  +${tickets}`;
  return isMax ? `MAX ${base}!` : base;
}

/** 依是否滿檔取字級（滿檔更華麗）。 */
export function comboRewardFontSize(isMax: boolean): number {
  return isMax ? COMBO_REWARD_FX.fontSizeMax : COMBO_REWARD_FX.fontSizeNormal;
}

/**
 * COMBO 報獎彩票噴發演出參數（純視覺；用戶要連段結算給彩票時彩票噴發）。
 * 從結算點上方扇形噴出彩票，隨機初速+重力回落+自轉+scale，閃光短命點綴。
 */
export const COMBO_TICKET_BURST = {
  /** 票數對 combo 段數的映射（min~max 張，段數越高越多）。 */
  minTickets: 8,
  maxTickets: 20,
  /** 段數線性插到 max 的上限（>= 此段數就滿噴 maxTickets）。 */
  countForMax: 30,
  /** 閃光點綴數量 min~max。 */
  minSparkles: 6,
  maxSparkles: 12,
  /** 扇形噴發角度範圍（度；-90=正上，往上偏；-120~-60 上方扇形）。 */
  angleMinDeg: -120,
  angleMaxDeg: -60,
  /** 初速範圍（px/s）。 */
  speedMin: 480,
  speedMax: 820,
  /** 重力（px/s²，H5 Y 下為正 → 正值往下拉回落）。 */
  gravity: 1400,
  /** spawn 點往上抬高（避免從角色正中擠出；相對報獎點往上）。 */
  spawnRiseYPx: 60,
  /** spawn 點水平隨機散開半寬（±px，避免擠中央）。 */
  spawnSpreadX: 70,
  /** 自轉角速度範圍（度/s，正負隨機）。 */
  spinDegPerSecMax: 180,
  /** 彩票 scale 範圍。 */
  ticketScaleMin: 0.5,
  ticketScaleMax: 1.0,
  /** 爆出時間（初速全速）→ 之後靠重力飄落。 */
  burstSec: 0.1,
  /** 飄散回落總時長範圍（秒；到期淡出銷毀）。 */
  fallSecMin: 0.8,
  fallSecMax: 1.2,
  /** 尾段淡出佔總時長比例。 */
  fadeTailRatio: 0.35,
  /** 閃光短命時長範圍（秒）。 */
  sparkleSecMin: 0.2,
  sparkleSecMax: 0.4,
  /** 滿檔（isMax）票數/閃光加成倍率。 */
  maxBonusMul: 1.25,
} as const;

/**
 * 依 combo 段數決定噴發彩票張數（純函式，可測）：
 * count 從 0 線性插到 countForMax → minTickets..maxTickets；isMax 再乘加成（夾在上限）。
 * @param minTickets/maxTickets/countForMax 可傳 override（省略用 COMBO_TICKET_BURST 預設；遊戲端傳 resolved）。
 */
export function ticketBurstCount(
  count: number,
  isMax: boolean,
  minTickets: number = COMBO_TICKET_BURST.minTickets,
  maxTickets: number = COMBO_TICKET_BURST.maxTickets,
  countForMax: number = COMBO_TICKET_BURST.countForMax,
): number {
  const c = COMBO_TICKET_BURST;
  const t = Math.min(1, Math.max(0, count / countForMax));
  let n = Math.round(minTickets + (maxTickets - minTickets) * t);
  if (isMax) n = Math.round(n * c.maxBonusMul);
  return Math.min(Math.round(maxTickets * c.maxBonusMul), Math.max(minTickets, n));
}

/** 依 combo 段數決定閃光點綴數量（純函式，可測）。 */
export function sparkleBurstCount(count: number, isMax: boolean): number {
  const c = COMBO_TICKET_BURST;
  const t = Math.min(1, Math.max(0, count / c.countForMax));
  let n = Math.round(c.minSparkles + (c.maxSparkles - c.minSparkles) * t);
  if (isMax) n = Math.round(n * c.maxBonusMul);
  return Math.min(Math.round(c.maxSparkles * c.maxBonusMul), Math.max(c.minSparkles, n));
}
