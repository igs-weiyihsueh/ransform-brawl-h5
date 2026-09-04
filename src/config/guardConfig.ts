/**
 * guardConfig.ts — 守護波（Guard Event）設定（對照 Unity，決策 76f235e4）。
 * 用「名稱 key」查預設（非解析數字），找不到用內建 fallback 不炸。
 */

export interface GuardPreset {
  /** 時間限制（秒）：量條由時間扣、撐過即勝。 */
  timeLimit: number;
  /** 雕像 HP：被敵人攻擊扣，歸 0 提早結束（敗）。 */
  targetHP: number;
  /** 勝利基礎獎券（實際 = round(rewardTickets × hpRatio)）。 */
  rewardTickets: number;
}

/** 守護波預設表（名稱 key）。 */
export const GUARD_PRESETS: Record<string, GuardPreset> = {
  Guard60: { timeLimit: 60, targetHP: 100, rewardTickets: 10 },
};

/** 內建 fallback（查無預設時用，不炸）。 */
export const GUARD_FALLBACK: GuardPreset = {
  timeLimit: 60,
  targetHP: 100,
  rewardTickets: 10,
};

/** 依名稱取守護預設（查無回 fallback）。 */
export function getGuardPreset(name: string | undefined): GuardPreset {
  return (name && GUARD_PRESETS[name]) || GUARD_FALLBACK;
}

/** 守護期間 drip 生敵人參數（quota-less，維持 maxAlive 在雕像周圍）。 */
export const GUARD_DRIP = {
  maxAlive: 6,
  spawnThreshold: 4,
  spawnInterval: 1.0,
  /** 生成環繞雕像的半徑（像素）。 */
  spawnRadiusPx: 350,
} as const;
