import {
  COIN_INSERT_AMOUNT,
  CREDIT_PER_HIT,
  OUT_OF_CREDIT_COUNTDOWN,
  STARTING_CREDIT,
} from '@/config/creditConfig';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/** 單一玩家的 Credit 狀態。 */
interface CreditState {
  credit: number;
  outOfCredit: boolean;
  countdown: number;
}

/**
 * CreditSystem — Credit（投幣/命）資源 + 耗盡狀態（多人遷移 S3：per-player keying）。
 *
 * 每玩家一份 CreditState（Map<playerId>）。S3 仍只有 P1（id=0），Map 一筆＝退化成舊單一 state，
 * 行為逐項同舊。公開 API 加 playerId 參數；讀取端傳 ctx.player.playerId（=0）。
 */
export class CreditSystem implements GameSystem {
  readonly name = 'CreditSystem';
  private ctx!: GameContext;

  private states = new Map<number, CreditState>();

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.states.clear();
  }

  /** 取得（或惰性建立）某玩家的 Credit 狀態，初始 = 起始值。 */
  private stateOf(playerId: number): CreditState {
    let s = this.states.get(playerId);
    if (!s) {
      s = { credit: STARTING_CREDIT, outOfCredit: false, countdown: 0 };
      this.states.set(playerId, s);
    }
    return s;
  }

  update(dt: number): void {
    // S3：只處理 P1（本地玩家）。投幣（C 鍵）：+100，若耗盡則解除。
    const p1 = this.ctx.player.playerId;
    if (this.ctx.input.justPressedCoin()) {
      this.addCredit(p1, COIN_INSERT_AMOUNT);
    }
    const s = this.stateOf(p1);
    if (s.outOfCredit) {
      s.countdown -= dt;
      const blink = Math.floor(s.countdown / 0.25) % 2 === 0;
      this.ctx.player.setOutOfCreditTint(blink);
      if (s.countdown <= 0) {
        this.resetCredit(p1);
      }
    }
  }

  /** 命中結算時呼叫：扣 CREDIT_PER_HIT；歸 0 進耗盡狀態。 */
  consumeOnHit(playerId: number): void {
    const s = this.stateOf(playerId);
    if (s.outOfCredit) return;
    s.credit = Math.max(0, s.credit - CREDIT_PER_HIT);
    if (s.credit <= 0) {
      s.outOfCredit = true;
      s.countdown = OUT_OF_CREDIT_COUNTDOWN;
    }
  }

  /** 投幣：增加 Credit；若在耗盡狀態且 credit>0 → 解除耗盡。 */
  addCredit(playerId: number, amount: number): void {
    const s = this.stateOf(playerId);
    s.credit += amount;
    if (s.outOfCredit && s.credit > 0) {
      this.exitOutOfCredit(playerId);
    }
  }

  /** 閘門：某玩家目前能否攻擊（credit>0 且非耗盡）。 */
  canAttack(playerId: number): boolean {
    const s = this.stateOf(playerId);
    return !s.outOfCredit && s.credit > 0;
  }

  /** 閘門：某玩家目前能否行動（移動）。耗盡狀態不能動。 */
  canAct(playerId: number): boolean {
    return !this.stateOf(playerId).outOfCredit;
  }

  private exitOutOfCredit(playerId: number): void {
    const s = this.stateOf(playerId);
    s.outOfCredit = false;
    s.countdown = 0;
    this.ctx.player.setOutOfCreditTint(false);
  }

  /** 倒數到 0 的 H5 簡化處理：重置到起始值並解除耗盡。 */
  private resetCredit(playerId: number): void {
    const s = this.stateOf(playerId);
    s.credit = STARTING_CREDIT;
    this.exitOutOfCredit(playerId);
  }

  // --- UI / 狀態查詢 ---
  getCredit(playerId: number): number {
    return this.stateOf(playerId).credit;
  }

  isOutOfCredit(playerId: number): boolean {
    return this.stateOf(playerId).outOfCredit;
  }

  getCountdown(playerId: number): number {
    const s = this.stateOf(playerId);
    return s.outOfCredit ? Math.max(0, s.countdown) : 0;
  }
}
