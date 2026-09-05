import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/**
 * TicketSystem — 彩票帳本（多人遷移 S5：per-player keying，決策 76f07f64）。
 *
 * 純帳本：addTickets(playerId, n) / getTickets(playerId)。每玩家各自一本（用戶要各自）。
 * 產票歸屬：COMBO 結算灌 settle 的那個 player；寶盒抽中灌開箱的 player；JP 平分均分各 active player。
 * RTP / 機率 / 出票控制 = 之後另一獨立系統（讀/消費本帳本，不烤進來）。
 */
export class TicketSystem implements GameSystem {
  readonly name = 'TicketSystem';

  private tickets = new Map<number, number>();

  init(_ctx: GameContext): void {
    this.tickets.clear();
  }

  update(_dt: number): void {
    // 純計數器，無每幀邏輯。
  }

  /** 增加某玩家彩票（COMBO/寶盒/JP 灌入）。 */
  addTickets(playerId: number, n: number): void {
    if (n <= 0) return;
    this.tickets.set(playerId, (this.tickets.get(playerId) ?? 0) + n);
  }

  /** 某玩家彩票數（UI 讀）。 */
  getTickets(playerId: number): number {
    return this.tickets.get(playerId) ?? 0;
  }
}
