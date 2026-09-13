/**
 * douqiLevelMath — 鬥氣等級雙軌純邏輯（階段 3，海牛《鬥氣割草》v45）。零 Phaser、可測。交測騎。
 *
 * ★一條 teamLevel（全隊共用、cap 10）雙軌：
 *  - levelLerp(base, lv1Scale, level, cap)＝base × scale，scale(lv)=lv1Scale+(1−lv1Scale)×(lv−1)/(cap−1)。
 *    ★★level 先夾 [1,cap]（海牛踩雷：未滿 1 或超 cap 會算錯 scale）。Lv1→lv1Scale、Lvcap→1.0（滿值）。
 *  - 升級來源＝擊殺經驗：expForKill(敵種倍率)；applyKillExp 累積經驗→跨過 expToNext 門檻即升級。
 */

/** 敵種擊殺經驗倍率（×expPerKillBase）。tower/npc/anchor=0（不給經驗）。 */
export type KillExpMult = Record<string, number>;

/**
 * ★雙軌核心：base 依 teamLevel 線性內插到滿值。
 * @param base 滿值（Lvcap 時）。
 * @param lv1Scale Lv1 的倍率（如 0.6 角色、0.35 敵 HP）。
 * @param level 當前 teamLevel（★內部夾 [1,cap]）。
 * @param cap 等級上限（10）。
 * @returns base × scale。
 */
export function levelLerp(base: number, lv1Scale: number, level: number, cap: number): number {
  const lv = Math.min(Math.max(level, 1), cap); // ★夾 [1,cap]
  if (cap <= 1) return base; // 防除零
  const scale = lv1Scale + (1 - lv1Scale) * (lv - 1) / (cap - 1);
  return base * scale;
}

/** 只回 scale 係數（不乘 base；供 maxAlive/interval 等直接取係數）。 */
export function levelScale(lv1Scale: number, level: number, cap: number): number {
  return levelLerp(1, lv1Scale, level, cap);
}

/**
 * 擊殺經驗：expPerKillBase × 敵種倍率（查不到的種類→預設 1；tower 等→0）。
 */
export function expForKill(enemyKey: string, expPerKillBase: number, mults: KillExpMult): number {
  const m = mults[enemyKey] ?? 1;
  return expPerKillBase * m;
}

/** 升級結果。 */
export interface LevelUpResult {
  level: number;
  exp: number; // 當前等級內累積經驗（未滿下一級門檻的餘額）
  leveledUp: boolean; // 這次是否升級（可能連升多級，仍回 true）
}

/**
 * 累積經驗並處理升級（可連升多級）。★level cap 後經驗不再累積（滿級）。
 * @param level 當前等級（1..cap）。
 * @param exp 當前等級內已累積經驗。
 * @param gained 本次獲得經驗。
 * @param expToNext 升級曲線：expToNext[i]＝從 Lv(i+1) 升 Lv(i+2) 所需（length=cap−1）。
 * @param cap 等級上限。
 */
export function applyKillExp(
  level: number,
  exp: number,
  gained: number,
  expToNext: readonly number[],
  cap: number,
): LevelUpResult {
  let lv = Math.min(Math.max(level, 1), cap);
  let e = exp + Math.max(0, gained);
  let leveled = false;
  while (lv < cap) {
    const need = expToNext[lv - 1]; // Lv lv → lv+1 所需（index lv-1）
    if (need == null || e < need) break;
    e -= need;
    lv += 1;
    leveled = true;
  }
  if (lv >= cap) e = 0; // 滿級不留經驗
  return { level: lv, exp: e, leveledUp: leveled };
}

/** 當前等級升下一級所需經驗（滿級回 0）。供經驗條 UI 顯示進度。 */
export function expToNextLevel(level: number, expToNext: readonly number[], cap: number): number {
  const lv = Math.min(Math.max(level, 1), cap);
  if (lv >= cap) return 0;
  return expToNext[lv - 1] ?? 0;
}
