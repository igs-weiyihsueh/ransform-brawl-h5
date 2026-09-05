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
 * 待機台座相對待機角色「中心」往下的像素偏移（用戶 #1：平台畫在角色腳下才看得見，非同中心被身體蓋住）。
 * 角色畫布 256、腳底約在中心下方 ~72px × SPRITE_SCALE(≈0.735) ≈ 53px，取 54 讓台座盤剛好露在腳底。
 */
export const PLATFORM_FEET_OFFSET = Math.round(72 * SPRITE_SCALE);

/**
 * 真空環（搜索圈）設定。對照 Unity：
 * - vacuumRadius = 0.5 unit → 50px（環半徑 = 吸取範圍）
 * - ringWidth = 0.05 unit → 5px（環線寬）
 * - footGlowAlpha = 0.5（半透明）
 * - sortingOrder = -10 → depth 低於角色 sprite，壓在腳下不擋角色
 *
 * ⚠️ offset（#6 修 → 用戶新#1 再修）：H5 CharacterAnimator sprite origin=(0.5,0.5)=256畫布中心。
 * 垂直：角色腳底 y≈200 比畫布中心 128 偏下 ~72px → 環往下到腳部（×SPRITE_SCALE 換顯示 px）。
 * 水平：**offsetX=0（環水平置中於 sprite）**。原本 -12 是對齊 opaque bbox 中心(≈116)，但那含不對稱四肢、
 * 且 sprite 面右時 setFlipX(true) 會水平翻轉美術 → 固定 -12 offset 不跟著翻 → 面右時環偏到另一側 ~25px
 * （用戶新#1「圈沒在角色正下方」真因）。角色身體/腳中線 ≈ 畫布中心，故 offsetX=0 讓環恆在角色正下方、
 * 且 flip-safe（面左面右都置中）。
 */
export const FOOT_GLOW = {
  radiusPx: 0.5 * PPU, // 50
  // 顯示偏移（畫布 px × SPRITE_SCALE(≈1.05)）：水平置中(0, flip-safe) + 往下到腳部。
  offsetXPx: 0, // 環水平置中於角色（不隨面向偏移；修用戶新#1 圈沒在正下方）
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
