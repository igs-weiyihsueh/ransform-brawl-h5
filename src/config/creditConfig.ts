/**
 * creditConfig.ts — Credit（投幣/命）系統設定（對照 Unity）。
 * 彩票機核心：每次攻擊命中扣 1，歸 0 出局（耗盡狀態），投幣續命。
 */

/**
 * 起始 Credit。Unity 預設 startingCredit=0，但為 H5 好測先給 100（可玩值，之後可調）。
 */
export const STARTING_CREDIT = 100;

/** 投幣一次增加的 Credit（C 鍵）。 */
export const COIN_INSERT_AMOUNT = 100;

/** 每次攻擊命中扣的 Credit。 */
export const CREDIT_PER_HIT = 1;

/** 耗盡狀態倒數秒數（歸 0 後）。 */
export const OUT_OF_CREDIT_COUNTDOWN = 10;
