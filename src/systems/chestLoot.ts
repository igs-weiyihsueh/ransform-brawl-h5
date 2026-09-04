import {
  CHEST_LOOT_TABLE,
  type ChestRewardEntry,
  type ChestRewardKind,
} from '@/config/chestConfig';

/**
 * chestLoot.ts — 寶盒開箱抽選（純函式，可測 + 可壞版必紅）。
 *
 * 加權隨機：依 CHEST_LOOT_TABLE 的 weight（百分比，總和 100）挑一項。
 * rng 傳入 0..1 亂數（預設 Math.random），方便測試注入決定性亂數。
 */
export function pickChestReward(
  rng: () => number = Math.random,
  table: readonly ChestRewardEntry[] = CHEST_LOOT_TABLE,
): ChestRewardEntry {
  let total = 0;
  for (const e of table) total += Math.max(0, e.weight);
  if (total <= 0) return table[0];

  // r 落在 [0, total)，累加權重找命中區間。
  let r = rng() * total;
  for (const e of table) {
    r -= Math.max(0, e.weight);
    if (r < 0) return e;
  }
  return table[table.length - 1];
}

/** 判斷獎勵是否為彩票類（灌 ticket）。 */
export function isTicketReward(kind: ChestRewardKind): boolean {
  return kind === 'ticketSmall' || kind === 'ticketMedium' || kind === 'ticketLarge';
}
