/**
 * towerConfig — 魔尖塔 preset 表（2 新事件重構：魔尖塔=單獨波次，比照 guardConfig）。
 *
 * 魔尖塔是「單獨波次」（用戶分類）：Event 節點的 eventPresetName 填 tower preset 名（如 Tower4）
 * → 該 Event 節點觸發魔尖塔波（跟守護波 Guard60 完全同模式，非 eventType 子類型、非新 nodeType）。
 * 生成 N 座尖塔、限時內全打完＝過關 / 限時到＝失敗但不 GameOver 進下關。尖塔可額外附加火雨/地雷。
 * 尖塔怪 entity / 環狀技依序固定環執行期＝game-side（征騎，讀 ringSkill）；勝敗判定＝WaveSystem（走既有 advance）。
 */

/** 魔尖塔環狀技參數（對接征騎環狀技執行期算法；尖塔週期放同心環往外擴、命中扣玩家能量+麻痺）。 */
export interface RingSkillParams {
  /** 一次放幾層同心環（>=1 整數）。 */
  ringCount: number;
  /** 最內環半徑（像素；>=0）。 */
  baseRadiusPx: number;
  /** 每層環往外遞增半徑（像素/層；>=0）。第 i 環半徑 = baseRadiusPx + i*radiusStepPx。 */
  radiusStepPx: number;
  /** 每層環出現間隔秒（層與層之間；>0）。 */
  ringIntervalSec: number;
  /** 環厚度（像素，判定帶寬；征騎取半寬 ringThicknessPx/2；>0）。 */
  ringThicknessPx: number;
  /** 命中扣玩家能量段數（>=0）。 */
  energyCost: number;
  /**
   * C9：環真正炸出前先顯示紅色預警圈這麼久（秒；>=0）。節奏（執行期征騎做）：
   * 預警紅圈倒數 warningSec → 完才判定命中+炸特效 → 炸完才開下一環紅圈。省略/0＝無預警立即判定。
   */
  warningSec: number;
}

/** 一座塔的位置（場景座標，1920×1080 基準；editor 可拖曳編輯）。 */
export interface TowerPosition {
  x: number;
  y: number;
}

/** 一組魔尖塔參數。 */
export interface TowerPreset {
  /** 尖塔數（>=1 整數）。 */
  towerCount: number;
  /** 限時秒數（限時內打完全部尖塔過關；>0）。 */
  timeLimitSec: number;
  /** 每座尖塔血量（>0）。 */
  towerHp: number;
  /**
   * A3：塔 sprite 縮放倍率（>0，1＝原尺寸）。game-side 征騎照吃設塔 sprite scale。省略＝1（原尺寸）。
   */
  towerScale?: number;
  /**
   * A2：每座塔的位置（場景座標，1920×1080 基準；editor 可滑鼠拖曳編輯疊在場景底圖上）。
   * 省略／長度不足 towerCount → game-side 用預設環形/散佈補足。長度可 != towerCount（前 N 座用設定、其餘預設）。
   */
  positions?: TowerPosition[];
  /** 環狀技參數（尖塔週期放的環狀攻擊；征騎執行期照吃）。 */
  ringSkill: RingSkillParams;
}

/** 魔尖塔 preset 表（名稱 key；用戶可在事件編輯器選/編）。Tower4=四塔預設、Tower6=六塔。 */
export const TOWER_PRESETS: Record<string, TowerPreset> = {
  Tower4: {
    towerCount: 4,
    timeLimitSec: 60,
    towerHp: 100,
    ringSkill: { ringCount: 3, baseRadiusPx: 60, radiusStepPx: 40, ringIntervalSec: 0.6, ringThicknessPx: 20, energyCost: 2, warningSec: 0.5 },
  },
  Tower6: {
    towerCount: 6,
    timeLimitSec: 75,
    towerHp: 100,
    ringSkill: { ringCount: 3, baseRadiusPx: 60, radiusStepPx: 40, ringIntervalSec: 0.6, ringThicknessPx: 20, energyCost: 2, warningSec: 0.5 },
  },
};

/** 內建 fallback（查無魔尖塔 preset 時用，不炸）。 */
export const TOWER_FALLBACK: TowerPreset = TOWER_PRESETS.Tower4;

/**
 * name 是否為（打包）魔尖塔 preset（config 層純函式，不含 override）。
 * ★消費端請用 towerSchema.isResolvedTowerPreset（override-aware）。
 */
export function isTowerPreset(name: string | undefined): boolean {
  return !!name && name in TOWER_PRESETS;
}

/** 依名稱取（打包）魔尖塔 preset（查無回 fallback，不炸）。★消費端請用 towerSchema.getResolvedTowerPreset。 */
export function getTowerPreset(name: string | undefined): TowerPreset {
  return (name && TOWER_PRESETS[name]) || TOWER_FALLBACK;
}
