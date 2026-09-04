import {
  COIN_INSERT_AMOUNT,
  CREDIT_PER_HIT,
  OUT_OF_CREDIT_COUNTDOWN,
  STARTING_CREDIT,
} from '@/config/creditConfig';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/**
 * CreditSystem — Credit（投幣/命）資源 + 耗盡狀態（對照 Unity）。
 *
 * 規則：
 *  - 每次攻擊命中扣 1（普攻/招式/衝刺，命中結算時由 PlayerControl 呼叫 consumeOnHit()；
 *    衝刺一次最多扣 1，由呼叫端保證）。注意與能量不同：能量只普攻命中充，Credit 所有命中都扣。
 *  - CanAttack 閘門：credit > 0 才能攻擊；耗盡狀態不能移動/攻擊。
 *  - 投幣（C 鍵）：addCredit(100)；若在耗盡狀態且 credit>0 → 解除。
 *  - 耗盡（歸 0）：進 out-of-credit 狀態，鎖移動/攻擊、角色閃紅、倒數 10s、隱藏 credit/能量顯示。
 *    倒數到 0：H5 無待機區，簡化為「重置 Credit 到起始值、解除耗盡」讓遊戲能繼續（不卡死）。
 */
export class CreditSystem implements GameSystem {
  readonly name = 'CreditSystem';
  private ctx!: GameContext;

  private credit = STARTING_CREDIT;
  private outOfCredit = false;
  private countdown = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.credit = STARTING_CREDIT;
    this.outOfCredit = false;
  }

  update(dt: number): void {
    // 投幣（C 鍵）：+100，若耗盡則解除。
    if (this.ctx.input.justPressedCoin()) {
      this.addCredit(COIN_INSERT_AMOUNT);
    }

    if (this.outOfCredit) {
      this.countdown -= dt;
      // 閃紅：以倒數相位切換紅 tint。
      const blink = Math.floor(this.countdown / 0.25) % 2 === 0;
      this.ctx.player.setOutOfCreditTint(blink);
      if (this.countdown <= 0) {
        // H5 簡化：倒數到 0 重置 Credit、解除耗盡（無待機區、不卡死）。
        this.resetCredit();
      }
    }
  }

  /** 命中結算時呼叫：扣 CREDIT_PER_HIT；歸 0 進耗盡狀態。 */
  consumeOnHit(): void {
    if (this.outOfCredit) return;
    this.credit = Math.max(0, this.credit - CREDIT_PER_HIT);
    if (this.credit <= 0) {
      this.enterOutOfCredit();
    }
  }

  /** 投幣：增加 Credit；若在耗盡狀態且 credit>0 → 解除耗盡。 */
  addCredit(amount: number): void {
    this.credit += amount;
    if (this.outOfCredit && this.credit > 0) {
      this.exitOutOfCredit();
    }
  }

  /** 閘門：目前能否攻擊（credit>0 且非耗盡）。 */
  canAttack(): boolean {
    return !this.outOfCredit && this.credit > 0;
  }

  /** 閘門：目前能否行動（移動）。耗盡狀態不能動。 */
  canAct(): boolean {
    return !this.outOfCredit;
  }

  private enterOutOfCredit(): void {
    this.outOfCredit = true;
    this.countdown = OUT_OF_CREDIT_COUNTDOWN;
  }

  private exitOutOfCredit(): void {
    this.outOfCredit = false;
    this.countdown = 0;
    this.ctx.player.setOutOfCreditTint(false);
  }

  /** 倒數到 0 的 H5 簡化處理：重置到起始值並解除耗盡。 */
  private resetCredit(): void {
    this.credit = STARTING_CREDIT;
    this.exitOutOfCredit();
  }

  // --- UI / 狀態查詢 ---
  getCredit(): number {
    return this.credit;
  }

  isOutOfCredit(): boolean {
    return this.outOfCredit;
  }

  /** 耗盡倒數剩餘秒數（UI 投幣提示可顯示）。 */
  getCountdown(): number {
    return this.outOfCredit ? Math.max(0, this.countdown) : 0;
  }
}
