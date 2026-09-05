/**
 * fireRainMath — 天降火雨純邏輯（#10，對應 Unity WaveModifierRunner FireRain / FireRainPreset）。
 * 落點選擇（縮邊/不重疊/上限）+ 傷害判定（圈內玩家）抽純函式，可測。
 * ⚠️ 只傷玩家（不傷敵人/守護雕像，呼應 Unity OverlapCircle 只 PlayerLayer）。
 */
import { PPU } from '@/config/gameConfig';
import { MAP_BOUNDS, insetBounds } from '@/config/mapConfig';
import type { Vec2 } from '@/systems/hitDetection';

/** 火雨預設（對應 Unity FireRainPreset 內建值，unit×PPU 換 px）。 */
export const FIRE_RAIN = {
  intervalSec: 1.5, // 每 1.5s 齊落一批
  radiusPx: 1.0 * PPU, // 100（火柱範圍半徑；預警圈直徑 = radius×2 = 200）
  warningSec: 1.0, // 預警紅圈停留 1s 才落下
  damage: 1, // 只傷玩家、damage 1、不擊退
  maxConcurrent: 3, // 同時在途火雨上限
  burstCount: 1, // 每批齊落幾道
  edgeMarginPx: 0, // 縮邊額外距離（預設 0）
} as const;

/**
 * 隨機挑一個火雨落點：縮邊（整個火柱圈都在場地內）+ 與 activePoints 保持 ≥ radius×2（不重疊）
 * + 若在途數 >= maxConcurrent 則回 null（額度滿）。純函式：rng 由呼叫端注入（可測定）。
 * @param activePoints 進行中火雨落點。
 * @param rng 回 [0,1) 的隨機源（測試可注入固定值）。
 * @returns 落點，或 null（額度滿/多次嘗試都太近）。
 */
export function pickFireRainPoint(
  activePoints: readonly Vec2[],
  rng: () => number,
  radiusPx: number = FIRE_RAIN.radiusPx,
  edgeMarginPx: number = FIRE_RAIN.edgeMarginPx,
  maxConcurrent: number = FIRE_RAIN.maxConcurrent,
): Vec2 | null {
  if (activePoints.length >= maxConcurrent) return null; // 額度滿
  // 縮邊：inset = radius + edgeMargin，火柱圈整個在場地內。
  const b = insetBounds(MAP_BOUNDS, radiusPx + edgeMarginPx);
  const minSep = radiusPx * 2; // 不重疊：彼此至少 2r
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const x = b.minX + rng() * (b.maxX - b.minX);
    const y = b.minY + rng() * (b.maxY - b.minY);
    const tooClose = activePoints.some(
      (p) => Math.hypot(p.x - x, p.y - y) < minSep,
    );
    if (!tooClose) return { x, y };
  }
  return null; // 多次都太近 → 這批放棄（不硬塞重疊）
}

/**
 * 火柱落下傷害判定：回落在圈內（dist <= radius）的玩家 index 清單。只傷玩家。
 * @param strikeCenter 火柱中心。
 * @param players 玩家中心座標清單。
 */
export function playersInStrike(
  strikeCenter: Vec2,
  players: readonly Vec2[],
  radiusPx: number = FIRE_RAIN.radiusPx,
): number[] {
  const hit: number[] = [];
  for (let i = 0; i < players.length; i += 1) {
    const p = players[i];
    if (Math.hypot(p.x - strikeCenter.x, p.y - strikeCenter.y) <= radiusPx) hit.push(i);
  }
  return hit;
}
