import Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import type { Enemy } from '@/entities/Enemy';
import type { Player } from '@/entities/Player';
import type { Vec2 } from '@/systems/hitDetection';
import { PANEL_DEPTH, resolveGrabHintDisplay } from '@/config/uiConfig';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';
import {
  GRAB,
  GRABBER_SPEED_PX,
  accumulateIdle,
  grabberChaseStep,
  grabberTouchesPlayer,
  shouldTriggerGrab,
  tickGrabCountdown,
  shouldEscapeGrab,
} from '@/systems/grabMath';
import { getResolvedGrabIdleTriggerSec } from '@/config/grabSchema';

/** 每個玩家的抓人狀態。 */
interface GrabState {
  idle: number; // idleAccumulated 秒數
  prevCombo: number; // 上幀 combo（偵測本幀是否命中→歸零 idle）
  grabber: Enemy | null; // 追來的 grabber（衝向玩家中）
  grabbed: boolean; // 已被抓（倒數中）
  countdown: number; // 被抓倒數剩餘
  wasAttacking: boolean; // 上幀是否攻擊中（偵測攻擊掙脫）
  wasDashing: boolean; // 上幀是否衝刺中（偵測衝刺掙脫，用戶第九輪 #1）
  hint: Phaser.GameObjects.Text | null; // 被抓 UI 提示（按攻擊掙脫! + 倒數）
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
      s = { idle: 0, prevCombo: 0, grabber: null, grabbed: false, countdown: 0, wasAttacking: false, wasDashing: false, hint: null };
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
      // 十五輪：沒 credit（耗盡無敵）+ 連打變身鎖定（浮起無敵）玩家也不被抓。
      const waitingOrEntering =
        (typeof player.isEntering === 'function' && player.isEntering()) ||
        (typeof player.isWaiting === 'function' && player.isWaiting()) ||
        (typeof player.isOutOfCredit === 'function' && player.isOutOfCredit()) ||
        (typeof player.isMashLocked === 'function' && player.isMashLocked());

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

      // 滿門檻 → 最近敵人變 grabber 衝向玩家。（閒置觸發秒數 editorStore override 優先，無則 config 預設。）
      if (shouldTriggerGrab(s.idle, getResolvedGrabIdleTriggerSec()) && combatEnemies.length > 0) {
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
      grabber.setGrabberLocked?.(true); // 抓住→grabber 站著維持 idle（用戶新#5）
      s.wasAttacking = true; // 觸碰當幀若玩家正攻擊，不立即誤判為掙脫（等下一次新起攻擊）
      s.wasDashing = player.isDashing?.() ?? false; // 觸碰當幀若正衝刺，不立即誤判掙脫（等新起衝刺）
    }
  }

  /** 被抓：顯示掙脫提示+倒數；攻擊掙脫 or 倒數到自動掙脫。 */
  private updateGrabbed(player: Player, s: GrabState, dt: number): void {
    const attackingNow = typeof player.isAttacking === 'function' ? player.isAttacking() : false;
    const attackEdge = attackingNow && !s.wasAttacking; // 本幀新起攻擊 = 掙脫
    s.wasAttacking = attackingNow;
    // 十六輪 bug1：被抓時攻擊輸入被 PlayerControl gate 攔(不普攻/保持 idle)→ isAttacking 不會 true，
    //   改讀 struggleInput edge（PlayerControl 被抓 gate 每次按攻擊登記）當掙脫觸發。
    const struggleEdge = typeof player.consumeStruggleInput === 'function' ? player.consumeStruggleInput() : false;

    // 用戶第九輪 #1：被抓時衝刺=掙脫（與攻擊同級）。偵測本幀新起衝刺 edge。
    const dashingNow = typeof player.isDashing === 'function' ? player.isDashing() : false;
    const dashEdge = dashingNow && !s.wasDashing; // 本幀新起衝刺 = 掙脫
    s.wasDashing = dashingNow;

    const { remaining, autoEscape } = tickGrabCountdown(s.countdown, dt);
    s.countdown = remaining;

    // 用戶新#3：被抓 UI 提示 + 倒數秒數（per-player，跟隨玩家頭上）。
    // ★用戶：提示位置接編輯器可調（界騎 b40e388）。偏移讀 resolveGrabHintDisplay（config 層純函式，基準 -90 + editorStore
    //   override layout.grabHint）。此處只做「純顯示定位」讀 offset，不碰抓人邏輯/倒數秒數/掙脫判定/閒置觸發。
    const pc = player.getHitCenter();
    const secs = Math.ceil(remaining);
    const off = resolveGrabHintDisplay(readGrabHintOverride());
    if (!s.hint) {
      s.hint = this.ctx.scene.add
        .text(pc.x + off.offsetX, pc.y + off.offsetY, '', {
          fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
          fontSize: '22px',
          color: '#ffe64d',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 5,
          align: 'center',
        })
        .setOrigin(0.5, 1)
        .setDepth(PANEL_DEPTH + 20);
    }
    s.hint.setPosition(pc.x + off.offsetX, pc.y + off.offsetY);
    s.hint.setScale(off.scale); // 用戶：提示大小可調（scale override）；setScale 等比縮字級+描邊，origin(0.5,1) 底中對齊定位不飄
    s.hint.setText(`按攻擊掙脫！\n${secs}`);
    s.hint.setVisible(true);

    if (shouldEscapeGrab(attackEdge || struggleEdge, dashEdge, autoEscape)) {
      this.escape(player, s);
    }
  }

  /** 掙脫：解除被抓、grabber 被擊退回一般 AI、清 UI。 */
  private escape(player: Player, s: GrabState): void {
    player.setGrabbed(false);
    if (s.grabber && !s.grabber.isDead()) {
      s.grabber.releaseGrabberWithKnockback(player.getHitCenter());
    }
    // 十六輪(追加)：掙脫成功那刻→請求玩家揮一次真攻擊（揮開打退 grabber，非只默默解除；用戶回報）。
    //   grab 已解除(setGrabbed false)→下一幀 PlayerControl 正常流程消費 forcedAttack 揮擊+命中判定。
    this.ctx.requestPlayerAttack?.(player.playerId);
    if (s.hint) { s.hint.destroy(); s.hint = null; } // 清掙脫 UI
    s.grabber = null;
    s.grabbed = false;
    s.countdown = 0;
    s.idle = 0;
    s.wasAttacking = false;
    s.wasDashing = false;
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

/** 被抓提示 override（編輯器可調，additive 附掛 layout.grabHint，同 JP/進度/衝刺做法；界騎 b40e388 位置 + 大小 scale）。 */
interface GrabHintOverride {
  grabHintOffsetX?: number;
  grabHintOffsetY?: number;
  grabHintScale?: number;
}

/**
 * 讀 uiLayout override 裡的被抓提示 override（layout.grabHint，additive 附掛）。
 * 無 override / 無 grabHint 欄 → undefined（resolveGrabHintDisplay 用基準 -90/scale 1，行為不變）。
 * 純讀 localStorage 顯示設定（不碰抓人邏輯/倒數秒數/閒置觸發）。
 */
function readGrabHintOverride(): GrabHintOverride | undefined {
  const raw = loadOverride(EDITOR_STORE_KEYS.uiLayout);
  if (!raw || typeof raw !== 'object') return undefined;
  const g = (raw as { grabHint?: unknown }).grabHint;
  if (!g || typeof g !== 'object') return undefined;
  const o = g as GrabHintOverride;
  return {
    grabHintOffsetX: typeof o.grabHintOffsetX === 'number' ? o.grabHintOffsetX : undefined,
    grabHintOffsetY: typeof o.grabHintOffsetY === 'number' ? o.grabHintOffsetY : undefined,
    grabHintScale: typeof o.grabHintScale === 'number' ? o.grabHintScale : undefined,
  };
}
