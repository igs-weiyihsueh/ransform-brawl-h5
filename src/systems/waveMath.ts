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
  nextIsSpawn = false,
): boolean {
  // 六輪#5(Unity dripMaintainThroughToNext)：下一節點也是 Spawn → 殺滿 quota 即前進(殘怪接續帶進下一波、場面不提前變空)。
  //   下一節點非 Spawn(Reward/Event) → 維持原本「殺滿且場上清空才進」(不把戰鬥拖進獎勵/守護畫面)。
  if (nextIsSpawn) return kills >= quota;
  return kills >= quota && alive <= 0 && pending <= 0;
}

/**
 * 選生怪位置（七輪 spawn 位置 bug 純函式，抽給測騎）：在 bounds 內隨機取點，
 * 且離玩家至少 minDist（跑 tries 次，回第一個滿足 minDist 的；都不滿足回最後一次隨機點）。
 * ⚠️ bounds 應為怪可移動區(ENEMY_PLAY_BOUNDS 已 inset 體型)→生怪點在界內(不出遊戲區/不進面板)。
 * 「回第一個滿足」而非挑最遠 → 不會總生在超遠處(用戶：離玩家太遠)。
 * @param bounds 生成範圍 {minX,maxX,minY,maxY}(像素)。
 * @param playerPos 玩家位置(避免生太近)。
 * @param minDist 離玩家最小距離(像素)。
 * @param rng 回 [0,1) 隨機源(測試可注入)。
 * @param tries 嘗試次數(預設 8)。
 */
export function pickSpawnPoint(
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  playerPos: { x: number; y: number },
  minDist: number,
  rng: () => number,
  tries = 8,
): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    x = bounds.minX + rng() * (bounds.maxX - bounds.minX);
    y = bounds.minY + rng() * (bounds.maxY - bounds.minY);
    if (Math.hypot(x - playerPos.x, y - playerPos.y) >= minDist) break; // 第一個夠遠的即用(不挑最遠)
  }
  return { x, y };
}
