import { CHEST_OPEN_THRESHOLD } from '@/config/chestConfig';
import { BUFF_DURATION, BUFF_STAT } from '@/config/buffConfig';
import { isTicketReward, pickChestReward } from '@/systems/chestLoot';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/**
 * ChestSystem — 寶盒（零式定案 924a1d83）。
 *
 * ⚠️ 寶盒能量(chestCharge) ≠ 技能能量：技能每命中充/4格放招；寶盒每「擊殺」給/滿 165 自動開箱。
 *
 * 累積：敵人死亡時 addCharge(該敵人 chestChargeValue)（由 EnemySpawner 擊殺結算呼叫）。
 * 開箱：charge ≥ 165 自動開箱、扣 165；開箱中能量繼續累積，超過排隊連開（while 迴圈連開）。
 * 抽選：固定表加權隨機（純函式 pickChestReward）；彩票類 → ticket.addTickets；
 *   效果類（坐騎/二段變身）→ 先做最小（log + 暫定旗標/TODO），不卡主流程（待零式校準）。
 */
export class ChestSystem implements GameSystem {
  readonly name = 'ChestSystem';
  private ctx!: GameContext;

  private charge = 0;
  /** 累計開箱次數（debug）。 */
  private opensCount = 0;
  /** 最近一次開出的獎勵種類（UI/debug 顯示）。 */
  private lastReward = '';

  /**
   * 效果類旗標（保留向後相容 + 無 BuffSystem 時的 fallback）。
   * 有 ctx.buff 時另外套真 buff（正式效果由 BuffSystem 計時）；
   * 無 ctx.buff（如純測試 ctx）時用這裡的旗標/倒數。
   */
  private mountBuffActive = false;
  private secondTransformUntil = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  update(dt: number): void {
    // fallback 倒數（僅在無 BuffSystem 接管時有意義）。
    if (this.secondTransformUntil > 0) {
      this.secondTransformUntil = Math.max(0, this.secondTransformUntil - dt);
    }
    // 若有 BuffSystem，旗標以 buff 實際狀態為準。
    if (this.ctx.buff) {
      this.mountBuffActive = this.ctx.buff.isActive('mount');
    }
  }

  /** 擊殺給寶盒能量；達門檻自動連開。 */
  addCharge(amount: number): void {
    if (amount <= 0) return;
    this.charge += amount;
    // 連開：超過門檻就開、扣，剩餘排隊等下次（可一次連開多箱）。
    while (this.charge >= CHEST_OPEN_THRESHOLD) {
      this.charge -= CHEST_OPEN_THRESHOLD;
      this.openChest();
    }
  }

  /** 開一箱：抽選 + 套用獎勵。 */
  private openChest(): void {
    this.opensCount += 1;
    const reward = pickChestReward();
    this.lastReward = reward.kind;

    if (isTicketReward(reward.kind)) {
      this.ctx.ticket.addTickets(reward.tickets);
    } else if (reward.kind === 'mount') {
      // 坐騎：20s dashSpeed×1.5 + 衝刺範圍+2。有 BuffSystem → 套真 buff；旗標同步供查詢/測試。
      this.mountBuffActive = true;
      this.ctx.buff?.apply({
        id: 'mount',
        statTag: BUFF_STAT.mount?.stat,
        magnitude: BUFF_STAT.mount?.magnitude,
        duration: BUFF_DURATION.mount,
        onApply: () => console.info('[Chest] 坐騎啟用（衝刺強化 20s，零式暫定）'),
      });
    } else if (reward.kind === 'secondTransform') {
      // 二段變身：30s 傷害×1.5 + 被打不斷 COMBO。
      this.secondTransformUntil = BUFF_DURATION.secondTransform;
      this.ctx.buff?.apply({
        id: 'secondTransform',
        statTag: BUFF_STAT.secondTransform?.stat,
        magnitude: BUFF_STAT.secondTransform?.magnitude,
        duration: BUFF_DURATION.secondTransform,
        onApply: () =>
          console.info('[Chest] 二段變身啟用（傷害×1.5+護COMBO 30s，零式暫定）'),
      });
    }
  }

  // --- UI / 狀態查詢 ---
  /** 目前寶盒能量。 */
  getCharge(): number {
    return this.charge;
  }

  /** 開箱門檻。 */
  getThreshold(): number {
    return CHEST_OPEN_THRESHOLD;
  }

  /** 進度比例 0..1（charge/門檻）。 */
  getProgress(): number {
    return Math.min(1, this.charge / CHEST_OPEN_THRESHOLD);
  }

  getOpensCount(): number {
    return this.opensCount;
  }

  getLastReward(): string {
    return this.lastReward;
  }

  /** 坐騎效果是否啟用（有 BuffSystem 以其狀態為準，否則用旗標）。 */
  isMountBuffActive(): boolean {
    return this.ctx.buff ? this.ctx.buff.isActive('mount') : this.mountBuffActive;
  }

  /** 二段變身效果是否啟用（有 BuffSystem 以其狀態為準，否則用 fallback 倒數）。 */
  isSecondTransformActive(): boolean {
    return this.ctx.buff
      ? this.ctx.buff.isActive('secondTransform')
      : this.secondTransformUntil > 0;
  }
}
