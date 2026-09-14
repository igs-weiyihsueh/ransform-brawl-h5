import Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { Vec2 } from '@/systems/hitDetection';
import { GAME_WIDTH, GAME_HEIGHT } from '@/config/gameConfig';
import { DOUQI_GUARD_EVENT_CONFIG } from '@/config/douqiConfig';

/**
 * 守護 NPC 目標：實作 EnemySpawner.guardTarget 介面（getPosition/getHitCenter/getHitRadius/takeDamage）。
 * ★不會動(靜止)、不是 Enemy（不進 ctx.getEnemies→不可鎖不可被玩家攻＝v45 排 npc、天然可被衝刺穿越）。
 */
class GuardNpc {
  private hp: number;
  constructor(
    private readonly pos: Vec2,
    private readonly maxHp: number,
    private readonly radius: number,
  ) {
    this.hp = maxHp;
  }
  getPosition(): Vec2 {
    return this.pos;
  }
  getHitCenter(): Vec2 {
    return this.pos;
  }
  getHitRadius(): number {
    return this.radius;
  }
  /** 被怪攻擊扣血（★怪攻擊節奏由敵人 FSM attackCooldown≥2s 天然節流，比 v45 npcAttackCooldownMs1000 更保守，不會每幀秒死）。 */
  takeDamage(dmg: number): void {
    this.hp = Math.max(0, this.hp - dmg);
  }
  getHpRatio(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }
  isDead(): boolean {
    return this.hp <= 0;
  }
}

/**
 * DouqiGuardEvent — 鬥氣守護事件（第5關，階段 4 commit2）。
 *
 * ★v45：中心 NPC(hp1600、r26、不會動、不可鎖攻、可穿越)；生怪每 550ms 生 2 隻、★target=NPC 座標衝去打 NPC；
 *   撐 durationMs30000 成功 / NPC hp0 失敗。★怪 target=NPC＝複用既有 spawner.guardTarget 機制（怪 aim/攻擊改朝 guardTarget、
 *   攻擊命中走 applyAttackDamage→guardTarget.takeDamage）。事件結束還原 guardTarget=null。
 * ★只 douqi 事件用；normal 不建。
 */
export class DouqiGuardEvent {
  private readonly ctx: GameContext;
  private readonly cfg = DOUQI_GUARD_EVENT_CONFIG;
  private readonly scaleEnemy: (enemy: import('@/entities/Enemy').Enemy) => void;

  private npc: GuardNpc | null = null;
  private center = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
  private active = false;
  private elapsedMs = 0;
  private spawnAccumMs = 0;
  private readonly npcGfx: Phaser.GameObjects.Graphics;
  private outcome: 'running' | 'success' | 'fail' = 'running';

  constructor(ctx: GameContext, scaleEnemy: (enemy: import('@/entities/Enemy').Enemy) => void) {
    this.ctx = ctx;
    this.scaleEnemy = scaleEnemy;
    this.npcGfx = ctx.scene.add.graphics().setDepth(55);
  }

  start(): void {
    this.center = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
    this.npc = new GuardNpc(this.center, this.cfg.npcHp, this.cfg.radiusPx);
    // ★怪 target=NPC：設 spawner.guardTarget（現有怪 + 之後新生怪都攻 NPC）。
    this.ctx.spawner.setGuardTarget(this.npc);
    this.active = true;
    this.elapsedMs = 0;
    this.spawnAccumMs = 0;
    this.outcome = 'running';
  }

  isComplete(): boolean {
    return this.active && this.outcome !== 'running';
  }
  /** 成功 or 失敗（isComplete 為 true 後讀）。 */
  isSuccess(): boolean {
    return this.outcome === 'success';
  }
  getNpcHpRatio(): number {
    return this.npc ? this.npc.getHpRatio() : 0;
  }
  /** 剩餘秒（HUD 倒數）。 */
  getRemainSec(): number {
    return Math.max(0, (this.cfg.durationMs - this.elapsedMs) / 1000);
  }

  update(dt: number): void {
    if (!this.active || this.outcome !== 'running' || !this.npc) return;
    const dtMs = dt * 1000;
    this.elapsedMs += dtMs;
    // 生怪衝 NPC。
    this.spawnAccumMs += dtMs;
    if (this.spawnAccumMs >= this.cfg.spawnIntervalMs) {
      this.spawnAccumMs = 0;
      this.spawnWave();
    }
    // 畫 NPC（守護目標）。
    this.drawNpc();
    // 勝負判定。
    if (this.npc.isDead()) this.outcome = 'fail';
    else if (this.elapsedMs >= this.cfg.durationMs) this.outcome = 'success';
  }

  private spawnWave(): void {
    const b = this.ctx.worldBounds;
    for (let i = 0; i < this.cfg.spawnBatch; i += 1) {
      // 場邊隨機生（會自動衝向 NPC＝guardTarget）。
      const edge = Math.floor(Math.random() * 4);
      let x = b.x + 60 + Math.random() * (b.width - 120);
      let y = b.y + 60 + Math.random() * (b.height - 120);
      if (edge === 0) y = b.y + 60;
      else if (edge === 1) y = b.y + b.height - 60;
      else if (edge === 2) x = b.x + 60;
      else x = b.x + b.width - 60;
      const enemy = this.ctx.spawner.spawn('Enemy_Rush', x, y);
      this.scaleEnemy(enemy); // 套 teamLevel scale（用 normal 邏輯怪 base）
    }
  }

  private drawNpc(): void {
    if (!this.npc) return;
    const g = this.npcGfx;
    g.clear();
    const ratio = this.npc.getHpRatio();
    // NPC 本體：青色圓（守護對象）+ 血量環。
    g.fillStyle(0x66ccff, 0.9).fillCircle(this.center.x, this.center.y, this.cfg.radiusPx);
    g.lineStyle(3, 0xffffff, 0.8).strokeCircle(this.center.x, this.center.y, this.cfg.radiusPx + 4);
    // 血量環（綠→紅）。
    const col = ratio > 0.5 ? 0x66ff88 : ratio > 0.25 ? 0xffcc33 : 0xff4444;
    g.lineStyle(4, col, 1);
    g.beginPath();
    g.arc(this.center.x, this.center.y, this.cfg.radiusPx + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio, false);
    g.strokePath();
  }

  /** 事件結束：還原 guardTarget=null（怪回頭打玩家）、清 NPC 視覺。 */
  destroy(): void {
    this.active = false;
    this.ctx.spawner.setGuardTarget(null);
    this.npcGfx.destroy();
    this.npc = null;
  }
}
