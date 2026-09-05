import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import type { Enemy } from '@/entities/Enemy';
import type { Player } from '@/entities/Player';
import type { Vec2 } from '@/systems/hitDetection';
import {
  GRAB,
  GRABBER_SPEED_PX,
  accumulateIdle,
  grabberChaseStep,
  grabberTouchesPlayer,
  shouldTriggerGrab,
  tickGrabCountdown,
} from '@/systems/grabMath';

/** 每個玩家的抓人狀態。 */
interface GrabState {
  idle: number; // idleAccumulated 秒數
  prevCombo: number; // 上幀 combo（偵測本幀是否命中→歸零 idle）
  grabber: Enemy | null; // 追來的 grabber（衝向玩家中）
  grabbed: boolean; // 已被抓（倒數中）
  countdown: number; // 被抓倒數剩餘
  wasAttacking: boolean; // 上幀是否攻擊中（偵測攻擊掙脫）
}

/**
 * GrabSystem — 抓人機制（用戶試玩#4，搬自 Unity PlayerController idle/grab）。
 * per-player：戰鬥階段沒打怪累積 idle，滿 8s → 最近敵人變 grabber 衝向玩家；觸碰 → 被抓
 * （不能動+藍閃+倒數 5s）；被抓時攻擊命中 grabber 掙脫，或倒數到自動掙脫。純規則/位移抽 grabMath。
 */
export class GrabSystem implements GameSystem {
  readonly name = 'GrabSystem';
  private ctx!: GameContext;
  private states = new Map<number, GrabState>();

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  private stateOf(pid: number): GrabState {
    let s = this.states.get(pid);
    if (!s) {
      s = { idle: 0, prevCombo: 0, grabber: null, grabbed: false, countdown: 0, wasAttacking: false };
      this.states.set(pid, s);
    }
    return s;
  }

  update(dt: number): void {
    const livingEnemies = this.ctx.getEnemies().filter((e) => !e.isDead());
    // 戰鬥階段：場上有活的、非-grabber 敵人。
    const combatEnemies = livingEnemies.filter((e) => !e.isGrabber());
    const inCombat = combatEnemies.length > 0;

    for (const player of this.ctx.players) {
      const pid = player.playerId;
      const s = this.stateOf(pid);

      // 待機/進場中不累積、不被抓（進場重置由 justEntered 處理）。
      const waitingOrEntering =
        (typeof player.isEntering === 'function' && player.isEntering()) ||
        (typeof player.isWaiting === 'function' && player.isWaiting());

      if (s.grabbed) {
        this.updateGrabbed(player, s, dt);
        continue;
      }
      if (s.grabber) {
        this.updateGrabberChase(player, s, dt);
        continue;
      }

      // idle 累積：命中（combo 增加）→ 歸 0；戰鬥累加；非戰鬥凍結；進場重置。
      const combo = this.ctx.combo?.getCombo?.(pid) ?? 0;
      const hitThisFrame = combo > s.prevCombo;
      s.prevCombo = combo;
      const justEntered = waitingOrEntering; // 進場/待機期間視為重置
      s.idle = accumulateIdle(s.idle, dt, inCombat && !waitingOrEntering, hitThisFrame, justEntered);

      // 滿門檻 → 最近敵人變 grabber 衝向玩家。
      if (shouldTriggerGrab(s.idle) && combatEnemies.length > 0) {
        const grabber = this.nearestEnemy(player.getHitCenter(), combatEnemies);
        if (grabber) {
          grabber.setGrabber(true);
          s.grabber = grabber;
          s.idle = 0;
        }
      }
    }
  }

  /** grabber 衝向玩家；觸碰 → 鎖定被抓。 */
  private updateGrabberChase(player: Player, s: GrabState, dt: number): void {
    const grabber = s.grabber!;
    if (grabber.isDead()) { s.grabber = null; return; }
    const pc = player.getHitCenter();
    const gc = grabber.getHitCenter();
    const next = grabberChaseStep(gc, pc, dt, GRABBER_SPEED_PX);
    grabber.moveTo(next.x, next.y);
    const touchDist = grabber.getHitRadius() + player.getHitRadius();
    if (grabberTouchesPlayer(next, pc, touchDist)) {
      s.grabbed = true;
      s.countdown = GRAB.grabCountdownSeconds;
      player.setGrabbed(true);
    }
  }

  /** 被抓：倒數；攻擊掙脫 or 倒數到自動掙脫。 */
  private updateGrabbed(player: Player, s: GrabState, dt: number): void {
    const attackingNow = typeof player.isAttacking === 'function' ? player.isAttacking() : false;
    const attackEdge = attackingNow && !s.wasAttacking; // 本幀新起攻擊 = 掙脫
    s.wasAttacking = attackingNow;

    const { remaining, autoEscape } = tickGrabCountdown(s.countdown, dt);
    s.countdown = remaining;

    if (attackEdge || autoEscape) {
      this.escape(player, s);
    }
  }

  /** 掙脫：解除被抓、grabber 被擊退回一般 AI。 */
  private escape(player: Player, s: GrabState): void {
    player.setGrabbed(false);
    if (s.grabber && !s.grabber.isDead()) {
      s.grabber.releaseGrabberWithKnockback(player.getHitCenter());
    }
    s.grabber = null;
    s.grabbed = false;
    s.countdown = 0;
    s.idle = 0;
    s.wasAttacking = false;
  }

  private nearestEnemy(from: Vec2, enemies: readonly Enemy[]): Enemy | null {
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of enemies) {
      const c = e.getHitCenter();
      const d = (c.x - from.x) ** 2 + (c.y - from.y) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /** debug/UI：某玩家目前 idle 累積（供測試/HUD）。 */
  getIdle(pid: number): number {
    return this.stateOf(pid).idle;
  }

  destroy(): void {
    this.states.clear();
  }
}
