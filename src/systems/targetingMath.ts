/**
 * targetingMath.ts — 敵人有效目標判定純邏輯（七輪 待機玩家隔離）。零 Phaser、可測。
 */

/** 敵人目標介面（最小契約：能查是否待機）。Player 實作 isWaiting()。 */
export interface EnemyTargetLike {
  isWaiting?: () => boolean;
}

/**
 * 玩家是否為敵人的有效攻擊/追擊目標（純函式，抽給測騎）。
 * 待機（未參戰：開場/Credit 耗盡回待機平台）玩家不是有效目標 → 敵人不追擊、不攻擊、不環繞。
 * 加入（投幣進場，isWaiting=false）後恢復為有效目標。之後多人可在此擴充（出局/無敵等）。
 * @param player 目標玩家（需有 isWaiting）；無 isWaiting 視為有效（相容精簡 stub）。
 */
export function isValidEnemyTarget(player: EnemyTargetLike | null | undefined): boolean {
  if (!player) return false;
  if (typeof player.isWaiting === 'function' && player.isWaiting()) return false;
  return true;
}
