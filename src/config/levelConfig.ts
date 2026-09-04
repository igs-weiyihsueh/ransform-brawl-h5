/**
 * 關卡/波次設定（資料驅動，對照 Unity 波次規格）。
 *
 * 關卡 = 節點序列。目前實作 Spawn 節點核心：滴流生怪、維持場上數量、
 * 殺到 killQuota 前進下一節點。Reward / Event(守護) 節點先留型別佔位，之後做。
 *
 * 對應 Unity 來源：Level0 節點序列
 *   Spawn(kill30, maxAlive15, spawnThreshold10)
 *   → Spawn(kill40, maxAlive20, spawnThreshold15)
 *   → Reward
 *   → Event(守護)
 * 生怪權重對應 Unity：Enemy_Rush 0.7 / Enemy_Ranged 0.2 / Enemy_Elite 0.1。
 *
 * 數值一律集中此檔（見 docs/h5_collab_spec.md §6），不寫死在系統裡。
 */

/** 敵種權重表：key 為 enemyConfig 的敵人類型 key，value 為相對權重（不需總和=1）。 */
export interface EnemyWeight {
  /** 對應 enemyConfig.ts ENEMY_AI 的 key（Enemy_Rush / Enemy_Ranged / Enemy_Elite）。 */
  type: string;
  /** 相對權重（挑怪種時用輪盤法）。 */
  weight: number;
}

/** 節點種類。目前只實作 Spawn；Reward/Event 先佔位（stub）。 */
export type WaveNodeType = 'spawn' | 'reward' | 'event';

/** Spawn 節點：滴流生怪，殺到 killQuota 完成。 */
export interface SpawnNode {
  type: 'spawn';
  /** 完成本節點所需擊殺數（進度 = 已殺 / killQuota）。對應 Unity killQuota。 */
  killQuota: number;
  /** 場上同時存活敵人上限。對應 Unity maxAlive。 */
  maxAlive: number;
  /**
   * 補怪門檻：場上存活數 < spawnThreshold 時，補到 maxAlive。
   * 對應 Unity spawnThreshold。
   */
  spawnThreshold: number;
  /** 每次生怪的間隔（秒）；限制滴流速度，避免一瞬間全補滿。 */
  spawnInterval: number;
  /** 敵種權重（挑怪種）。對應 Unity 生怪權重表。 */
  weights: EnemyWeight[];
}

/** Reward 節點（stub）：之後接發獎流程；目前只是佔位，WaveSystem 會直接跳過。 */
export interface RewardNode {
  type: 'reward';
  /** 之後填發獎內容；先留空。 */
  rewardId?: string;
}

/** Event 節點（stub）：守護等事件；目前佔位，WaveSystem 會直接跳過。 */
export interface EventNode {
  type: 'event';
  /** 事件識別（例：'guard'）。先留佔位。 */
  eventId?: string;
}

export type WaveNode = SpawnNode | RewardNode | EventNode;

/** 一個關卡 = 有序節點序列。 */
export interface LevelConfig {
  /** 關卡識別。 */
  id: string;
  /** 依序執行的節點。 */
  nodes: WaveNode[];
}

/**
 * 預設生怪權重（對照 Unity）：Rush 0.7 / Ranged 0.2 / Elite 0.1。
 * 各 Spawn 節點可覆寫；此處集中一份預設避免重複。
 */
export const DEFAULT_SPAWN_WEIGHTS: EnemyWeight[] = [
  { type: 'Enemy_Rush', weight: 0.7 },
  { type: 'Enemy_Ranged', weight: 0.2 },
  { type: 'Enemy_Elite', weight: 0.1 },
];

/**
 * Level0（對照 Unity）：
 *   Spawn(kill30, maxAlive15, spawnThreshold10)
 *   → Spawn(kill40, maxAlive20, spawnThreshold15)
 *   → Reward(stub)
 *   → Event 守護(stub)
 */
export const LEVEL_0: LevelConfig = {
  id: 'Level0',
  nodes: [
    {
      type: 'spawn',
      killQuota: 30,
      maxAlive: 15,
      spawnThreshold: 10,
      spawnInterval: 0.4, // H5 補值：滴流速度，Unity 未明確給則用此預設
      weights: DEFAULT_SPAWN_WEIGHTS,
    },
    {
      type: 'spawn',
      killQuota: 40,
      maxAlive: 20,
      spawnThreshold: 15,
      spawnInterval: 0.35,
      weights: DEFAULT_SPAWN_WEIGHTS,
    },
    { type: 'reward' }, // stub：之後做
    { type: 'event', eventId: 'guard' }, // stub：守護節點之後做
  ],
};

/** 目前預設載入的關卡。之後多關卡時可改為關卡表 + 選關。 */
export const DEFAULT_LEVEL: LevelConfig = LEVEL_0;
