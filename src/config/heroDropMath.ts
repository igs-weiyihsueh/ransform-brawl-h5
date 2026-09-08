/**
 * heroDropMath.ts — 怪掉落「英雄變身道具」純邏輯（大更動階段 2：英雄換英雄機制框架）。
 *
 * 怪死亡時有機率掉落一個「英雄變身道具」（帶一個英雄 key，撿了換成該英雄）。
 * 掉落率先給常數（之後可接 editorStore override 可調）；掉落判定 + 帶哪個英雄（pickHero 抽）都是純函式、rng 可注入便於測。
 *
 * ★框架先鋪：roster 現只 SunWukong→掉落道具帶的英雄=SunWukong（撿了換到同一個，看不出換人，預期）；
 *   之後 roster 加英雄即自動能掉/能換，此邏輯零改動。
 */

/** 怪死亡掉落英雄道具的機率（0~1）。先給常數，之後可接 override 可調。 */
export const HERO_DROP_RATE = 0.15;

/**
 * 判定本次擊殺是否掉落英雄道具（純函式，rng 可注入）。
 * @param rng 亂數來源，回 [0,1)（預設 Math.random；測試傳固定值鎖定掉/不掉）。
 * @param rate 掉落率（預設 HERO_DROP_RATE）；<=0 恆不掉、>=1 恆掉。
 * @returns rng() < rate → true（掉落）。
 */
export function shouldDropHeroItem(rng: () => number = Math.random, rate: number = HERO_DROP_RATE): boolean {
  const r = rng();
  const safe = Number.isFinite(r) ? r : 1; // 壞 rng → 視為不掉（保守）
  return safe < rate;
}
