/**
 * douqiItemConfig — 鬥氣道具系統 v45 config（階段1：生成/掉落/場上/護盾參數；效果階段2、破盾階段1.5）。
 *
 * ★只 douqi（DouqiItemSystem gate gameMode==='douqi'）；normal 完全不生道具、不受影響。
 * 7 種道具對應 skill A~T，掉落加權隨機（T 時停稀有 0.25），場上靜置+lifespan+閃爍+maxAlive 上限，護盾 shieldHp3（破盾邏輯階段1.5 接）。
 */

/** 道具 skill 種類（v45 7 種）。 */
export type DouqiItemSkill = 'A' | 'B' | 'C' | 'E' | 'F' | 'H' | 'T';

/** 單一道具種類描述。 */
export interface DouqiItemEntry {
  skill: DouqiItemSkill;
  /** 識別色（場上色塊/護盾圈佔位；階段2 素材到換圖示）。 */
  color: number;
  /** 掉落加權（A~H 各 1、T 時停稀有 0.25）。 */
  weight: number;
  /** 佔位顯示字母（階段1 色塊上標；素材到移除）。 */
  label: string;
}

export interface DouqiItemConfig {
  /** 7 種道具表。 */
  entries: DouqiItemEntry[];
  /** 打死怪掉落機率（roll ≤ 此則掉）。v45=0.06。 */
  dropChance: number;
  /** 定時保底掉落間隔 ms（0＝關）。v45=0。 */
  periodicDropMs: number;
  /** 拾取判定半徑 px（overlap 距離）。v45=15。 */
  pickupRadiusPx: number;
  /** 道具場上存活時長 ms（逾時消失）。v45=14000。 */
  lifespanMs: number;
  /** 逾時前開始閃爍提示的剩餘 ms。v45=2500。 */
  blinkBeforeMs: number;
  /** 閃爍週期 ms（顯/隱交替）。 */
  blinkPeriodMs: number;
  /** 場上道具同時上限（滿了新掉落不生）。v45=5。 */
  maxAlive: number;
  /** 護盾血量（攻擊打幾下破盾才可拾；破盾邏輯階段1.5 接，config 先備）。v45=3。 */
  shieldHp: number;
  /** 場上顯示半徑 px（色塊/圖示視覺大小；純顯示）。 */
  displayRadiusPx: number;
}

/** ★v45 道具參數（海牛規格）。 */
export const DOUQI_ITEM_CONFIG: DouqiItemConfig = {
  entries: [
    { skill: 'A', color: 0x00e5ff, weight: 1, label: 'A' }, // 旋風斬 青
    { skill: 'B', color: 0xffd700, weight: 1, label: 'B' }, // 雷擊 金
    { skill: 'C', color: 0xff4d6d, weight: 1, label: 'C' }, // 居合 紅
    { skill: 'E', color: 0xa855f7, weight: 1, label: 'E' }, // 震爆 紫
    { skill: 'F', color: 0xff7a1a, weight: 1, label: 'F' }, // 噴火 橙紅
    { skill: 'H', color: 0x2ecc71, weight: 1, label: 'H' }, // 補血 綠
    { skill: 'T', color: 0xffffff, weight: 0.25, label: 'T' }, // 時停 白（稀有）
  ],
  dropChance: 0.06,
  periodicDropMs: 0,
  pickupRadiusPx: 15,
  lifespanMs: 14000,
  blinkBeforeMs: 2500,
  blinkPeriodMs: 200,
  maxAlive: 5,
  shieldHp: 3,
  displayRadiusPx: 16,
};
