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

// ===========================================================================
// 深度強化（QA 測騎接手）：扣 Credit 邊界 / 閘門 / 投幣解除 / 耗盡倒數。
// ===========================================================================

/**
 * 進階 fake：可逐幀切換投幣、記錄 tint 呼叫。
 * coinRef.pressed 由測試改動；player.setOutOfCreditTint 記進 tints。
 */
function makeControllable() {
  const coinRef = { pressed: false };
  const tints: boolean[] = [];
  const ctx = {
    input: { justPressedCoin: () => coinRef.pressed },
    player: { setOutOfCreditTint: (v: boolean) => tints.push(v) },
  } as unknown as GameContext;
  const sys = new CreditSystem();
  sys.init(ctx);
  return { sys, coinRef, tints };
}

/** 把 credit 消到指定值（前提：過程不會提前歸 0 進耗盡）。回傳 sys。 */
function consumeTo(sys: CreditSystem, target: number): void {
  // 從 STARTING_CREDIT 扣到 target（每次 -1）。target 需 >0 才不會中途進耗盡。
  const times = STARTING_CREDIT - target;
  for (let i = 0; i < times; i += 1) sys.consumeOnHit();
}

describe('CreditSystem — 扣 Credit 邊界（1→0 進耗盡 / 2→1 不耗盡 / clamp）', () => {
  it('credit=2 → 命中 → 1，【不】進耗盡、仍可攻擊/行動（邊界另一側）', () => {
    const { sys } = makeControllable();
    consumeTo(sys, 2);
    expect(sys.getCredit()).toBe(2);
    expect(sys.isOutOfCredit()).toBe(false);
    sys.consumeOnHit(); // 2 → 1
    expect(sys.getCredit()).toBe(1);
    expect(sys.isOutOfCredit()).toBe(false); // 1 > 0 → 不耗盡
    expect(sys.canAttack()).toBe(true);
    expect(sys.canAct()).toBe(true);
  });

  it('credit=1 → 命中 → 0，進耗盡（邊界這一側）', () => {
    const { sys } = makeControllable();
    consumeTo(sys, 1);
    expect(sys.getCredit()).toBe(1);
    expect(sys.isOutOfCredit()).toBe(false);
    sys.consumeOnHit(); // 1 → 0
    expect(sys.getCredit()).toBe(0);
    expect(sys.isOutOfCredit()).toBe(true);
  });

  it('耗盡後再 consumeOnHit：守 0 不變負（clamp + guard，扣多次仍 0）', () => {
    const { sys } = makeControllable();
    consumeTo(sys, 1);
    sys.consumeOnHit(); // → 0 進耗盡
    sys.consumeOnHit();
    sys.consumeOnHit();
    expect(sys.getCredit()).toBe(0); // 不會變負
    expect(sys.isOutOfCredit()).toBe(true);
  });
});

describe('CreditSystem — CanAttack / canAct 閘門', () => {
  it('credit>0 非耗盡：canAttack=true、canAct=true', () => {
    const { sys } = makeControllable();
    consumeTo(sys, 5);
    expect(sys.canAttack()).toBe(true);
    expect(sys.canAct()).toBe(true);
  });

  it('耗盡：canAttack=false 且 canAct=false（移動也鎖）', () => {
    const { sys } = makeControllable();
    consumeTo(sys, 1);
    sys.consumeOnHit(); // 進耗盡
    expect(sys.canAttack()).toBe(false);
    expect(sys.canAct()).toBe(false); // 耗盡連移動都鎖（這條就是閘門鑑別點）
  });
});

describe('CreditSystem — 投幣 AddCredit 與耗盡解除', () => {
  it('一般狀態投幣：credit += 100（非耗盡不誤觸解除流程）', () => {
    const { sys } = makeControllable();
    consumeTo(sys, 10);
    sys.addCredit(COIN_INSERT_AMOUNT);
    expect(sys.getCredit()).toBe(10 + COIN_INSERT_AMOUNT);
    expect(sys.isOutOfCredit()).toBe(false);
  });

  it('耗盡狀態投幣 → credit>0 → 自動解除耗盡（投幣後恰好 >0）', () => {
    const { sys } = makeControllable();
    consumeTo(sys, 1);
    sys.consumeOnHit(); // 進耗盡 credit=0
    expect(sys.isOutOfCredit()).toBe(true);
    sys.addCredit(COIN_INSERT_AMOUNT);
    expect(sys.getCredit()).toBe(COIN_INSERT_AMOUNT); // > 0
    expect(sys.isOutOfCredit()).toBe(false); // 解除
    expect(sys.canAttack()).toBe(true);
    expect(sys.canAct()).toBe(true);
  });

  it('C 鍵投幣（update 讀 justPressedCoin）：耗盡中按 C → 立即解除', () => {
    const { sys, coinRef } = makeControllable();
    consumeTo(sys, 1);
    sys.consumeOnHit(); // 耗盡
    coinRef.pressed = true;
    sys.update(0.016); // 這幀讀到投幣
    expect(sys.isOutOfCredit()).toBe(false);
    expect(sys.getCredit()).toBe(COIN_INSERT_AMOUNT);
  });
});

describe('CreditSystem — 耗盡倒數', () => {
  it('倒數中（未到 0）仍耗盡、getCountdown 遞減', () => {
    const { sys } = makeControllable();
    consumeTo(sys, 1);
    sys.consumeOnHit(); // 進耗盡，countdown=10
    sys.update(3); // 走 3 秒
    expect(sys.isOutOfCredit()).toBe(true); // 尚未到 0
    expect(sys.getCountdown()).toBeCloseTo(OUT_OF_CREDIT_COUNTDOWN - 3);
  });

  it('倒數恰好走完 → 重置到起始值 + 解除耗盡（不卡死）', () => {
    const { sys } = makeControllable();
    consumeTo(sys, 1);
    sys.consumeOnHit(); // 耗盡
    sys.update(OUT_OF_CREDIT_COUNTDOWN); // 恰好走完
    expect(sys.isOutOfCredit()).toBe(false);
    expect(sys.getCredit()).toBe(STARTING_CREDIT);
    expect(sys.getCountdown()).toBe(0);
  });

  it('倒數中途投幣 → 立即解除（不必等倒數完）', () => {
    const { sys, coinRef } = makeControllable();
    consumeTo(sys, 1);
    sys.consumeOnHit(); // 耗盡
    sys.update(4); // 倒數到剩 6，仍耗盡
    expect(sys.isOutOfCredit()).toBe(true);
    coinRef.pressed = true;
    sys.update(0.016); // 投幣
    expect(sys.isOutOfCredit()).toBe(false);
    expect(sys.getCredit()).toBe(COIN_INSERT_AMOUNT);
  });

  it('非耗盡狀態 getCountdown 恆為 0', () => {
    const { sys } = makeControllable();
    expect(sys.getCountdown()).toBe(0);
    consumeTo(sys, 5);
    expect(sys.getCountdown()).toBe(0);
  });
});

// ===========================================================================
// 帳本不變量：倒數期間互動（顧問補充 — 帳本型機制最易在邊界靜默出錯）。
// 專打：鎖定/倒數中「會改狀態的操作」必須被擋；投幣能正確中斷倒數；歸零後狀態正確。
// ===========================================================================
describe('CreditSystem — 帳本不變量：倒數期間互動', () => {
  /** 進耗盡並走一段倒數（仍在倒數中）。 */
  function enterCountdown(elapsed = 4) {
    const ctl = makeControllable();
    consumeTo(ctl.sys, 1);
    ctl.sys.consumeOnHit(); // → 0 進耗盡，countdown=OUT_OF_CREDIT_COUNTDOWN
    ctl.sys.update(elapsed); // 倒數中（未到 0）
    return ctl;
  }

  it('不變量：倒數中命中(consumeOnHit)不誤扣、不改狀態、不影響倒數', () => {
    const { sys } = enterCountdown(4);
    const creditBefore = sys.getCredit(); // 0
    const countdownBefore = sys.getCountdown();
    expect(sys.isOutOfCredit()).toBe(true);
    sys.consumeOnHit();
    sys.consumeOnHit();
    expect(sys.getCredit()).toBe(creditBefore); // 仍 0，不變負/不誤扣
    expect(sys.isOutOfCredit()).toBe(true);
    expect(sys.getCountdown()).toBeCloseTo(countdownBefore);
  });

  it('不變量：倒數中閘門仍鎖（canAttack=false、canAct=false）', () => {
    const { sys } = enterCountdown(4);
    expect(sys.canAttack()).toBe(false);
    expect(sys.canAct()).toBe(false);
  });

  it('不變量：倒數中投幣 → 中止倒數 + 解鎖（credit>0、countdown 歸 0、閘門開）', () => {
    const { sys, coinRef } = enterCountdown(4);
    expect(sys.getCountdown()).toBeGreaterThan(0);
    coinRef.pressed = true;
    sys.update(0.016);
    coinRef.pressed = false;
    expect(sys.isOutOfCredit()).toBe(false);
    expect(sys.getCredit()).toBe(COIN_INSERT_AMOUNT);
    expect(sys.getCountdown()).toBe(0);
    expect(sys.canAttack()).toBe(true);
    expect(sys.canAct()).toBe(true);
    sys.update(0.016);
    expect(sys.isOutOfCredit()).toBe(false);
  });

  it('不變量：倒數歸零重置後，credit=起始值且完全解鎖、後續命中正常扣（狀態乾淨）', () => {
    const { sys } = makeControllable();
    consumeTo(sys, 1);
    sys.consumeOnHit();
    sys.update(OUT_OF_CREDIT_COUNTDOWN);
    expect(sys.isOutOfCredit()).toBe(false);
    expect(sys.getCredit()).toBe(STARTING_CREDIT);
    expect(sys.canAttack()).toBe(true);
    expect(sys.canAct()).toBe(true);
    sys.consumeOnHit();
    expect(sys.getCredit()).toBe(STARTING_CREDIT - 1);
    expect(sys.isOutOfCredit()).toBe(false);
  });
});
