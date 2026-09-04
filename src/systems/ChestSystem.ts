import { CHEST_OPEN_THRESHOLD } from '@/config/chestConfig';
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

  /** 效果類旗標（暫定，待零式校準真正效果）。 */
  private mountBuffActive = false;
  private secondTransformUntil = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  update(dt: number): void {
    // 二段變身增益倒數（暫定 30s）。
    if (this.secondTransformUntil > 0) {
      this.secondTransformUntil -= dt;
      if (this.secondTransformUntil <= 0) this.secondTransformUntil = 0;
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
      // 暫定：衝刺強化。真正數值待零式校準（先旗標 + log，不卡主流程）。
      this.mountBuffActive = true;
      console.info('[Chest] 開出坐騎（衝刺強化，暫定，待零式校準）');
    } else if (reward.kind === 'secondTransform') {
      // 暫定：30s 增益。
      this.secondTransformUntil = 30;
      console.info('[Chest] 開出二段變身（30s 增益，暫定，待零式校準）');
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

  /** 暫定效果查詢（待零式校準真正效果；先供 debug/UI 觀察）。 */
  isMountBuffActive(): boolean {
    return this.mountBuffActive;
  }

  isSecondTransformActive(): boolean {
    return this.secondTransformUntil > 0;
  }
}
