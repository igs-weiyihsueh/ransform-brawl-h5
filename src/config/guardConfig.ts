import type { EnemyType } from '@/config/levelSchema';

/**
 * guardConfig.ts — 守護波（Guard Event）設定（對照 Unity，決策 76f235e4）。
 * 用「名稱 key」查預設（非解析數字），找不到用內建 fallback 不炸。
 *
 * ⚠️ 守護的敵人 drip 參數（maxAlive/spawnThreshold/spawnInterval/spawns）放在 preset 裡，
 *    不加到「凍結的」levelSchema.EventNodeData（EventNodeData 只有 nodeType+eventPresetName）。
 *    Event 節點 JSON 只需 eventPresetName，守護的怪配置全由此 preset 決定，schema 不動。
 */

export interface GuardSpawnEntry {
  enemyType: EnemyType;
  weight: number;
}

export interface GuardPreset {
  /** 時間限制（秒）：量條由時間扣、撐過即勝。 */
  timeLimit: number;
  /** 雕像 HP：被敵人攻擊扣，歸 0 提早結束（敗）。 */
  targetHP: number;
  /** 勝利基礎獎券（實際 = round(rewardTickets × hpRatio)）。 */
  rewardTickets: number;
  /** drip：場上維持的敵人數上限。 */
  maxAlive: number;
  /** drip：存活數 < 此值才補怪。 */
  spawnThreshold: number;
  /** drip：補怪間隔（秒）。 */
  spawnInterval: number;
  /** drip：敵種權重表。 */
  spawns: GuardSpawnEntry[];
  /** 生成環繞雕像的半徑（像素）。 */
  spawnRadiusPx: number;
}

const DEFAULT_GUARD_SPAWNS: GuardSpawnEntry[] = [
  { enemyType: 'Enemy_Rush', weight: 0.7 },
  { enemyType: 'Enemy_Ranged', weight: 0.2 },
  { enemyType: 'Enemy_Elite', weight: 0.1 },
];

/** 守護波預設表（名稱 key）。preset 帶齊守護所需一切（含 drip），schema 不動。 */
export const GUARD_PRESETS: Record<string, GuardPreset> = {
  Guard60: {
    timeLimit: 60,
    targetHP: 100,
    rewardTickets: 10,
    maxAlive: 6,
    spawnThreshold: 4,
    spawnInterval: 1.0,
    spawns: DEFAULT_GUARD_SPAWNS,
    spawnRadiusPx: 350,
  },
};

/** 內建 fallback（查無預設時用，不炸）。 */
export const GUARD_FALLBACK: GuardPreset = {
  timeLimit: 60,
  targetHP: 100,
  rewardTickets: 10,
  maxAlive: 6,
  spawnThreshold: 4,
  spawnInterval: 1.0,
  spawns: DEFAULT_GUARD_SPAWNS,
  spawnRadiusPx: 350,
};

/** 依名稱取守護預設（查無回 fallback）。 */
export function getGuardPreset(name: string | undefined): GuardPreset {
  return (name && GUARD_PRESETS[name]) || GUARD_FALLBACK;
}

/** 依權重從 preset.spawns 挑一種敵種。 */
export function pickGuardEnemy(
  spawns: GuardSpawnEntry[],
  rng: () => number = Math.random,
): EnemyType {
  let total = 0;
  for (const s of spawns) total += Math.max(0, s.weight);
  if (total <= 0) return spawns[0]?.enemyType ?? 'Enemy_Rush';
  let r = rng() * total;
  for (const s of spawns) {
    r -= Math.max(0, s.weight);
    if (r < 0) return s.enemyType;
  }
  return spawns[spawns.length - 1].enemyType;
}
