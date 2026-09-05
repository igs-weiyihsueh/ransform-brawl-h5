import {
  CREDIT_PER_COIN,
  JP_BOSS_GATED,
  JP_GROUP_CONFIG,
  JP_GROUPS,
  JP_LIGHTS_TO_TRIGGER,
  JP_TICKET_FACE,
  multiplierStepPerCoin,
  pickLightGroup,
  type JpGroup,
} from '@/config/jpConfig';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

interface JpGroupState {
  lights: number;
  multiplier: number;
}

/**
 * JpSystem — JP 累積獎池（三組紅/藍/紫，零式定案 924a1d83）。
 *
 * 燈：每組 5 燈集滿觸發。每「幕通關」（WaveSystem.onStageClear，本關 nodes 全跑完）
 *     隨機給 1 組 +1 燈（三組均等 33.3%）。
 * 累積：三組各自倍數池，每「幣」(=CREDIT_PER_COIN 點 Credit 消耗) 累積 (avg-start)/450，
 *     clamp 到封頂。由 PlayerControl 每次扣 Credit 時 notifyCreditSpent(1) 換算。
 * 派彩：某組 5 燈集滿 → 獎金 = 當前倍數 × 30 張票面 → ctx.ticket.addTickets（JP 為 ticket
 *     的又一生產者，只呼叫 addTickets 不改帳本）→ 該組倍數歸零重累積、燈歸零。
 * BOSS：規格「集滿→打BOSS→贏才給」，H5 無 BOSS，JP_BOSS_GATED=false 先直接派彩。
 */
export class JpSystem implements GameSystem {
  readonly name = 'JpSystem';
  private ctx!: GameContext;

  private groups: Record<JpGroup, JpGroupState> = {
    red: { lights: 0, multiplier: JP_GROUP_CONFIG.red.startMultiplier },
    blue: { lights: 0, multiplier: JP_GROUP_CONFIG.blue.startMultiplier },
    purple: { lights: 0, multiplier: JP_GROUP_CONFIG.purple.startMultiplier },
  };

  /** 累計消耗的 Credit（換算幣數用）。 */
  private creditSpentAccum = 0;
  private lastPayout = '';

  /** per-player 傷害貢獻累進（S5 加權派彩用；S3 只記不用）。 */
  private damageByPlayer = new Map<number, number>();

  init(ctx: GameContext): void {
    this.ctx = ctx;
    // 接一幕通關事件：隨機給一組 +1 燈。
    this.ctx.wave.onStageClear = () => this.onStageClear();
  }

  update(_dt: number): void {
    // 累積由 notifyCreditSpent 驅動；燈由 onStageClear 驅動。此處無每幀邏輯。
  }

  /**
   * PlayerControl 每次扣 Credit（命中）時呼叫，帶扣掉的 Credit 量（通常 1）。
   * 換算成幣（/CREDIT_PER_COIN）累積各組倍數。
   */
  notifyCreditSpent(creditAmount: number): void {
    if (creditAmount <= 0) return;
    this.creditSpentAccum += creditAmount;
    const coins = creditAmount / CREDIT_PER_COIN;
    for (const g of JP_GROUPS) {
      const cfg = JP_GROUP_CONFIG[g];
      const st = this.groups[g];
      st.multiplier = Math.min(cfg.capMultiplier, st.multiplier + multiplierStepPerCoin(g) * coins);
    }
  }

  /**
   * per-player 傷害貢獻 hook：累進該玩家對所有命中敵人打出的傷害總和。
   * 🔴 與 notifyCreditSpent（共享池、不加 playerId）分開：這裡是「記誰貢獻」。
   * 🔴 加權派彩（讀 recordDamage 依貢獻分配）= 之後另一個任務；**S5 派彩為平分、不讀 recordDamage**。
   *    recordDamage 為未來加權派彩埋，目前 inert（只記不影響派彩）。
   */
  recordDamage(attackerId: number, dealt: number): void {
    if (dealt <= 0) return;
    this.damageByPlayer.set(attackerId, (this.damageByPlayer.get(attackerId) ?? 0) + dealt);
  }

  /** 某玩家累計貢獻傷害（S5 加權派彩讀；S3 debug 可看）。 */
  getDamageContribution(attackerId: number): number {
    return this.damageByPlayer.get(attackerId) ?? 0;
  }

  /** 一幕通關：隨機給一組 +1 燈；集滿觸發派彩。 */
  private onStageClear(): void {
    const g = pickLightGroup();
    const st = this.groups[g];
    st.lights += 1;
    if (st.lights >= JP_LIGHTS_TO_TRIGGER) {
      this.trigger(g);
    }
  }

  /** 觸發某組：BOSS 閘門（H5 先直接派彩）→ 派彩 → 歸零重累積。 */
  private trigger(g: JpGroup): void {
    if (JP_BOSS_GATED) {
      // 之後 B 段做 BOSS：集滿→打BOSS→贏才 payout。目前 gated=false 不會走這。
      return;
    }
    this.payout(g);
  }

  /**
   * 派彩：獎金 = 當前倍數 × 30 張 → **平分**給所有 active player 的彩票帳本；該組歸零重累積、燈歸零。
   * 🔴 S5 = 平分（用戶裁示：貢獻加權延後、先簡單）。不管誰貢獻、不讀 recordDamage。
   *    加權派彩（依 recordDamage 貢獻分配）= 之後另一個任務，非 S5。
   */
  private payout(g: JpGroup): void {
    const st = this.groups[g];
    const prize = Math.round(st.multiplier * JP_TICKET_FACE);
    const players = this.ctx.players;
    const share = Math.floor(prize / Math.max(1, players.length)); // 平分（取整）
    for (const p of players) {
      this.ctx.ticket.addTickets(p.playerId, share);
    }
    this.lastPayout = `${g}:${prize}(平分${players.length}人×${share})`;
    st.multiplier = JP_GROUP_CONFIG[g].startMultiplier;
    st.lights = 0;
  }

  // --- UI / 狀態查詢 ---
  getLights(g: JpGroup): number {
    return this.groups[g].lights;
  }

  getMultiplier(g: JpGroup): number {
    return this.groups[g].multiplier;
  }

  getLastPayout(): string {
    return this.lastPayout;
  }
}
