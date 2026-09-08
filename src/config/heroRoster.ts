/**
 * heroRoster.ts — 英雄名冊 + 隨機抽（大更動階段 1：角色狀態機凡人↔英雄）。
 *
 * 投幣進場時從英雄池隨機抽一個英雄變身進場（先純隨機抽，不搞權重池）。
 * 凡人(Human)不在池——凡人是待機/耗盡 credit 的常態，非可抽的英雄。
 * ★框架先到位：目前池只有 SunWukong，之後美術加英雄 key 進 HERO_ROSTER 即自動進抽池（不需改邏輯）。
 *
 * pickHero 純函式、rng 可注入（測試用固定/seed rng 便於斷言），不依賴 Phaser。
 */

/**
 * 英雄池（投幣隨機抽的候選；凡人 Human 不列入）。
 * ★之後加英雄：把新英雄的 charKey（需在 animationConfig.CHARACTERS 有對應美術）加進此陣列即生效。
 */
export const HERO_ROSTER = ['SunWukong', 'devil1', 'elf1', 'elf2', 'human2', 'legacy1'] as const;

export type HeroKey = (typeof HERO_ROSTER)[number];

/**
 * 從英雄池隨機抽一個英雄 key（純函式，純隨機均勻，rng 可注入便於測）。
 * @param roster 候選英雄 key 陣列（預設 HERO_ROSTER）；空陣列 → 回 null（呼叫端 fallback，不炸）。
 * @param rng 亂數來源，回 [0,1)（預設 Math.random；測試傳固定值鎖定抽哪個）。
 * @returns 抽中的英雄 key；roster 空 → null。
 */
export function pickHero(
  roster: readonly string[] = HERO_ROSTER,
  rng: () => number = Math.random,
): string | null {
  if (roster.length === 0) return null;
  // rng 夾在 [0,1)，index = floor(r × len)，clamp 防 r=1（少數 rng 回 1）越界。
  const r = rng();
  const safe = Number.isFinite(r) ? Math.min(0.999999, Math.max(0, r)) : 0;
  const idx = Math.floor(safe * roster.length);
  return roster[idx] ?? roster[0];
}
