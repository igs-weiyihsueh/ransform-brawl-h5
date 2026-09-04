import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/**
 * TicketSystem — 彩票計數器（A#2 基本版）。
 *
 * 這批只做「累積 + 顯示」：addTickets(n) / getTickets()，由 COMBO 結算灌入、UI 讀取。
 * RTP / 機率 / 出票控制 / 寶盒（零式的數學）之後 A#3/A#4 再疊上。
 */
export class TicketSystem implements GameSystem {
  readonly name = 'TicketSystem';

  private tickets = 0;

  init(_ctx: GameContext): void {
    // 無需初始化。
  }

  update(_dt: number): void {
    // 純計數器，無每幀邏輯。
  }

  /** 增加彩票（COMBO 結算呼叫）。 */
  addTickets(n: number): void {
    if (n <= 0) return;
    this.tickets += n;
  }

  /** 目前彩票數（UI 讀）。 */
  getTickets(): number {
    return this.tickets;
  }
}
