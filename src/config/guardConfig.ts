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
  /**
   * 勝利基礎獎券。⚠️ 目前守護成功改給寶盒進度（佔位，決策 76f07f64），此欄位暫未使用；
   * 保留供之後正式 JP 燈號/彩金獎勵可能沿用或改欄位。
   */
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
  /**
   * 附帶火雨（用戶試玩#2，preset 內含非 schema）：火雨 preset 名（FIRE_RAIN_PRESETS 的 key，
   * 如 'FireRain'/'FireRainLight'/'FireRainHeavy'）→ 守護波同時降該種火雨（守護+火雨）。
   * 省略(undefined)=無火雨。（升級自舊 boolean：舊 true 語意=標準 'FireRain'。）
   */
  attachFireRain?: string;
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
    attachFireRain: 'FireRainLight', // 三輪#10：守護波追加火雨(用戶要)。可調 FireRain/FireRainHeavy 或由波騎 editor 開放。
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

/**
 * 守護波側邊生成內縮（像素，對照 Unity guardSideSpawnInset=2 units×PPU）：
 * 從場地左/右緣往中間內縮此距離生成（「走進來」感、不緊貼邊）。
 */
export const GUARD_SIDE_SPAWN_INSET_PX = 2 * 100; // 2 units × PPU(100) = 200

/**
 * 守護波側邊生成點（三輪#9，對照 Unity EnemySpawnerRuntime.FindGuardSideSpawnPos）：
 * 左右交替、X=場地左/右緣±inset、Y=場地 Y 範圍隨機。純函式（side 由 nextLeft 決定，翻轉在呼叫端）。
 * @param nextLeft true=這隻生左側、false=右側（呼叫端每次生成後翻轉→兩側平均）。
 * @param bounds 場地邊界 {minX,maxX,minY,maxY}（像素）。
 * @param insetPx 邊緣內縮（預設 GUARD_SIDE_SPAWN_INSET_PX）。
 * @param marginPx Y 上下邊距（避免貼頂/底，預設 60）。
 * @param rng 隨機源（預設 Math.random）。
 * @returns 生成點 {x,y}（已 clamp 在界內）。
 */
export function guardSideSpawnPoint(
  nextLeft: boolean,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  insetPx = GUARD_SIDE_SPAWN_INSET_PX,
  marginPx = 60,
  rng: () => number = Math.random,
): { x: number; y: number } {
  const rawX = nextLeft ? bounds.minX + insetPx : bounds.maxX - insetPx;
  const x = Math.max(bounds.minX, Math.min(bounds.maxX, rawX)); // clamp 界內
  const yMin = Math.min(bounds.minY + marginPx, bounds.maxY);
  const yMax = Math.max(bounds.maxY - marginPx, yMin);
  const y = yMin + rng() * (yMax - yMin);
  return { x, y };
}
