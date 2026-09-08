/**
 * targetingMath.ts — 敵人有效目標判定純邏輯（七輪 待機玩家隔離）。零 Phaser、可測。
 */

/** 敵人目標介面（最小契約：能查是否待機/沒 credit）。Player 實作 isWaiting()/isOutOfCredit()。 */
export interface EnemyTargetLike {
  isWaiting?: () => boolean;
  /** 十五輪：沒 credit（耗盡）玩家＝無敵待機，敵人不鎖定/攻擊/環繞（對齊 Unity isOutOfCredit）。 */
  isOutOfCredit?: () => boolean;
}

/**
 * 玩家是否為敵人的有效攻擊/追擊目標（純函式，抽給測騎）。
 * 待機（未參戰：開場/Credit 耗盡回待機平台）或沒 credit（耗盡無敵）玩家不是有效目標
 * → 敵人不追擊、不攻擊、不環繞。加入（投幣進場，isWaiting=false 且非耗盡）後恢復為有效目標。
 * @param player 目標玩家（需有 isWaiting）；無 isWaiting 視為有效（相容精簡 stub）。
 */
export function isValidEnemyTarget(player: EnemyTargetLike | null | undefined): boolean {
  if (!player) return false;
  if (typeof player.isWaiting === 'function' && player.isWaiting()) return false;
  if (typeof player.isOutOfCredit === 'function' && player.isOutOfCredit()) return false;
  return true;
}

/** 最小座標介面（零 Phaser）。 */
export interface Vec2Like {
  x: number;
  y: number;
}

/**
 * 找離 from 最近的候選點（純函式，抽給測騎；十一輪#2 玩家 auto-aim 找最近怪）。
 * @param from 起點（玩家位置）。
 * @param points 候選點清單（存活敵人的 hitCenter）。
 * @returns 最近點（回傳該物件參照）；清單空 → null。距離相同取先出現者（穩定）。
 */
export function nearestPoint<T extends Vec2Like>(from: Vec2Like, points: readonly T[]): T | null {
  let best: T | null = null;
  let bestD2 = Infinity;
  for (const p of points) {
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = p;
    }
  }
  return best;
}

/**
 * lunge（攻擊前戳）速度每幀衰減（純函式，抽給測騎；十一輪#2）。
 * 指數衰減：new = vel × factor^(dt×60)（以 60fps 為基準，dt 不同 factor 效果一致）。近 0 視為停止。
 * @param vel 當前 lunge 速度分量。
 * @param dt 幀時間（秒）。
 * @param factor 每幀（1/60s）衰減係數（0<factor<1，如 0.85）。
 * @param stopEps 低於此絕對值視為 0（避免無限小尾巴）。
 * @returns 衰減後速度（|v|<stopEps → 0）。
 */
export function lungeDecay(vel: number, dt: number, factor: number, stopEps = 1): number {
  const decayed = vel * Math.pow(factor, dt * 60);
  return Math.abs(decayed) < stopEps ? 0 : decayed;
}
