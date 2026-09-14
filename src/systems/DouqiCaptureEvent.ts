import Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import { effectiveEnemyPlayBounds } from '@/config/mapConfig';
import { DOUQI_CAPTURE_EVENT_CONFIG } from '@/config/douqiConfig';
import { randomPointInCircle, inCircle, captureProgressDelta, captureRingColor } from '@/systems/douqiCaptureMath';

/**
 * DouqiCaptureEvent — 鬥氣佔領事件（第7關，階段 4 commit2）。
 *
 * ★v45：中心佔領圈 captureRadius340（★offset-aware：effectiveEnemyPlayBounds 中心）；波次生怪 waveSize5 全生圈內(√random)；
 *   ★圈內存活怪==0(殺死/推擠出圈都算)才隔 waveGapMs1800 出下波；★進度＝玩家在圈內 且 圈內0怪 才 progressPerSec12/dt、
 *   有怪或不在圈停(不倒退)；滿100成功；限時 timeLimitMs45000 時到未滿失敗。圈色 綠/黃/灰。
 * ★只 douqi 事件用；normal 不建。命中走既有 takeHit（怪照常追玩家，玩家清圈內怪）。
 */
export class DouqiCaptureEvent {
  private readonly ctx: GameContext;
  private readonly cfg = DOUQI_CAPTURE_EVENT_CONFIG;
  private readonly scaleEnemy: (enemy: import('@/entities/Enemy').Enemy) => void;

  private center = { x: 0, y: 0 };
  private active = false;
  private progress = 0; // 0~100
  private elapsedMs = 0;
  private waveGapAccumMs = 0;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private outcome: 'running' | 'success' | 'fail' = 'running';

  constructor(ctx: GameContext, scaleEnemy: (enemy: import('@/entities/Enemy').Enemy) => void) {
    this.ctx = ctx;
    this.scaleEnemy = scaleEnemy;
    this.gfx = ctx.scene.add.graphics().setDepth(50);
  }

  start(): void {
    // ★offset-aware 中心（當前區塊可走界中心）。
    const b = effectiveEnemyPlayBounds();
    this.center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    this.active = true;
    this.progress = 0;
    this.elapsedMs = 0;
    this.waveGapAccumMs = this.cfg.waveGapMs; // 立即出第一波
    this.outcome = 'running';
  }

  isComplete(): boolean {
    return this.active && this.outcome !== 'running';
  }
  isSuccess(): boolean {
    return this.outcome === 'success';
  }
  getProgressRatio(): number {
    return this.progress / 100;
  }
  getRemainSec(): number {
    return Math.max(0, (this.cfg.timeLimitMs - this.elapsedMs) / 1000);
  }

  update(dt: number): void {
    if (!this.active || this.outcome !== 'running') return;
    const dtMs = dt * 1000;
    this.elapsedMs += dtMs;

    const enemiesInCircle = this.countEnemiesInCircle();
    const playerInCircle = this.isAnyPlayerInCircle();

    // ★圈內 0 怪才出下波（隔 waveGapMs）。
    if (enemiesInCircle === 0) {
      this.waveGapAccumMs += dtMs;
      if (this.waveGapAccumMs >= this.cfg.waveGapMs) {
        this.waveGapAccumMs = 0;
        this.spawnWave();
      }
    } else {
      this.waveGapAccumMs = 0;
    }

    // ★進度雙條件門控（在圈+無怪才推、不倒退）。
    this.progress = Math.min(100, this.progress + captureProgressDelta(playerInCircle, enemiesInCircle, this.cfg.progressPerSec, dt));

    this.drawRing(playerInCircle, enemiesInCircle);

    // 勝負。
    if (this.progress >= 100) this.outcome = 'success';
    else if (this.elapsedMs >= this.cfg.timeLimitMs) this.outcome = 'fail';
  }

  private spawnWave(): void {
    const insideR = this.cfg.captureRadiusPx * this.cfg.spawnInsideRatio;
    for (let i = 0; i < this.cfg.waveSize; i += 1) {
      const p = randomPointInCircle(this.center.x, this.center.y, insideR);
      const enemy = this.ctx.spawner.spawn('Enemy_Rush', p.x, p.y);
      this.scaleEnemy(enemy);
    }
  }

  private countEnemiesInCircle(): number {
    let n = 0;
    for (const e of this.ctx.getEnemies()) {
      if (e.isDead() || e.isTower()) continue;
      const c = e.getHitCenter();
      if (inCircle(c.x, c.y, this.center.x, this.center.y, this.cfg.captureRadiusPx)) n += 1;
    }
    return n;
  }

  private isAnyPlayerInCircle(): boolean {
    for (const p of this.ctx.players) {
      const pos = p.getPosition();
      if (inCircle(pos.x, pos.y, this.center.x, this.center.y, this.cfg.captureRadiusPx)) return true;
    }
    return false;
  }

  private drawRing(playerInCircle: boolean, enemiesInCircle: number): void {
    const g = this.gfx;
    g.clear();
    const color = captureRingColor(playerInCircle, enemiesInCircle);
    const hex = color === 'green' ? 0x44ff66 : color === 'yellow' ? 0xffcc33 : 0x888888;
    g.fillStyle(hex, 0.1).fillCircle(this.center.x, this.center.y, this.cfg.captureRadiusPx);
    g.lineStyle(4, hex, 0.8).strokeCircle(this.center.x, this.center.y, this.cfg.captureRadiusPx);
    // 進度弧（圈邊，白）。
    g.lineStyle(6, 0xffffff, 0.9);
    g.beginPath();
    g.arc(this.center.x, this.center.y, this.cfg.captureRadiusPx - 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.getProgressRatio(), false);
    g.strokePath();
  }

  destroy(): void {
    this.active = false;
    this.gfx.destroy();
  }
}
