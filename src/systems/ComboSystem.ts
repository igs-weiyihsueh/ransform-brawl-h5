import {
  COMBO_MAX_COUNT,
  COMBO_WARNING_TIME,
  comboTimeoutFor,
  ticketsForCombo,
} from '@/config/comboConfig';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/** 單一玩家的 COMBO 狀態。 */
interface ComboState {
  count: number;
  timer: number;
  maxTriggered: boolean;
}

/**
 * ComboSystem — COMBO 連段（多人遷移 S3：per-player keying）。
 *
 * 每玩家一份 ComboState（Map<playerId>）。S3 仍只有 P1（id=0），Map 一筆＝退化成舊單一 state。
 * 公開 API 加 playerId；讀取端傳 ctx.player.playerId。凍結判斷用全域場上敵人（共享）。
 */
export class ComboSystem implements GameSystem {
  readonly name = 'ComboSystem';
  private ctx!: GameContext;

  private states = new Map<number, ComboState>();

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.states.clear();
  }

  private stateOf(playerId: number): ComboState {
    let s = this.states.get(playerId);
    if (!s) {
      s = { count: 0, timer: 0, maxTriggered: false };
      this.states.set(playerId, s);
    }
    return s;
  }

  update(dt: number): void {
    if (this.isFrozen()) return; // 過場/無戰鬥凍結：不倒數、不警告（全域）
    for (const [playerId, s] of this.states) {
      if (s.count <= 0) continue;
      s.timer -= dt;
      if (s.timer <= 0) this.settle(playerId);
    }
  }

  /** 命中累積：+1，重設計時窗。耗盡狀態不累積。滿檔強制結算。 */
  onHit(playerId: number): void {
    if (this.ctx.credit.isOutOfCredit(playerId)) return; // 耗盡不累積
    const s = this.stateOf(playerId);
    s.count += 1;
    s.timer = comboTimeoutFor(s.count);
    if (s.count >= COMBO_MAX_COUNT) {
      this.settle(playerId, true);
    }
  }

  /** 結算：算彩票灌入 settle 的那個 player 帳本、歸零。 */
  private settle(playerId: number, isMax = false): void {
    const s = this.stateOf(playerId);
    if (s.count <= 0) return;
    const tickets = ticketsForCombo(s.count);
    this.ctx.ticket.addTickets(playerId, tickets); // 產票歸屬：settle 的 player
    if (isMax) s.maxTriggered = true;
    s.count = 0;
    s.timer = 0;
  }

  /** 凍結判斷：過場/無戰鬥。近似＝場上無敵人（全域共享）。 */
  private isFrozen(): boolean {
    return this.ctx.getEnemies().length === 0;
  }

  // --- UI / 狀態查詢 ---
  getCombo(playerId: number): number {
    return this.stateOf(playerId).count;
  }

  isWarning(playerId: number): boolean {
    const s = this.stateOf(playerId);
    return s.count > 0 && !this.isFrozen() && s.timer < COMBO_WARNING_TIME;
  }

  consumeMaxTriggered(playerId: number): boolean {
    const s = this.stateOf(playerId);
    const v = s.maxTriggered;
    s.maxTriggered = false;
    return v;
  }
}
