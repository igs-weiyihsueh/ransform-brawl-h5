import Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { Enemy } from '@/entities/Enemy';
import { GAME_WIDTH, GAME_HEIGHT } from '@/config/gameConfig';
import { DOUQI_BOSS_CONFIG, DOUQI_LEVEL_CONFIG } from '@/config/douqiConfig';
import { levelScale } from '@/systems/douqiLevelMath';
import {
  bossFillProgress,
  circleHit,
  fanHit,
  halfFieldHit,
  halfFieldFills,
  bossMaxHp,
} from '@/systems/douqiBossMath';

type BossSkillKind = 'a' | 'c' | 'd';
type BossPhase = 'idle' | 'casting'; // idle=gap 空檔丟球、casting=蓄招填滿中

/** gap 球（空檔投射物）：手動移動 + 命中判定（douqi 自管，不定身）。 */
interface GapBall {
  gfx: Phaser.GameObjects.Arc;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
}

/**
 * DouqiBossEvent — 鬥氣第10關最終 BOSS（階段 5，收尾）。
 *
 * ★v45：BOSS 固定場中央不動、maxHp3000×序號×teamLevel scale、可被打；四招 a 圓/c 扇形/d 半場輪替（index%3、b 移除）——
 *   ★接塔四扇形 towerRingSkill/技能三層**形狀區域 telegraph→fire** pattern：畫形狀 fill 漸顯 fillMs4000→填滿瞬間發射判定
 *   +damage30+定身 skillRootMs2000（無敵/衝刺護盾可擋）；★招間隔 gapMs3000 從釋放完起算（scheduleNext 在 fill 完呼、相鄰不重疊）。
 *   空檔 gap 丟球（intervalMs900、不定身）。命中發 triggerBossImpact（Boss-gate 共屏震動）。打倒→通關。
 * ★踩雷：①gapMs 從釋放完起算②蓄力中被打死 clearTelegraph 不誤發（onBossKilled 統一路徑）③fillMs4000 配定身2秒才公平④固定不動。
 * ★只 douqi；normal 不建。玩家無血量→BOSS 傷走二段能量倒扣+applyStun 定身。BOSS 戰不生一般小怪（DouqiSpawnSystem boss 分支）。
 */
export class DouqiBossEvent {
  private readonly ctx: GameContext;
  private readonly cfg = DOUQI_BOSS_CONFIG;
  private readonly getTeamLevel: () => number;
  private readonly onPlayerHitEnergy: (playerId: number) => void;
  private readonly bossImpact: () => void;
  private readonly grantExp: (kills: number) => void;

  private boss: Enemy | null = null;
  private center = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
  private bossMax = 1;
  private active = false;
  private won = false;

  // 招式循環。
  private phase: BossPhase = 'idle';
  private skillIndex = 0;
  private readonly kinds: BossSkillKind[] = ['a', 'c', 'd'];
  private curSkill: BossSkillKind = 'a';
  private castMs = 0;
  private gapAccumMs = 0; // idle 空檔計時（到 skillGapMs 開下一招）
  private curAimDeg = 0; // c 招發招瞬間鎖定的玩家方向
  private fired = false; // a/c 本招是否已發射（防重複判定）
  private dFiredLeft = false; // d 左半是否已發
  private dFiredRight = false; // d 右半是否已發

  // gap 球。
  private gapBallAccumMs = 0;
  private balls: GapBall[] = [];

  // 掉道具累積傷害。
  private dmgSinceDrop = 0;
  private lastBossHp = 0;

  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(
    ctx: GameContext,
    getTeamLevel: () => number,
    onPlayerHitEnergy: (playerId: number) => void,
    bossImpact: () => void,
    grantExp: (kills: number) => void,
  ) {
    this.ctx = ctx;
    this.getTeamLevel = getTeamLevel;
    this.onPlayerHitEnergy = onPlayerHitEnergy;
    this.bossImpact = bossImpact;
    this.grantExp = grantExp;
    this.gfx = ctx.scene.add.graphics().setDepth(60);
  }

  /** 出場：中心生 BOSS（HP=base×序號×teamLevel scale），登場震動 + 開場先進 gap（空檔）。 */
  start(bossCount = 1): void {
    this.center = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
    const hpScale = levelScale(DOUQI_LEVEL_CONFIG.difficultyLv1.enemyHp, this.getTeamLevel(), DOUQI_LEVEL_CONFIG.cap);
    this.bossMax = bossMaxHp(this.cfg.maxHp, bossCount, this.cfg.hpGrowthPerBoss, hpScale);
    // 用 spawnTower 生固定不動可打的本體（Enemy_Tower 靜態不動、ringCount0＝不放環狀技，攻擊全走本事件招式）。
    this.boss = this.ctx.spawner.spawnTower(this.center.x, this.center.y, this.bossMax, { ringCount: 0 }, 1.6);
    this.lastBossHp = this.bossMax;
    this.dmgSinceDrop = 0;
    this.active = true;
    this.won = false;
    this.phase = 'idle';
    this.skillIndex = 0;
    this.gapAccumMs = 0;
    this.gapBallAccumMs = 0;
    this.fired = false;
    this.bossImpact(); // 登場震動（Boss-gate）
  }

  isComplete(): boolean {
    return this.active && this.won;
  }
  getBossHpRatio(): number {
    if (!this.boss || this.boss.isDead()) return 0;
    const hp = (this.boss as unknown as { getHp?: () => number }).getHp?.() ?? 0;
    return Math.max(0, Math.min(1, hp / this.bossMax));
  }

  update(dt: number): void {
    if (!this.active || this.won) return;
    // 打倒 BOSS → 通關。
    if (!this.boss || this.boss.isDead()) {
      this.onBossKilled();
      return;
    }
    const dtMs = dt * 1000;
    this.trackDropDamage();
    this.tickGapBalls(dtMs);
    if (this.phase === 'idle') this.tickIdle(dtMs);
    else this.tickCasting(dtMs);
  }

  // ---- 招式循環 ----
  private tickIdle(dtMs: number): void {
    this.clearTelegraph();
    // 空檔丟球。
    this.gapBallAccumMs += dtMs;
    if (this.gapBallAccumMs >= this.cfg.gapBallIntervalMs) {
      this.gapBallAccumMs = 0;
      this.spawnGapBall();
    }
    // gap 到→開下一招。
    this.gapAccumMs += dtMs;
    if (this.gapAccumMs >= this.cfg.skillGapMs) {
      this.gapAccumMs = 0;
      this.beginSkill();
    }
  }

  private beginSkill(): void {
    this.curSkill = this.kinds[this.skillIndex % this.kinds.length];
    this.skillIndex += 1;
    this.phase = 'casting';
    this.castMs = 0;
    this.fired = false;
    this.dFiredLeft = false;
    this.dFiredRight = false;
    // c 招發招瞬間鎖定玩家方向（填滿期間固定不追＝可躲）。
    if (this.curSkill === 'c') {
      const p = this.ctx.players[0]?.getPosition() ?? this.center;
      this.curAimDeg = (Math.atan2(p.y - this.center.y, p.x - this.center.x) * 180) / Math.PI;
    }
  }

  private tickCasting(dtMs: number): void {
    this.castMs += dtMs;
    this.drawSkillTelegraph();
    if (this.curSkill === 'd') {
      // d 左右半場接力：左半 fill 完發左、右半 fill 完發右（兩次判定，玩家可趁縫換邊躲）。
      const { leftFill, rightFill } = halfFieldFills(this.castMs, this.cfg.skillFillMs, this.cfg.dHalfOverlap);
      if (!this.dFiredLeft && leftFill >= 1) { this.fireHalf('left'); this.dFiredLeft = true; this.bossImpact(); }
      if (!this.dFiredRight && rightFill >= 1) { this.fireHalf('right'); this.dFiredRight = true; }
      if (this.dFiredLeft && this.dFiredRight) {
        this.clearTelegraph();
        this.phase = 'idle';
        this.gapAccumMs = 0;
      }
      return;
    }
    if (!this.fired && bossFillProgress(this.castMs, this.cfg.skillFillMs) >= 1) {
      // a/c 填滿瞬間發射判定。
      this.fireSkill();
      this.fired = true;
      this.clearTelegraph();
      // ★gapMs 從釋放完起算：回 idle，gapAccum 歸零重數。
      this.phase = 'idle';
      this.gapAccumMs = 0;
    }
  }

  /** a/c 招填滿瞬間發射：對每個玩家判定命中→定身+二段能量倒扣；發 triggerBossImpact 共屏震動。 */
  private fireSkill(): void {
    for (const player of this.ctx.players) {
      const pos = player.getPosition();
      const pr = (player as unknown as { getHitRadius?: () => number }).getHitRadius?.() ?? 20;
      let hit = false;
      if (this.curSkill === 'a') hit = circleHit(this.center, pos, pr, this.cfg.aRadiusPx);
      else if (this.curSkill === 'c') hit = fanHit(this.center, pos, pr, this.curAimDeg, this.cfg.cArcDeg, this.cfg.cRangePx);
      if (hit) this.applyHitToPlayer(player);
    }
    this.bossImpact(); // 發射共屏震動（Boss-gate）
  }

  /** d 招某半場發射判定：玩家在該半場側→命中定身。 */
  private fireHalf(side: 'left' | 'right'): void {
    for (const player of this.ctx.players) {
      const pos = player.getPosition();
      if (halfFieldHit(this.center.x, pos.x, side)) this.applyHitToPlayer(player);
    }
  }

  private applyHitToPlayer(player: GameContext['players'][number]): void {
    (player as unknown as { applyStun?: (s: number) => void }).applyStun?.(this.cfg.skillRootMs / 1000);
    this.onPlayerHitEnergy(player.playerId);
  }

  // ---- 招式預警視覺（形狀 fill 漸顯）----
  private drawSkillTelegraph(): void {
    const g = this.gfx;
    g.clear();
    const p = bossFillProgress(this.castMs, this.cfg.skillFillMs);
    const alpha = 0.16 + 0.34 * p;
    const color = p > 0.85 ? 0xff4466 : 0xff9933;
    g.fillStyle(color, alpha);
    if (this.curSkill === 'a') {
      g.fillCircle(this.center.x, this.center.y, this.cfg.aRadiusPx * p);
    } else if (this.curSkill === 'c') {
      const half = (this.cfg.cArcDeg / 2) * (Math.PI / 180);
      const cRad = (this.curAimDeg * Math.PI) / 180;
      const r = this.cfg.cRangePx * p;
      g.beginPath();
      g.moveTo(this.center.x, this.center.y);
      g.arc(this.center.x, this.center.y, r, cRad - half, cRad + half, false);
      g.closePath();
      g.fillPath();
    } else {
      // d 左右半場接力：左半先 fill、右半延遲。以垂直中線分左右，alpha 各自隨 fill。
      const { leftFill, rightFill } = halfFieldFills(this.castMs, this.cfg.skillFillMs, this.cfg.dHalfOverlap);
      const b = this.ctx.worldBounds;
      g.fillStyle(color, 0.16 + 0.34 * leftFill);
      g.fillRect(b.x, b.y, this.center.x - b.x, b.height);
      g.fillStyle(color, 0.16 + 0.34 * rightFill);
      g.fillRect(this.center.x, b.y, b.x + b.width - this.center.x, b.height);
    }
  }

  private clearTelegraph(): void {
    this.gfx.clear();
  }

  // ---- gap 球（空檔投射物，不定身）----
  private spawnGapBall(): void {
    const p = this.ctx.players[0]?.getPosition();
    if (!p) return;
    const dx = p.x - this.center.x;
    const dy = p.y - this.center.y;
    const len = Math.hypot(dx, dy) || 1;
    const sp = this.cfg.gapBallSpeedPxPerSec;
    const arc = this.ctx.scene.add.circle(this.center.x, this.center.y, this.cfg.gapBallRadiusPx, 0xff66cc, 0.95).setDepth(61);
    this.balls.push({ gfx: arc, x: this.center.x, y: this.center.y, vx: (dx / len) * sp, vy: (dy / len) * sp, alive: true });
  }

  private tickGapBalls(dtMs: number): void {
    const dt = dtMs / 1000;
    const b = this.ctx.worldBounds;
    for (const ball of this.balls) {
      if (!ball.alive) continue;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.gfx.setPosition(ball.x, ball.y);
      // 出界→回收。
      if (ball.x < b.x - 40 || ball.x > b.x + b.width + 40 || ball.y < b.y - 40 || ball.y > b.y + b.height + 40) {
        ball.alive = false;
        ball.gfx.destroy();
        continue;
      }
      // 命中玩家（★不定身，只二段能量倒扣）。
      for (const player of this.ctx.players) {
        const pos = player.getPosition();
        const pr = (player as unknown as { getHitRadius?: () => number }).getHitRadius?.() ?? 20;
        if (Math.hypot(pos.x - ball.x, pos.y - ball.y) <= this.cfg.gapBallRadiusPx + pr) {
          this.onPlayerHitEnergy(player.playerId);
          ball.alive = false;
          ball.gfx.destroy();
          break;
        }
      }
    }
    this.balls = this.balls.filter((x) => x.alive);
  }

  // ---- 掉道具（過程每累積受傷 dropEveryDamage 掉1，先發經驗佔位）----
  private trackDropDamage(): void {
    if (!this.boss) return;
    const hp = (this.boss as unknown as { getHp?: () => number }).getHp?.() ?? 0;
    const dealt = this.lastBossHp - hp;
    if (dealt > 0) {
      this.dmgSinceDrop += dealt;
      this.lastBossHp = hp;
      while (this.dmgSinceDrop >= this.cfg.dropEveryDamage) {
        this.dmgSinceDrop -= this.cfg.dropEveryDamage;
        this.grantExp(2); // 道具佔位：發少量經驗（道具系統後面做）
      }
    }
  }

  private onBossKilled(): void {
    this.clearTelegraph();
    for (const ball of this.balls) ball.gfx.destroy();
    this.balls = [];
    this.grantExp(this.cfg.dropCount * 5); // 打倒掉道具佔位→經驗
    this.won = true;
  }

  destroy(): void {
    this.active = false;
    this.clearTelegraph();
    this.gfx.destroy();
    for (const ball of this.balls) ball.gfx.destroy();
    this.balls = [];
    this.boss = null;
  }
}
