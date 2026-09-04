import {
  COMBO_MAX_COUNT,
  COMBO_WARNING_TIME,
  comboTimeoutFor,
  ticketsForCombo,
} from '@/config/comboConfig';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/**
 * ComboSystem — COMBO 連段（對照 Unity）。
 *
 * 累積：每次攻擊命中 +1（普攻/招式/衝刺，由 PlayerControl 呼叫 onHit()；耗盡狀態不累積）。
 * 計時窗（越連越短）：每命中重設 comboTimer = max(0.5, 3 - count×0.1)。
 * 警告：comboTimer < 2s → isWarning()（UI 閃爍）。
 * 超時（comboTimer≤0）：結算彩票 ceil(count×0.5) → ticket.addTickets → count=0、隱藏。
 * 滿檔（count≥100）：強制結算 ceil(100×0.5)=50 + MAX → count=0。
 * 凍結：過場/無戰鬥時暫停倒數（近似：場上無敵人時凍結，不倒數、不警告）。
 */
export class ComboSystem implements GameSystem {
  readonly name = 'ComboSystem';
  private ctx!: GameContext;

  private count = 0;
  private timer = 0;
  /** 最近一次是否觸發 MAX（給 UI 顯示 "MAX!"，讀取後由 UI 自行淡出）。 */
  private maxTriggered = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  update(dt: number): void {
    if (this.count <= 0) return;
    if (this.isFrozen()) return; // 過場/無戰鬥凍結：不倒數、不警告
    this.timer -= dt;
    if (this.timer <= 0) {
      this.settle();
    }
  }

  /** 命中累積：+1，重設計時窗。耗盡狀態不累積。滿檔強制結算。 */
  onHit(): void {
    if (this.ctx.credit.isOutOfCredit()) return; // 耗盡不累積
    this.count += 1;
    this.timer = comboTimeoutFor(this.count);
    if (this.count >= COMBO_MAX_COUNT) {
      this.settle(true);
    }
  }

  /** 結算：算彩票灌入 TicketSystem、歸零。 */
  private settle(isMax = false): void {
    if (this.count <= 0) return;
    const tickets = ticketsForCombo(this.count);
    this.ctx.ticket.addTickets(tickets);
    if (isMax) this.maxTriggered = true;
    this.count = 0;
    this.timer = 0;
  }

  /** 凍結判斷：過場/無戰鬥。近似＝場上無敵人（之後可對齊 WaveSystem 節點狀態）。 */
  private isFrozen(): boolean {
    return this.ctx.getEnemies().length === 0;
  }

  // --- UI / 狀態查詢 ---
  /** 目前連段數。 */
  getCombo(): number {
    return this.count;
  }

  /** 是否在警告窗（計時窗剩餘 < 2s 且非凍結、連段中）。 */
  isWarning(): boolean {
    return this.count > 0 && !this.isFrozen() && this.timer < COMBO_WARNING_TIME;
  }

  /** 讀取並清除 MAX 觸發旗標（UI 顯示 "MAX!" 用）。 */
  consumeMaxTriggered(): boolean {
    const v = this.maxTriggered;
    this.maxTriggered = false;
    return v;
  }
}
