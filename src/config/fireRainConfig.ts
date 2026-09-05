/**
 * fireRainConfig — 火雨 preset 表（用戶試玩#4，照 guardConfig preset 模式，不動凍結 levelSchema）。
 *
 * Event 節點的 eventPresetName 除了守護 preset（Guard60…），也可填火雨 preset 名（FireRain…）
 * → 該 Event 節點觸發火雨（純火雨波）。守護 preset 另可帶 attachFireRain 旗標（=守護+火雨）。
 * schema 結構不變（EventNodeData 仍只有 nodeType+eventPresetName），火雨參數全在此 preset 表。
 */
import { PPU } from '@/config/gameConfig';

/** 一組火雨參數（對應 Unity FireRainPreset；px 已換算）。 */
export interface FireRainPreset {
  /** 每批齊落間隔（秒）。 */
  intervalSec: number;
  /** 火柱範圍半徑（像素；預警圈直徑=radius×2）。 */
  radiusPx: number;
  /** 預警停留（秒）才落下。 */
  warningSec: number;
  /** 傷害（只傷玩家、不擊退）。 */
  damage: number;
  /** 同時在途火雨上限。 */
  maxConcurrent: number;
  /** 每批齊落幾道。 */
  burstCount: number;
  /** 縮邊額外距離（像素）。 */
  edgeMarginPx: number;
  /** 純火雨 Event 節點的持續時間（秒）；撐過即節點完成前進（守護+火雨時不用此，跟著守護時長）。 */
  durationSec: number;
}

/** 火雨 preset 表（名稱 key；用戶可在編輯器選）。FireRain=標準（對齊舊 FIRE_RAIN 值）。 */
export const FIRE_RAIN_PRESETS: Record<string, FireRainPreset> = {
  FireRain: {
    intervalSec: 1.5,
    radiusPx: 1.0 * PPU,
    warningSec: 1.0,
    damage: 1,
    maxConcurrent: 3,
    burstCount: 1,
    edgeMarginPx: 0,
    durationSec: 20,
  },
  FireRainLight: {
    intervalSec: 2.2,
    radiusPx: 0.9 * PPU,
    warningSec: 1.3,
    damage: 1,
    maxConcurrent: 2,
    burstCount: 1,
    edgeMarginPx: 0,
    durationSec: 15,
  },
  FireRainHeavy: {
    intervalSec: 1.0,
    radiusPx: 1.1 * PPU,
    warningSec: 0.8,
    damage: 1,
    maxConcurrent: 5,
    burstCount: 2,
    edgeMarginPx: 0,
    durationSec: 25,
  },
};

/** 內建 fallback（查無火雨 preset 時用，不炸）。 */
export const FIRE_RAIN_FALLBACK: FireRainPreset = FIRE_RAIN_PRESETS.FireRain;

/** eventPresetName 是否為火雨 preset（純函式，供 FireRainSystem/編輯器判斷）。 */
export function isFireRainPreset(name: string | undefined): boolean {
  return !!name && name in FIRE_RAIN_PRESETS;
}

/** 依名稱取火雨 preset（查無回 fallback）。 */
export function getFireRainPreset(name: string | undefined): FireRainPreset {
  return (name && FIRE_RAIN_PRESETS[name]) || FIRE_RAIN_FALLBACK;
}

/**
 * 決定某 Event 節點該用哪組火雨參數（純函式，抽給測騎）：
 * - eventPresetName 是火雨 preset → 該火雨 preset（純火雨波）。
 * - 否則若守護 preset attachFireRain=true → 標準 FireRain（守護+火雨）。
 * - 否則 → null（純守護，不觸發火雨）。
 * @param eventPresetName Event 節點 preset 名。
 * @param guardAttachFireRain 當前為守護 preset 時，其 attachFireRain 旗標。
 */
export function resolveFireRainForEvent(
  eventPresetName: string | undefined,
  guardAttachFireRain: boolean,
): FireRainPreset | null {
  if (isFireRainPreset(eventPresetName)) return getFireRainPreset(eventPresetName);
  if (guardAttachFireRain) return FIRE_RAIN_PRESETS.FireRain;
  return null;
}
