// @vitest-environment jsdom
/**
 * GrabSystem 排除尖塔（征騎，魔尖塔修）：塔是靜止建築，不該被選為 grabber、不該被拖去抓玩家。
 *
 * 真根因：塔 moveSpeed=0，但 GrabSystem 挑最近敵人當 grabber 時沒排除 isTower→塔被選→
 *   updateGrabberChase 用 grabberChaseStep(GRABBER_SPEED_PX) 無視 moveSpeed 強制拖塔衝玩家+抓「按攻擊掙脫」。
 * 修：combatEnemies.filter 加 !e.isTower()。
 *
 * 壞版必紅：只有塔在場時，閒置滿門檻 → 塔被 setGrabber(true) → 紅（本測期望塔永不被選）。
 */
import { describe, expect, it } from 'vitest';
import { GrabSystem } from '@/systems/GrabSystem';
import { getResolvedGrabIdleTriggerSec } from '@/config/grabSchema';
import type { GameContext } from '@/systems/GameContext';

interface FakeEnemy {
  tower: boolean;
  grabber: boolean;
  x: number;
  y: number;
  isDead(): boolean;
  isGrabber(): boolean;
  isTower(): boolean;
  setGrabber(v: boolean): void;
  setGrabberLocked?(v: boolean): void;
  getHitCenter(): { x: number; y: number };
  getHitRadius(): number;
  moveTo(x: number, y: number): void;
}

function makeEnemy(opts: { tower?: boolean; x?: number; y?: number }): FakeEnemy {
  return {
    tower: opts.tower ?? false,
    grabber: false,
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    isDead() { return false; },
    isGrabber() { return this.grabber; },
    isTower() { return this.tower; },
    setGrabber(v: boolean) { this.grabber = v; },
    getHitCenter() { return { x: this.x, y: this.y }; },
    getHitRadius() { return 30; },
    moveTo(x: number, y: number) { this.x = x; this.y = y; },
  };
}

function makePlayer() {
  return {
    playerId: 0,
    isEntering() { return false; },
    isWaiting() { return false; },
    isOutOfCredit() { return false; },
    isAttacking() { return false; },
    isDashing() { return false; },
    getHitCenter() { return { x: 640, y: 400 }; },
    getHitRadius() { return 40; },
    setGrabbed() {},
  };
}

function makeSys(enemies: FakeEnemy[]) {
  const player = makePlayer();
  const ctx = {
    players: [player],
    getEnemies: () => enemies,
    combo: { getCombo: () => 0 }, // 沒命中 → idle 一直累積
  } as unknown as GameContext;
  const sys = new GrabSystem();
  sys.init(ctx);
  return { sys, player };
}

/** 推進到 grabber 被選出的那刻就停（避免後續 chase→抓→建 UI hint 需要真 scene）。 */
function advancePastIdle(sys: GrabSystem, enemies: FakeEnemy[]) {
  const trigger = getResolvedGrabIdleTriggerSec();
  const steps = Math.ceil((trigger + 1) / 0.1) + 2;
  for (let i = 0; i < steps; i += 1) {
    sys.update(0.1);
    if (enemies.some((e) => e.isGrabber())) break; // 一有 grabber 被選就停
  }
}

describe('GrabSystem 排除尖塔', () => {
  it('★只有塔在場：閒置滿門檻，塔永不被選為 grabber（不被拖去抓）', () => {
    const tower = makeEnemy({ tower: true, x: 640, y: 300 });
    const { sys } = makeSys([tower]);
    advancePastIdle(sys, [tower]);
    expect(tower.isGrabber()).toBe(false); // 塔不被選
  });

  it('塔 + 普通怪同場：只有普通怪被選 grabber，塔不被選', () => {
    const tower = makeEnemy({ tower: true, x: 640, y: 300 }); // 離玩家更近
    const mob = makeEnemy({ tower: false, x: 640, y: 200 });
    const { sys } = makeSys([tower, mob]);
    advancePastIdle(sys, [tower, mob]);
    expect(tower.isGrabber()).toBe(false);
    expect(mob.isGrabber()).toBe(true); // 普通怪照常被選
  });
});
