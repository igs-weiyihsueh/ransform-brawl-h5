/**
 * mineConfig — 地雷陷阱 preset 表（2 新事件重構：地雷=附加類，比照 fireRainConfig）。
 *
 * 地雷是「附加類」（用戶分類）：Spawn 刷怪波節點 / 單獨事件節點（守護/魔尖塔）可帶 attachMineTrap（地雷 preset 名）
 * → 該波次/事件進行時全場自動撒地雷（比照 attachFireRain）。地雷參數全在此 preset 表（事件編輯器可編）。
 * 撒點/佈雷/延遲爆/麻痺＝game-side MineSystem（讀取式，比照 FireRainSystem 自撒 pickFireRainPoint）。
 */

/** 一組地雷參數（踩雷式：撒在場上不倒數，玩家踩到才觸發倒數→爆；場上維持一定數量）。 */
export interface MinePreset {
  /** 初始撒幾顆地雷（>=1；game-side 用 pickFireRainPoint 全場隨機撒 count 顆）。 */
  count: number;
  /**
   * 場上維持的目標地雷數（>=1）。game-side 每幀檢查：場上存活地雷 < maintainCount → 補撒到此數。
   * 用戶：地雷少了要補撒、維持場上一定密度。通常 >= count（初始撒 count、之後維持 maintainCount）。
   */
  maintainCount: number;
  /**
   * per-mine 再生時間（秒；>=0）。用戶：每爆掉一顆地雷，隔此秒數補一顆回來（per-mine 再生節奏，
   * 非立即補、非批次）。game-side：一顆爆掉 → 起算此延遲 → 到期且場上存活數 < maintainCount 才補一顆。
   * 與 maintainCount 並存：respawnDelaySec=補的節奏、maintainCount=補到的目標上限。可在 preset 調。
   */
  respawnDelaySec: number;
  /** 爆炸半徑（像素；>=0）。 */
  radiusPx: number;
  /**
   * 觸發後倒數爆炸秒數（>=0）。踩雷式：地雷撒下不倒數，玩家進半徑「踩到」才啟動此倒數，
   * 期間顯閃爍預警圈（不顯數字），倒數完爆。可在 preset 調。
   */
  delaySec: number;
  /** 命中麻痺秒數（爆炸範圍內玩家+怪麻痺時長，不分敵我；>=0）。game-side applyStun。 */
  paralyzeSec: number;
  /** 縮邊額外距離（像素，撒點內縮避免貼邊；選填，省略＝0）。 */
  edgeMarginPx?: number;
}

/** 地雷 preset 表（名稱 key；用戶可在事件編輯器選/編）。Mine=標準、MineHeavy=密集多顆。 */
export const MINE_PRESETS: Record<string, MinePreset> = {
  Mine: {
    count: 8,
    maintainCount: 8,
    respawnDelaySec: 4,
    radiusPx: 120,
    delaySec: 3,
    paralyzeSec: 3,
    edgeMarginPx: 40,
  },
  MineHeavy: {
    count: 14,
    maintainCount: 14,
    respawnDelaySec: 3,
    radiusPx: 130,
    delaySec: 2.5,
    paralyzeSec: 3,
    edgeMarginPx: 40,
  },
};

/** 內建 fallback（查無地雷 preset 時用，不炸）。 */
export const MINE_FALLBACK: MinePreset = MINE_PRESETS.Mine;

/**
 * name 是否為（打包）地雷 preset（config 層純函式，不含 override）。
 * ★消費端請用 mineSchema.isResolvedMinePreset（override-aware）。
 */
export function isMinePreset(name: string | undefined): boolean {
  return !!name && name in MINE_PRESETS;
}

/** 依名稱取（打包）地雷 preset（查無回 fallback，不炸）。★消費端請用 mineSchema.getResolvedMinePreset。 */
export function getMinePreset(name: string | undefined): MinePreset {
  return (name && MINE_PRESETS[name]) || MINE_FALLBACK;
}
