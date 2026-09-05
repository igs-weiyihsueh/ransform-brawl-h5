/**
 * playerConfig — 玩家識別色 + 腳下真空環（搜索圈）設定。
 *
 * 真空環對應 Unity PlayerController FootGlow / 真空吸取範圍圈。
 * 數值以 Unity unit 標註、×PPU(100) 換 px（跟 mapConfig 同模式，方便對照 Unity 調整）。
 */
import { PPU } from '@/config/gameConfig';
import { SPRITE_SCALE } from '@/config/combatConfig';

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

/** 待機台座/角色相對待機點（下方面板欄）往上抬的像素，讓台座露在面板頂緣之上、角色站台座頂面。 */
export const WAITING_PLATFORM_LIFT = 40;

/**
 * 真空環（搜索圈）設定。對照 Unity：
 * - vacuumRadius = 0.5 unit → 50px（環半徑 = 吸取範圍）
 * - ringWidth = 0.05 unit → 5px（環線寬）
 * - footGlowAlpha = 0.5（半透明）
 * - sortingOrder = -10 → depth 低於角色 sprite，壓在腳下不擋角色
 *
 * ⚠️ offset（#6 修）：H5 CharacterAnimator sprite origin=(0.5,0.5)=256畫布中心，
 * 但角色美術在畫布內非置中（實測 Human idle：opaque bbox x[61-172] 中心≈116、腳底 y≈200；
 * 畫布中心=128）。所以 sprite.x/y（畫布中心）≠ 角色視覺中心/腳部：
 *   - 水平：美術中心 x≈116 比畫布中心 128 偏左 ~12px（未乘 scale）→ 環要往左修，否則偏右（用戶回報）。
 *   - 垂直：腳底 y≈200 比畫布中心 128 偏下 ~72px → 環要往下到腳部。
 * offset 以「畫布 px × SPRITE_SCALE」換成顯示 px。Unity 的 vacuumVisualOffsetY(-50 往上) 不適用
 * （那是腳底 pivot；H5 是畫布中心 pivot）。
 */
export const FOOT_GLOW = {
  radiusPx: 0.5 * PPU, // 50
  // 顯示偏移（畫布 px × SPRITE_SCALE(≈1.05)）：往左修美術偏移 + 往下到腳部。
  offsetXPx: -12 * SPRITE_SCALE, // ≈ -12.6：修正美術在畫布內偏左
  offsetYPx: 72 * SPRITE_SCALE, // ≈ 75.6：從畫布中心往下到腳底
  ringWidthPx: 0.05 * PPU, // 5
  alpha: 0.5,
  depth: -10,
} as const;

/**
 * 真空環中心座標（純函式，可測）：sprite 位置（origin=畫布中心）加校正 offset 到腳部視覺中心。
 * H5 Y 下為正 → offsetY 正值往下到腳部；offsetX 負值往左修美術在畫布內的偏移。
 */
export function footGlowCenter(
  spriteX: number,
  spriteY: number,
  offsetX: number = FOOT_GLOW.offsetXPx,
  offsetY: number = FOOT_GLOW.offsetYPx,
): { x: number; y: number } {
  return { x: spriteX + offsetX, y: spriteY + offsetY };
}
