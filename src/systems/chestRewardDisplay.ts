/**
 * chestRewardDisplay — 開箱報獎表演的純呈現邏輯（第5項）。
 * 把 reward → 報獎文字 抽成純函式方便測試。⚠️ 純視覺；不涉及 chest 數值。
 */
import type { ChestRewardKind } from '@/config/chestConfig';

/** 開箱報獎飄字時長/位移（純視覺參數）。 */
export const CHEST_REWARD_FX = {
  /** 報獎飄字持續秒數。 */
  durationSec: 1.0,
  /** 飄字往上位移(px)。 */
  risePx: 80,
  /** 寶盒發光/彈跳脈動峰值 scale。 */
  pulseScale: 1.5,
  pulseSec: 0.35,
} as const;

/**
 * 依獎勵種類回報獎顯示文字。
 * 彩票類 → 「+N」；坐騎 → 「坐騎!」；二段變身 → 「二段變身!」。
 */
export function chestRewardLabel(kind: ChestRewardKind, tickets: number): string {
  switch (kind) {
    case 'ticketSmall':
    case 'ticketMedium':
    case 'ticketLarge':
      return `+${tickets}`;
    case 'mount':
      return '坐騎!';
    case 'secondTransform':
      return '二段變身!';
    default:
      return '';
  }
}

/** 報獎文字顏色：彩票用金色、效果類用該玩家識別色點綴。 */
export function chestRewardIsTicket(kind: ChestRewardKind): boolean {
  return kind === 'ticketSmall' || kind === 'ticketMedium' || kind === 'ticketLarge';
}
