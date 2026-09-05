/**
 * entranceMath — 進場跳躍（JumpToField）純數學。對應 Unity PlayerController.JumpToField。
 * 分離出純函式方便單元測試與壞版必紅（拋物線/落點/lerp）。
 */
import { PPU } from '@/config/gameConfig';

/** 進場跳躍參數（對照 Unity ×PPU）。 */
export const ENTRANCE = {
  jumpHeightPx: 2 * PPU, // 200（jumpHeight=2 unit）
  durationSec: 0.6, // duration=0.6s
  landingSpacingPx: 1.5 * PPU, // 150（landingSpacing=1.5 unit）
} as const;

/**
 * 落點水平位置：endPos.x = (playerId - 1.5) × spacing + centerX。
 * 對應 Unity ((playerIndex - 1.5) × landingSpacing)，四人分散不疊中央：
 * P0→-2.25、P1→-0.75、P2→0.75、P3→2.25 unit（×PPU）再加畫面中心。
 */
export function landingX(
  playerId: number,
  centerX: number,
  spacing: number = ENTRANCE.landingSpacingPx,
): number {
  return (playerId - 1.5) * spacing + centerX;
}

/**
 * 垂直拋物線高度（往上的位移量，px）：height = jumpHeight × 4 × t × (1-t)。
 * t∈[0,1]：t=0/1 高度 0（起跳/落地），t=0.5 最高（= jumpHeight）。
 */
export function parabolaHeight(t: number, jumpHeightPx: number = ENTRANCE.jumpHeightPx): number {
  return jumpHeightPx * 4 * t * (1 - t);
}

/** 線性插值。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 求進場第 t（0..1）幀的位置。
 * 水平：lerp(start→end)；垂直：lerp 基線再「往上」減拋物線高度（H5 Y 下為正，往上=減）。
 */
export function entrancePosition(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  t: number,
  jumpHeightPx: number = ENTRANCE.jumpHeightPx,
): { x: number; y: number } {
  const baseY = lerp(startY, endY, t);
  return {
    x: lerp(startX, endX, t),
    y: baseY - parabolaHeight(t, jumpHeightPx), // 往上跳（減）
  };
}
