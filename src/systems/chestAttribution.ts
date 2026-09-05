/**
 * chestAttribution.ts — 寶盒擊殺歸屬：按各 player 對這隻怪的傷害比例分配 chestCharge。
 * 決策 c61872a6（推翻 Unity last-hit）。純函式，可測 + 可壞版必紅。
 */

/** 分配結果：playerId → 分到的 chestCharge。 */
export type ChestShareResult = Map<number, number>;

/**
 * 按傷害比例分配 total chestCharge：floor 分配，餘數給貢獻最大者。
 * 無人打（sumDmg<=0）→ 全給 fallbackPlayerId（防呆）。
 * @param total 該怪的 chestCharge 總量。
 * @param damageByPlayer 各 player 對這隻的傷害。
 * @param fallbackPlayerId 無傷害時的兜底 player（通常 P1=0）。
 */
export function splitChestByDamage(
  total: number,
  damageByPlayer: ReadonlyMap<number, number>,
  fallbackPlayerId = 0,
): ChestShareResult {
  const result: ChestShareResult = new Map();
  if (total <= 0) return result;

  let sumDmg = 0;
  for (const d of damageByPlayer.values()) sumDmg += Math.max(0, d);
  if (sumDmg <= 0) {
    result.set(fallbackPlayerId, total);
    return result;
  }

  let allocated = 0;
  let topId = fallbackPlayerId;
  let topDmg = -1;
  for (const [pid, dmg] of damageByPlayer) {
    const share = Math.floor((total * Math.max(0, dmg)) / sumDmg);
    result.set(pid, share);
    allocated += share;
    if (dmg > topDmg) {
      topDmg = dmg;
      topId = pid;
    }
  }
  const remainder = total - allocated;
  if (remainder > 0) {
    result.set(topId, (result.get(topId) ?? 0) + remainder); // 餘數給貢獻最大者
  }
  return result;
}
