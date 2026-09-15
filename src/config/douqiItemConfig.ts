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
  /** ★階段2a/2b：道具效果參數（E 震爆/A 旋風 DOT/B 雷擊/C 居合/F 噴火；T 時停留 2c；H 補血已移除）。 */
  effect: {
    /** E 震爆：跳→砸→落地圓形一次性。 */
    burst: { jumpMs: number; slamMs: number; radiusPx: number; damage: number; knockback: number; visualMs: number; color: number };
    /** A 旋風斬：以角色為心持續 DOT 圓場（跟角色移動）。 */
    whirl: { radiusPx: number; durationMs: number; tickMs: number; damagePerHit: number; knockback: number; color: number };
    /** B 天降雷擊：角色周圍環繞多道依序落雷。 */
    thunder: { orbitRadiusPx: number; strikes: number; strikeRadiusPx: number; damage: number; knockback: number; strikeDelayMs: number; chargeMs: number; color: number };
    /** ★C 居合貫穿（2b）：位移直線來回兩趟、沿路徑取樣圓命中（走既有 setPosition+scriptedControl）。 */
    iai: { distancePx: number; speedPxPerSec: number; windupMs: number; hitRadiusPx: number; damage: number; knockback: number; passes: number; sampleStepPx: number; color: number };
    /** ★F 噴火（2b）：矩形火道即時傷 + 地面燒灼 DOT 矩形。 */
    flame: {
      windupMs: number; sprayMs: number; color: number;
      flameLengthPx: number; flameWidthPx: number; burstDamage: number; burstKnockback: number;
      burnLengthPx: number; burnWidthPx: number; burnStartPx: number; burnDurationMs: number; burnTickMs: number; burnTickDamage: number;
    };
  };
}

/** ★v45 道具參數（海牛規格）。 */
export const DOUQI_ITEM_CONFIG: DouqiItemConfig = {
  entries: [
    { skill: 'A', color: 0x00e5ff, weight: 1, label: 'A' }, // 旋風斬 青
    { skill: 'B', color: 0xffd700, weight: 1, label: 'B' }, // 雷擊 金
    { skill: 'C', color: 0xff4d6d, weight: 1, label: 'C' }, // 居合 紅
    { skill: 'E', color: 0xa855f7, weight: 1, label: 'E' }, // 震爆 紫
    { skill: 'F', color: 0xff7a1a, weight: 1, label: 'F' }, // 噴火 橙紅
    { skill: 'T', color: 0xffffff, weight: 0.25, label: 'T' }, // 時停 白（稀有）
    // ★H 補血已移除（用戶：我方無血量、補二段能量意義模糊，拿掉）。剩 6 種。
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
  effect: {
    burst: { jumpMs: 260, slamMs: 160, radiusPx: 450, damage: 70, knockback: 800, visualMs: 320, color: 0xa855f7 }, // E 紫
    whirl: { radiusPx: 200, durationMs: 3000, tickMs: 200, damagePerHit: 22, knockback: 0, color: 0x00e5ff }, // A 青 DOT
    thunder: { orbitRadiusPx: 120, strikes: 6, strikeRadiusPx: 90, damage: 80, knockback: 260, strikeDelayMs: 110, chargeMs: 350, color: 0xffd700 }, // B 金
    iai: { distancePx: 1300, speedPxPerSec: 2600, windupMs: 160, hitRadiusPx: 55, damage: 120, knockback: 420, passes: 2, sampleStepPx: 40, color: 0xff4d6d }, // C 紅（來回2趟）
    flame: {
      windupMs: 220, sprayMs: 480, color: 0xff7a1a, // F 橙紅
      flameLengthPx: 340, flameWidthPx: 150, burstDamage: 60, burstKnockback: 200,
      burnLengthPx: 300, burnWidthPx: 150, burnStartPx: 40, burnDurationMs: 2000, burnTickMs: 400, burnTickDamage: 22,
    },
  },
};
