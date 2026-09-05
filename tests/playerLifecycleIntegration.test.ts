// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CreditSystem } from '@/systems/CreditSystem';
import {
  COIN_INSERT_AMOUNT,
  CREDIT_PER_HIT,
  OUT_OF_CREDIT_COUNTDOWN,
  STARTING_CREDIT,
} from '@/config/creditConfig';
import {
  canControlWhenActive,
  shouldEnterOnCoin,
  shouldReturnToWaiting,
  type LifecycleState,
} from '@/systems/playerLifecycle';
import type { GameContext } from '@/systems/GameContext';

/**
 * 投幣進場循環 — 整合/系統層測試（項目3 重做，用戶投幣循環決策）。
 *
 * 翼騎 playerLifecycle.test 已覆蓋純函式 7 顆（shouldEnterOnCoin/tick clamp/
 * shouldReturnToWaiting/canControlWhenActive）——複核=扎實，含 3 壞版對照，不重寫。
 * 這裡補【整合層】：把 CreditSystem（真的跑耗盡倒數/justExpired/per-player）與
 * playerLifecycle 狀態機組起來，斷「可觀察狀態」的完整循環：
 *   開場 waiting → 投幣進場(active) → 命中扣 Credit → 耗盡凍結 → 倒數10秒 → 歸零回 waiting。
 * 維度3：斷 isWaiting/Credit/凍結(canAct·canAttack) 實際狀態，非 call-count。
 *
 * ⚠️ 純狀態層（node 環境），不碰 Phaser 動畫/座標（那在 Player entity，需 jsdom boot，
 *    非本測涵蓋——手感/落點動畫不在此保證）。
 */

/** 迷你玩家：帶 playerId + lifecycle 狀態 + tint 記錄（CreditSystem 會呼叫 setOutOfCreditTint）。 */
class FakePlayer {
  lifecycle: LifecycleState = 'waiting';
  tints: boolean[] = [];
  constructor(public readonly playerId: number) {}
  setOutOfCreditTint(v: boolean): void {
    this.tints.push(v);
  }
  isWaiting(): boolean {
    return this.lifecycle === 'waiting';
  }
}

/** 建 per-player CreditSystem + 多人 fake ctx（含 coinRef 逐幀切投幣，只作用 P1=本地）。 */
function makeLoop(playerCount = 1) {
  const coinRef = { pressed: false };
  const players = Array.from({ length: playerCount }, (_, i) => new FakePlayer(i));
  const ctx = {
    input: { justPressedCoin: () => coinRef.pressed },
    player: players[0],
    players,
  } as unknown as GameContext;
  const sys = new CreditSystem();
  sys.init(ctx);
  return { sys, players, coinRef, ctx };
}

/** 把某 player 的 credit 扣到耗盡（進 outOfCredit）。 */
function drainToExhaust(sys: CreditSystem, playerId: number): void {
  for (let i = 0; i < STARTING_CREDIT + 1; i += 1) {
    if (sys.isOutOfCredit(playerId)) break;
    sys.consumeOnHit(playerId);
  }
}

describe('投幣進場循環 — 整合（CreditSystem × playerLifecycle 狀態機）', () => {
  it('開場：玩家 lifecycle=waiting（在待機區、shouldEnterOnCoin=true 等投幣）', () => {
    const { players } = makeLoop(1);
    expect(players[0].lifecycle).toBe('waiting');
    expect(players[0].isWaiting()).toBe(true);
    expect(shouldEnterOnCoin(players[0].lifecycle)).toBe(true); // waiting → 投幣可進場
  });

  it('投幣進場：waiting 投幣 → 離開 waiting（active）；active 再投幣不重複進場', () => {
    const { players } = makeLoop(1);
    const p = players[0];
    // waiting 投幣 → 進場
    if (shouldEnterOnCoin(p.lifecycle)) p.lifecycle = 'active';
    expect(p.isWaiting()).toBe(false);
    expect(p.lifecycle).toBe('active');
    // active 投幣 → 不重複進場（維持 active）
    if (shouldEnterOnCoin(p.lifecycle)) p.lifecycle = 'entering';
    expect(p.lifecycle).toBe('active');
  });

  it('active 命中扣 Credit：非耗盡可操控、扣到 0 進耗盡→凍結(canControlWhenActive=false)', () => {
    const { sys } = makeLoop(1);
    expect(canControlWhenActive(sys.isOutOfCredit(0))).toBe(true); // 開場非耗盡可控
    sys.consumeOnHit(0);
    expect(sys.getCredit(0)).toBe(STARTING_CREDIT - CREDIT_PER_HIT);
    drainToExhaust(sys, 0);
    expect(sys.isOutOfCredit(0)).toBe(true);
    // 耗盡 → 凍結：不可操控、不可攻擊。
    expect(canControlWhenActive(sys.isOutOfCredit(0))).toBe(false);
    expect(sys.canAct(0)).toBe(false);
    expect(sys.canAttack(0)).toBe(false);
  });

  it('耗盡 → 倒數 10 秒 → 歸零回 waiting（justExpired 觸發 lifecycle=waiting、credit 維持0）', () => {
    const { sys, players } = makeLoop(1);
    const p = players[0];
    p.lifecycle = 'active';
    drainToExhaust(sys, 0);
    expect(sys.isOutOfCredit(0)).toBe(true);
    expect(sys.getCountdown(0)).toBeCloseTo(OUT_OF_CREDIT_COUNTDOWN);
    // 倒數中途（走 9 秒）仍耗盡、尚未回待機。
    sys.update(9);
    expect(sys.isOutOfCredit(0)).toBe(true);
    expect(shouldReturnToWaiting(true, sys.getCountdown(0))).toBe(false); // 還在倒數
    // 再走過 10 秒門檻 → 歸零。
    sys.update(1.1);
    expect(sys.isOutOfCredit(0)).toBe(false);
    expect(sys.getCredit(0)).toBe(0); // ⚠️ 不自動補
    // 消費 justExpired → 回待機（模擬 PlayerControl 讀後 ReturnToWaiting）。
    if (sys.consumeJustExpired(0)) p.lifecycle = 'waiting';
    expect(p.isWaiting()).toBe(true);
    expect(shouldEnterOnCoin(p.lifecycle)).toBe(true); // 回待機、需重投幣
  });

  it('倒數中途投幣 → 立即解除耗盡（不必等倒數完，投幣循環中途救回）', () => {
    const { sys } = makeLoop(1);
    drainToExhaust(sys, 0);
    sys.update(4); // 倒數到剩 ~6，仍耗盡
    expect(sys.isOutOfCredit(0)).toBe(true);
    sys.addCredit(0, COIN_INSERT_AMOUNT); // 投幣
    expect(sys.isOutOfCredit(0)).toBe(false); // 立即解除
    expect(sys.getCredit(0)).toBe(COIN_INSERT_AMOUNT);
    expect(sys.getCountdown(0)).toBe(0);
    expect(sys.canAttack(0)).toBe(true);
  });
});

describe('投幣進場循環 — per-player 獨立（多人各自 waiting/進場/耗盡）', () => {
  it('P0 耗盡回待機時，P1 不受影響（各自 Credit/耗盡/lifecycle 獨立）', () => {
    const { sys, players } = makeLoop(2);
    const [p0, p1] = players;
    p0.lifecycle = 'active';
    p1.lifecycle = 'active';
    // 只把 P0 打到耗盡。
    drainToExhaust(sys, 0);
    expect(sys.isOutOfCredit(0)).toBe(true);
    expect(sys.isOutOfCredit(1)).toBe(false); // P1 獨立、沒耗盡
    expect(sys.getCredit(1)).toBe(STARTING_CREDIT); // P1 credit 沒被動到
    // 倒數歸零：P0 回待機、P1 仍 active 可玩。
    sys.update(OUT_OF_CREDIT_COUNTDOWN + 0.1);
    if (sys.consumeJustExpired(0)) p0.lifecycle = 'waiting';
    expect(sys.consumeJustExpired(1)).toBe(false); // P1 沒過期
    expect(p0.isWaiting()).toBe(true);
    expect(p1.isWaiting()).toBe(false); // P1 仍在場
    expect(sys.canAttack(1)).toBe(true); // P1 照玩
  });

  it('P1 單獨耗盡倒數不影響 P0：各自倒數獨立', () => {
    const { sys } = makeLoop(2);
    drainToExhaust(sys, 1);
    expect(sys.isOutOfCredit(1)).toBe(true);
    expect(sys.isOutOfCredit(0)).toBe(false);
    sys.update(OUT_OF_CREDIT_COUNTDOWN + 0.1);
    expect(sys.consumeJustExpired(1)).toBe(true); // P1 回待機信號
    expect(sys.consumeJustExpired(0)).toBe(false); // P0 從未耗盡
    expect(sys.getCredit(0)).toBe(STARTING_CREDIT); // P0 全程不受影響
  });
});
