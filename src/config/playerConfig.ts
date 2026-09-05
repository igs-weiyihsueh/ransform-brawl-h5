/**
 * playerConfig — 玩家識別色 + 腳下真空環（搜索圈）設定。
 *
 * 真空環對應 Unity PlayerController FootGlow / 真空吸取範圍圈。
 * 數值以 Unity unit 標註、×PPU(100) 換 px（跟 mapConfig 同模式，方便對照 Unity 調整）。
 */
import { PPU } from '@/config/gameConfig';

/**
 * 玩家識別色（P1~P4）。多人時每個 player 各自一色，用來分辨誰是誰 + 染腳下真空環。
 * 目前無現成調色盤 → 定這一組（藍/紅/綠/黃），供真空環與日後 per-player UI/名冊共用。
 */
export const PLAYER_COLORS: readonly number[] = [
  0x4fc3f7, // P1 藍
  0xef5350, // P2 紅
  0x66bb6a, // P3 綠
  0xffca28, // P4 黃
];

/** 取某 playerId 的識別色（超出 P4 循環）。 */
export function playerColor(playerId: number): number {
  return PLAYER_COLORS[playerId % PLAYER_COLORS.length];
}

/**
 * 真空環（搜索圈）設定。對照 Unity：
 * - vacuumRadius = 0.5 unit → 50px（環半徑 = 吸取範圍）
 * - vacuumVisualOffsetY = 0.5 unit → 50px（環中心從腳底 pivot 往上偏；H5 Y 下為正 → 往上 = 減 50）
 * - ringWidth = 0.05 unit → 5px（環線寬）
 * - footGlowAlpha = 0.5（半透明）
 * - sortingOrder = -10 → depth 低於角色 sprite，壓在腳下不擋角色
 */
export const FOOT_GLOW = {
  radiusPx: 0.5 * PPU, // 50
  offsetYPx: 0.5 * PPU, // 50（環中心 = 玩家 y - offsetYPx）
  ringWidthPx: 0.05 * PPU, // 5
  alpha: 0.5,
  depth: -10,
} as const;
