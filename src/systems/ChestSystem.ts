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

  /** 每玩家寶盒能量（Map<playerId>，決策 c61872a6 傷害貢獻分）。 */
  private charge = new Map<number, number>();
  /** 累計開箱次數（全域 debug）。 */
  private opensCount = 0;
  /** 最近一次開出的獎勵種類（全域 debug）。 */
  private lastReward = '';

  private mountBuffActive = false;
  private secondTransformUntil = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.charge.clear();
  }

  update(dt: number): void {
    if (this.secondTransformUntil > 0) {
      this.secondTransformUntil = Math.max(0, this.secondTransformUntil - dt);
    }
    if (this.ctx.buff) {
      this.mountBuffActive = this.ctx.buff.isActive('mount');
    }
  }

  /** 給某玩家寶盒能量；達門檻自動連開（開箱歸該 player）。 */
  addCharge(playerId: number, amount: number): void {
    if (amount <= 0) return;
    let c = (this.charge.get(playerId) ?? 0) + amount;
    while (c >= CHEST_OPEN_THRESHOLD) {
      c -= CHEST_OPEN_THRESHOLD;
      this.openChest(playerId);
    }
    this.charge.set(playerId, c);
  }

  /** 開一箱（歸屬 playerId）：抽選 + 套用獎勵。 */
  private openChest(playerId: number): void {
    this.opensCount += 1;
    const reward = pickChestReward();
    this.lastReward = reward.kind;

    if (isTicketReward(reward.kind)) {
      this.ctx.ticket.addTickets(playerId, reward.tickets); // 產票歸開箱 player
    } else if (reward.kind === 'mount') {
      this.mountBuffActive = true;
      this.ctx.buff?.apply({
        id: 'mount',
        statTag: BUFF_STAT.mount?.stat,
        magnitude: BUFF_STAT.mount?.magnitude,
        duration: BUFF_DURATION.mount,
        onApply: () => console.info('[Chest] 坐騎啟用（衝刺強化 20s，零式暫定）'),
      });
    } else if (reward.kind === 'secondTransform') {
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
  /** 某玩家寶盒能量。 */
  getCharge(playerId: number): number {
    return this.charge.get(playerId) ?? 0;
  }

  /** 開箱門檻。 */
  getThreshold(): number {
    return CHEST_OPEN_THRESHOLD;
  }

  /** 某玩家進度比例 0..1（charge/門檻）。 */
  getProgress(playerId: number): number {
    return Math.min(1, this.getCharge(playerId) / CHEST_OPEN_THRESHOLD);
  }

  getOpensCount(): number {
    return this.opensCount;
  }

  getLastReward(): string {
    return this.lastReward;
  }

  isMountBuffActive(): boolean {
    return this.ctx.buff ? this.ctx.buff.isActive('mount') : this.mountBuffActive;
  }

  isSecondTransformActive(): boolean {
    return this.ctx.buff
      ? this.ctx.buff.isActive('secondTransform')
      : this.secondTransformUntil > 0;
  }
}
