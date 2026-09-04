/**
 * chestConfig.ts — 寶盒系統設定（零式定案，決策 924a1d83）。
 *
 * ⚠️ 寶盒能量(chestCharge) ≠ 技能能量(EnergySystem)：
 *   技能能量每「命中」充、4 格放招；寶盒能量每「擊殺」給、滿 165 自動開箱。兩者不同資源。
 */

/** 開箱門檻：chestCharge ≥ 此值自動開箱、扣此值（超過排隊連開）。 */
export const CHEST_OPEN_THRESHOLD = 165;

/**
 * 各敵人擊殺給的 chestCharge（key = 敵人角色 key）。
 * Rush(3血)→1、Ranged(2血)→2、Elite(10血)→5。
 * （特殊怪6血→3 / 小BOSS→每命中5 / 鼠精→0 等敵人 H5 未做，之後擴充再補。）
 */
export const CHEST_CHARGE_BY_ENEMY: Record<string, number> = {
  Enemy_Rush: 1,
  Enemy_Ranged: 2,
  Enemy_Elite: 5,
};

/** 取得某敵人擊殺給的 chestCharge（未列則 0）。 */
export function chestChargeFor(enemyKey: string): number {
  return CHEST_CHARGE_BY_ENEMY[enemyKey] ?? 0;
}

/** 寶盒獎勵種類。 */
export type ChestRewardKind =
  | 'ticketSmall'
  | 'ticketMedium'
  | 'ticketLarge'
  | 'mount'
  | 'secondTransform';

/** 抽選表一項：獎勵 + 權重(百分比) + 若為彩票類的張數。 */
export interface ChestRewardEntry {
  kind: ChestRewardKind;
  /** 權重（百分比，總和 100）。 */
  weight: number;
  /** 彩票類的給票數（效果類為 0）。 */
  tickets: number;
}

/**
 * 開箱固定抽選表（原型固定表，不做動態 RTP 調控）。零式定案 924a1d83。
 * 小票40%+50 / 中25%+120 / 大10%+260 / 坐騎15%(效果) / 二段變身10%(效果)。
 */
export const CHEST_LOOT_TABLE: readonly ChestRewardEntry[] = [
  { kind: 'ticketSmall', weight: 40, tickets: 50 },
  { kind: 'ticketMedium', weight: 25, tickets: 120 },
  { kind: 'ticketLarge', weight: 10, tickets: 260 },
  { kind: 'mount', weight: 15, tickets: 0 }, // 純效果：衝刺強化（暫定，待零式校準）
  { kind: 'secondTransform', weight: 10, tickets: 0 }, // 純效果：30s 增益（暫定，待零式校準）
] as const;
