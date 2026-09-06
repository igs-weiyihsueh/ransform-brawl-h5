/**
 * waveMath.ts — 波次 Spawn 節點純邏輯（用戶 #6 根治：怪沒清完就進獎勵）。
 * 抽純函式方便測試（壞版必紅）。零 Phaser 依賴。⚠️ 只給一般 Spawn 節點；守護波(Guard)是限時無配額 drip，不套此。
 */

/**
 * 一般 Spawn 節點「該不該再 drip 生怪」（用戶 #6 不超生）：
 * 只在**生產總數（已殺 kills + 場上 alive + 預警中 pending）< killQuota** 且維持場面條件成立時才生。
 * → 生產總數封頂於 quota，殺滿 quota 時場上自然清空（不會超生留殘怪帶進下一節點）。
 * @param kills 已擊殺數。
 * @param alive 場上存活敵人數。
 * @param pending 預警中（即將生成）敵人數。
 * @param quota 該波 killQuota（已依人數縮放）。
 * @param maxAlive 場上上限（已縮放）。
 * @param threshold 低於此存活數才補（已縮放）。
 * @returns 是否再生一隻。
 */
export function shouldSpawnMore(
  kills: number,
  alive: number,
  pending: number,
  quota: number,
  maxAlive: number,
  threshold: number,
): boolean {
  // 用戶 #6：生產總數不超過 quota（quota 即該波總生產量）→ 殺滿 quota 場上自然空。
  if (kills + alive + pending >= quota) return false;
  // 維持場面（原本 drip 條件）：存活(含 pending) < threshold 且未達 maxAlive 才補。
  const occupancy = alive + pending;
  return occupancy < threshold && occupancy < maxAlive;
}

/**
 * 一般 Spawn 節點「該不該推進到下一節點」（用戶 #6 gate 清空保險）：
 * 殺滿 killQuota **且**場上清空（無存活敵人、無預警中）才 advance → 不帶殘怪進下一節點（如 Reward）。
 * @param kills 已擊殺數。
 * @param quota 該波 killQuota（已縮放）。
 * @param alive 場上存活敵人數。
 * @param pending 預警中敵人數。
 */
export function shouldAdvanceSpawn(
  kills: number,
  quota: number,
  alive: number,
  pending: number,
): boolean {
  return kills >= quota && alive <= 0 && pending <= 0;
}
