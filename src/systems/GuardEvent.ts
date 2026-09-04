import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import { GUARD_DRIP, getGuardPreset, type GuardPreset } from '@/config/guardConfig';
import { GuardTarget } from '@/entities/GuardTarget';
import type { EnemyType } from '@/config/levelSchema';
import type { GameContext } from '@/systems/GameContext';

/**
 * GuardEvent — 一場守護波（Guard Event）的執行狀態機（決策 76f235e4）。
 *
 * 由 WaveSystem 在 Event 節點建立並每幀 tick。
 * 流程：生 GuardTarget（場中央）+ 把敵人目標切成雕像 → drip 生敵維持 maxAlive →
 *   倒數 timeLimit（量條由時間扣）→ 勝(撐過且 HP>0) / 敗(HP≤0 提早結束) →
 *   cleanup（停 drip、清全部敵人、destroy 雕像、敵人目標清回玩家）→
 *   勝 payout round(rewardTickets × hpRatio)、敗 0（log）。無 GameOver、無扣命。
 */
export class GuardEvent {
  private readonly ctx: GameContext;
  private readonly preset: GuardPreset;
  private readonly spawnTypes: EnemyType[];

  private target: GuardTarget;
  private remaining: number;
  private spawnCooldown = 0;
  private finished = false;
  private won = false;

  constructor(ctx: GameContext, presetName: string, spawnTypes: EnemyType[]) {
    this.ctx = ctx;
    this.preset = getGuardPreset(presetName);
    this.spawnTypes = spawnTypes.length > 0 ? spawnTypes : ['Enemy_Rush'];
    this.remaining = this.preset.timeLimit;

    // 生雕像於場中央，敵人攻擊改打雕像。
    this.target = new GuardTarget(
      ctx.scene,
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2,
      this.preset.targetHP,
    );
    ctx.spawner.setGuardTarget(this.target);
  }

  isFinished(): boolean {
    return this.finished;
  }

  /** 每幀推進。回傳 true 表示本守護波已結束（WaveSystem 據此前進節點）。 */
  update(dt: number): boolean {
    if (this.finished) return true;

    // 敗：雕像 HP 歸 0 → 提早結束。
    if (this.target.isDefeated()) {
      this.finish(false);
      return true;
    }

    // 倒數（量條由時間扣）。
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.remaining = 0;
      this.finish(true); // 撐過時間且 HP>0 → 勝
      return true;
    }

    // drip：維持場上敵人數（無 killQuota）。存活 < spawnThreshold 時補到 maxAlive。
    this.spawnCooldown -= dt;
    const alive = this.ctx.getEnemies().length;
    if (alive < GUARD_DRIP.spawnThreshold && this.spawnCooldown <= 0 && alive < GUARD_DRIP.maxAlive) {
      this.spawnAroundTarget();
      this.spawnCooldown = GUARD_DRIP.spawnInterval;
    }
    return false;
  }

  private spawnAroundTarget(): void {
    const c = this.target.getPosition();
    const ang = Math.random() * Math.PI * 2;
    const x = c.x + Math.cos(ang) * GUARD_DRIP.spawnRadiusPx;
    const y = c.y + Math.sin(ang) * GUARD_DRIP.spawnRadiusPx;
    const type = this.spawnTypes[Phaser.Math.Between(0, this.spawnTypes.length - 1)];
    this.ctx.spawner.spawn(type, x, y);
  }

  /** 結束：cleanup + 結算獎券。 */
  private finish(won: boolean): void {
    this.finished = true;
    this.won = won;

    const hpRatio = this.target.getHpRatio();
    // cleanup：清回玩家目標、清全部敵人、destroy 雕像。
    this.ctx.spawner.setGuardTarget(null);
    this.ctx.spawner.clearAllEnemies();
    this.target.destroy();

    if (won) {
      const reward = Math.round(this.preset.rewardTickets * hpRatio);
      this.ctx.ticket.addTickets(reward); // ticket 生產者：只 addTickets
      console.info(`[Guard] 勝利！獎券 +${reward}（hpRatio ${hpRatio.toFixed(2)}）`);
    } else {
      console.info('[Guard] 失敗，無獎券（不 GameOver、關卡續行）');
    }
  }

  // --- UI / debug 查詢 ---
  getRemaining(): number {
    return Math.ceil(this.remaining);
  }

  /** 量條 fill = (timeLimit - remaining)/timeLimit（隨時間填滿）。 */
  getGaugeFill(): number {
    return (this.preset.timeLimit - this.remaining) / this.preset.timeLimit;
  }

  getTargetHp(): number {
    return this.target.getHp();
  }

  getTargetMaxHp(): number {
    return this.target.getMaxHp();
  }

  didWin(): boolean {
    return this.won;
  }
}
