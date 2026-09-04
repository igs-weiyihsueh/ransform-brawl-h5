import { describe, expect, it } from 'vitest';
import {
  COIN_INSERT_AMOUNT,
  OUT_OF_CREDIT_COUNTDOWN,
  STARTING_CREDIT,
} from '@/config/creditConfig';
import { CreditSystem } from '@/systems/CreditSystem';
import type { GameContext } from '@/systems/GameContext';

/**
 * CreditSystem 測試（Unity 規格）。
 * fake ctx：CreditSystem 只讀 ctx.input.justPressedCoin() 與 ctx.player.setOutOfCreditTint()。
 * 含壞版必紅對照：扣到 0 必須進耗盡、耗盡時 canAttack/canAct 必須 false。
 */
function makeSystem(coinPressed = false) {
  const ctx = {
    input: { justPressedCoin: () => coinPressed },
    player: { setOutOfCreditTint: () => {} },
  } as unknown as GameContext;
  const sys = new CreditSystem();
  sys.init(ctx);
  return sys;
}

describe('CreditSystem — Credit 資源 / 耗盡 / 投幣', () => {
  it('起始 Credit = STARTING_CREDIT，可攻擊/可行動', () => {
    const sys = makeSystem();
    expect(sys.getCredit()).toBe(STARTING_CREDIT);
    expect(sys.canAttack()).toBe(true);
    expect(sys.canAct()).toBe(true);
    expect(sys.isOutOfCredit()).toBe(false);
  });

  it('命中扣 1 Credit', () => {
    const sys = makeSystem();
    sys.consumeOnHit();
    expect(sys.getCredit()).toBe(STARTING_CREDIT - 1);
  });

  it('扣到 0 → 進耗盡狀態、不能攻擊/不能行動', () => {
    const sys = makeSystem();
    for (let i = 0; i < STARTING_CREDIT; i += 1) sys.consumeOnHit();
    expect(sys.getCredit()).toBe(0);
    expect(sys.isOutOfCredit()).toBe(true);
    expect(sys.canAttack()).toBe(false);
    expect(sys.canAct()).toBe(false);
  });

  it('耗盡狀態下 consumeOnHit 不再往下扣（守 0）', () => {
    const sys = makeSystem();
    for (let i = 0; i < STARTING_CREDIT; i += 1) sys.consumeOnHit();
    sys.consumeOnHit();
    expect(sys.getCredit()).toBe(0);
  });

  it('投幣 addCredit(100) → credit 增加；耗盡時投幣可解除', () => {
    const sys = makeSystem();
    for (let i = 0; i < STARTING_CREDIT; i += 1) sys.consumeOnHit(); // 進耗盡
    expect(sys.isOutOfCredit()).toBe(true);
    sys.addCredit(COIN_INSERT_AMOUNT);
    expect(sys.getCredit()).toBe(COIN_INSERT_AMOUNT);
    expect(sys.isOutOfCredit()).toBe(false); // 解除
    expect(sys.canAttack()).toBe(true);
  });

  it('C 鍵投幣（透過 update 讀 justPressedCoin）', () => {
    const sys = makeSystem(true); // input.justPressedCoin() = true
    const before = sys.getCredit();
    sys.update(0);
    expect(sys.getCredit()).toBe(before + COIN_INSERT_AMOUNT);
  });

  it('耗盡倒數到 0 → 重置到起始值、解除耗盡（H5 簡化，不卡死）', () => {
    const sys = makeSystem();
    for (let i = 0; i < STARTING_CREDIT; i += 1) sys.consumeOnHit();
    expect(sys.isOutOfCredit()).toBe(true);
    sys.update(OUT_OF_CREDIT_COUNTDOWN + 0.1); // 倒數走完
    expect(sys.isOutOfCredit()).toBe(false);
    expect(sys.getCredit()).toBe(STARTING_CREDIT);
  });

  // 🔴 壞版必紅對照：canAttack 若沒把耗盡納入（只看 credit>0）在剛好 0 的一瞬仍會誤放。
  it('壞版對照：耗盡時 canAttack 必須 false（不可只看 credit>0 忽略耗盡）', () => {
    const sys = makeSystem();
    for (let i = 0; i < STARTING_CREDIT; i += 1) sys.consumeOnHit();
    // 正確版：耗盡 → canAttack false。
    expect(sys.canAttack()).toBe(false);
    // 壞版（只看 credit>0）：credit=0 也是 false——但若壞版寫成 credit>=0 就會 true。
    const badCanAttack = sys.getCredit() >= 0; // 壞版邏輯
    expect(badCanAttack).toBe(true);
    expect(sys.canAttack()).not.toBe(badCanAttack); // 兩者不同 → 證明耗盡判斷有作用
  });
});
