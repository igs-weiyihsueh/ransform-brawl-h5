/**
 * douqiSpawnMath — 鬥氣 10 關生怪驅動純函式（階段 3 後半）。無 Phaser/場景依賴，抽給測騎測。
 *
 * ★語意 douqi 自寫（不套 normal waveMath 的 shouldSpawnMore/shouldAdvanceSpawn，語意不合——
 *   normal 是「補到 threshold」遲滯 latch，douqi 是「生滿 quota 就轉清場」）。
 * 涵蓋：關卡 quota、生怪間隔（存活時間 + 等級雙軌）、同屏上限（等級 + 多人）、
 *   怪種 byWave 解鎖輪盤加權（pickWeightedType，波騎 waveMath 未 export 前自帶）。
 */

/** clamp 到 [lo, hi]。 */
export function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 線性內插 Lv1→Lv(cap) 的倍率（等級雙軌通用）。lv 夾 [1, cap]。
 * lv=1 回 lv1Val、lv=cap 回 capVal，中間線性。
 */
export function lerpByLevel(lv1Val: number, capVal: number, lv: number, cap: number): number {
  if (cap <= 1) return capVal;
  const clamped = clampNum(lv, 1, cap);
  const t = (clamped - 1) / (cap - 1);
  return lv1Val + (capVal - lv1Val) * t;
}

/**
 * 第 wave 關的擊殺 quota（過關所需擊殺數）。
 * base + (wave-1)*growth，第 8/9 關 ×preBossMult，夾 cap。BOSS 關（第 totalWaves）quota 由 BOSS 定、此處回 cap。
 * @param wave 1-based 關卡。
 */
export function computeWaveQuota(
  wave: number,
  base: number,
  growth: number,
  preBossMult: number,
  cap: number,
  totalWaves: number,
): number {
  const w = Math.max(1, Math.floor(wave));
  let q = base + (w - 1) * growth;
  // 第 (totalWaves-2)、(totalWaves-1) 關（BOSS 前兩關，即 8/9 於 10 關制）加壓。
  if (w === totalWaves - 2 || w === totalWaves - 1) q = Math.round(q * preBossMult);
  return Math.min(q, cap);
}

/**
 * 當前生怪間隔（ms）。基準隨存活時間遞減（越玩越快）到下限，再 × 等級乘數（低等慢、滿等快）。
 * @param aliveSec 本波（或本場）已存活秒數。
 * @param teamLevel 隊伍等級。
 */
export function currentSpawnIntervalMs(
  aliveSec: number,
  teamLevel: number,
  cfg: {
    initialIntervalMs: number;
    intervalDecayPerSec: number;
    minIntervalMs: number;
    intervalMultLv1: number;
    intervalMultCap: number;
  },
  levelCap: number,
): number {
  const base = clampNum(
    cfg.initialIntervalMs - Math.max(0, aliveSec) * cfg.intervalDecayPerSec,
    cfg.minIntervalMs,
    cfg.initialIntervalMs,
  );
  const mult = lerpByLevel(cfg.intervalMultLv1, cfg.intervalMultCap, teamLevel, levelCap);
  return base * mult;
}

/**
 * 當前同屏敵人上限。基準 × 等級乘數 × 多人 aliveScale（1 人 0.4、每 +1 人 +0.2、上限 1.0）。
 * @param playerCount 存活玩家數。
 */
export function currentMaxAlive(
  teamLevel: number,
  playerCount: number,
  cfg: { maxAliveBase: number; maxAliveMultLv1: number; maxAliveMultCap: number },
  levelCap: number,
): number {
  const lvMult = lerpByLevel(cfg.maxAliveMultLv1, cfg.maxAliveMultCap, teamLevel, levelCap);
  const aliveScale = clampNum(0.4 + Math.max(0, playerCount - 1) * 0.2, 0.4, 1.0);
  return Math.max(1, Math.floor(cfg.maxAliveBase * lvMult * aliveScale));
}

/** 加權敵種項。 */
/** 加權敵種項（對齊波騎 waveMath.pickWeightedType 的泛型約束 {enemyType, weight}；unlockWave 供 byWave 解鎖過濾）。 */
export interface DouqiSpawnEntry {
  enemyType: string;
  weight: number;
  unlockWave: number;
}

/**
 * byWave 解鎖過濾：回已解鎖(unlockWave<=currentWave) 且 weight>0 的項。
 * ★波騎 waveMath.pickWeightedType 只做加權輪盤、不做解鎖過濾 → 呼叫端先用本函式 filter 再丟進去（單一來源 + douqi 解鎖語意留本檔可測）。
 */
export function filterUnlockedEntries<T extends { weight: number; unlockWave: number }>(
  entries: readonly T[],
  currentWave: number,
): T[] {
  return entries.filter((e) => e.unlockWave <= currentWave && e.weight > 0);
}

/** 是否 BOSS 關（每 totalWaves 關一次，1-based）。 */
export function isBossWave(wave: number, totalWaves: number): boolean {
  return wave >= 1 && wave % totalWaves === 0;
}

/**
 * 是否事件關（循環內第 N 關命中 eventWaves，1-based；BOSS 關優先於事件）。
 * 用 ((wave-1)%totalWaves)+1 取循環內序，避免第 13 關（>10）誤判。
 */
export function isEventWave(wave: number, totalWaves: number, eventWaves: readonly number[]): boolean {
  if (isBossWave(wave, totalWaves)) return false;
  const inCycle = ((wave - 1) % totalWaves) + 1;
  return eventWaves.includes(inCycle);
}
