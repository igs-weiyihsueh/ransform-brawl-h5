// @vitest-environment jsdom
/**
 * 多人遷移 Stage 4 測試 — per-player 獨立鑑別（S4 核心）+ AIController 純邏輯。
 * 翼騎 S4 = 35f4956（AI InputSource + F2/3/4 加 P2-P4 + PlayerControl iterate players[]）。
 *
 * 🔴 這是 per-player 獨立鑑別的主場（S1-S3 結構上只有 P1、證不了；S4 才有 P2-P4）：
 *   證明 P1/P2 各自 Map 那筆【互不汙染】—— 對 P1 動作不改 P2 的 Credit/COMBO/能量/魂力，反之亦然。
 *   壞版必紅：若系統忽略 playerId（恆用 0 / 共用一筆）→ P2 動作汙染 P1 → 獨立鑑別測試紅。
 *
 * ⚠️ 明確排除彩票（顧問③a）：S4 只測 Credit/COMBO/能量/變身四系統的 per-player 獨立。
 *   彩票 S3 沒 keying、AI 票暫併全域池（暫時），彩票獨立鑑別留 S5。這裡不寫「AI 彩票各自」。
 */
import { describe, expect, it } from 'vitest';
import { STARTING_CREDIT } from '@/config/creditConfig';
import { AI_CONFIG } from '@/config/aiConfig';
import { CreditSystem } from '@/systems/CreditSystem';
import { ComboSystem } from '@/systems/ComboSystem';
import { EnergySystem } from '@/systems/EnergySystem';
import { TransformSystem } from '@/systems/TransformSystem';
import { AIController } from '@/systems/AIController';
import { PPU } from '@/config/gameConfig';
import type { GameContext } from '@/systems/GameContext';

// ===========================================================================
// Part 1：per-player 獨立 — Credit / COMBO / 能量（各自 Map 不互汙）。
// ===========================================================================

/** 兩個 fake player（P1 id0 human、P2 id1）供 profileOf 依 playerId 找角色。 */
function twoPlayers(charKey = 'Human') {
  const p1 = { playerId: 0, kind: 'human' as const, getCharacterKey: () => charKey };
  const p2 = { playerId: 1, kind: 'ai' as const, getCharacterKey: () => charKey };
  return { p1, p2 };
}

describe('S4 — Credit per-player 獨立（P1/P2 各自 Map 不互汙）', () => {
  function makeCredit() {
    const sys = new CreditSystem();
    const ctx = {
      input: { justPressedCoin: () => false },
      player: { playerId: 0, setOutOfCreditTint: () => {} },
    } as unknown as GameContext;
    sys.init(ctx);
    return sys;
  }

  it('對 P1 命中扣 credit → P1 減 1、P2 不變（起始值）', () => {
    const sys = makeCredit();
    const p1Before = sys.getCredit(0);
    const p2Before = sys.getCredit(1);
    sys.consumeOnHit(0);
    expect(sys.getCredit(0)).toBe(p1Before - 1);
    expect(sys.getCredit(1)).toBe(p2Before); // P2 不受 P1 影響
  });

  it('對 P2 命中扣 credit → P2 減 1、P1 不變', () => {
    const sys = makeCredit();
    const p1Before = sys.getCredit(0);
    sys.consumeOnHit(1);
    expect(sys.getCredit(1)).toBe(STARTING_CREDIT - 1);
    expect(sys.getCredit(0)).toBe(p1Before); // P1 不受 P2 影響
  });

  it('P1 扣到耗盡 → 只 P1 isOutOfCredit，P2 仍可攻擊/行動', () => {
    const sys = makeCredit();
    for (let i = 0; i < STARTING_CREDIT; i += 1) sys.consumeOnHit(0);
    expect(sys.isOutOfCredit(0)).toBe(true);
    expect(sys.canAttack(0)).toBe(false);
    expect(sys.isOutOfCredit(1)).toBe(false); // P2 獨立
    expect(sys.canAttack(1)).toBe(true);
    expect(sys.canAct(1)).toBe(true);
  });
});

describe('S4 — COMBO per-player 獨立', () => {
  function makeCombo() {
    const sys = new ComboSystem();
    const ctx = {
      credit: { isOutOfCredit: () => false },
      ticket: { addTickets: () => {} },
      getEnemies: () => [null], // 非凍結
    } as unknown as GameContext;
    sys.init(ctx);
    return sys;
  }

  it('對 P1 命中累積 → P1 combo+1、P2 combo 不變', () => {
    const sys = makeCombo();
    sys.onHit(0);
    sys.onHit(0);
    expect(sys.getCombo(0)).toBe(2);
    expect(sys.getCombo(1)).toBe(0); // P2 獨立
  });

  it('P1、P2 各自累積互不干擾', () => {
    const sys = makeCombo();
    sys.onHit(0);
    sys.onHit(1);
    sys.onHit(1);
    expect(sys.getCombo(0)).toBe(1);
    expect(sys.getCombo(1)).toBe(2);
  });
});

describe('S4 — 能量 per-player 獨立', () => {
  function makeEnergy() {
    const { p1, p2 } = twoPlayers('Human');
    const sys = new EnergySystem();
    const ctx = {
      player: p1,
      players: [p1, p2], // profileOf 依 playerId find
    } as unknown as GameContext;
    sys.init(ctx);
    return sys;
  }

  it('對 P1 普攻命中充能 → P1 energy+1、P2 energy 不變', () => {
    const sys = makeEnergy();
    sys.reportHit(0, false, true);
    expect(sys.getEnergy(0)).toBe(1);
    expect(sys.getEnergy(1)).toBe(0); // P2 獨立
  });

  it('P1、P2 各自充能互不干擾', () => {
    const sys = makeEnergy();
    sys.reportHit(0, false, true);
    sys.reportHit(1, false, true);
    sys.reportHit(1, false, true);
    expect(sys.getEnergy(0)).toBe(1);
    expect(sys.getEnergy(1)).toBe(2);
  });
});

describe('S4 — 變身/魂力 per-player 獨立', () => {
  function makeTransform() {
    const sys = new TransformSystem();
    sys.init({ player: { playerId: 0 } } as unknown as GameContext);
    return sys;
  }
  // fake player（供 private transform/takeSoulDamage 用；state 依 playerId keying）。
  const fakePlayer = (id: number) => ({
    playerId: id,
    getCharacterKey: () => 'Human',
    switchCharacter: () => {},
    setSoulDamageSink: () => {},
    playTransformFlash: () => {},
  });
  function priv(sys: TransformSystem) {
    return sys as unknown as {
      transform: (p: unknown) => void;
      takeSoulDamage: (p: unknown, d: number) => void;
    };
  }

  it('P1 變身受擊扣魂 → 只 P1 魂力降，P2 未變身/魂 0 不受影響', () => {
    const sys = makeTransform();
    const p1 = fakePlayer(0);
    priv(sys).transform(p1); // P1 變身 soul=100
    priv(sys).takeSoulDamage(p1, 30); // P1 soul=70
    expect(sys.getSoul(0)).toBe(70);
    expect(sys.isTransformed(1)).toBe(false); // P2 獨立、未變身
    expect(sys.getSoul(1)).toBe(0);
  });

  it('P1、P2 各自變身魂力互不干擾', () => {
    const sys = makeTransform();
    const p1 = fakePlayer(0);
    const p2 = fakePlayer(1);
    priv(sys).transform(p1);
    priv(sys).transform(p2);
    priv(sys).takeSoulDamage(p1, 40); // P1 60
    expect(sys.getSoul(0)).toBe(60);
    expect(sys.getSoul(1)).toBe(100); // P2 未被 P1 扣魂影響
  });
});

// ===========================================================================
// Part 2：AIController 純邏輯（目標選擇 / 黏著 / 攻擊態遲滯 / 移動意圖）。
// ===========================================================================

/** fake enemy（getHitCenter/isDead）。 */
function fakeEnemy(x: number, y: number, dead = false) {
  return { getHitCenter: () => ({ x, y }), isDead: () => dead };
}
/** fake self player（getPosition/playerId/faceTowards）。 */
function fakeSelf(id: number, x = 0, y = 0) {
  const faces: number[] = [];
  return {
    playerId: id,
    getPosition: () => ({ x, y }),
    faceTowards: (tx: number) => faces.push(tx),
    _faces: faces,
  };
}
/** fake ctx：getEnemies + scene.game.getFrame/loop.delta（AIController 用）。可推進 frame/dt。 */
function makeAiCtx(enemies: unknown[]) {
  const state = { frame: 0, deltaMs: 16 };
  const ctx = {
    getEnemies: () => enemies,
    scene: {
      game: {
        getFrame: () => state.frame,
        loop: { get delta() { return state.deltaMs; } },
      },
    },
  } as unknown as GameContext;
  return { ctx, state };
}

describe('AIController — 目標選擇（依 playerId 選第 N 近，分散）', () => {
  it('P2(id1) offset=max(0,1-1)=0 → 選最近敵人；移動意圖朝它', () => {
    const near = fakeEnemy(100, 0); // 近
    const far = fakeEnemy(500, 0); // 遠
    const { ctx, state } = makeAiCtx([far, near]);
    const self = fakeSelf(1, 0, 0);
    const ai = new AIController(ctx, self as never);
    state.frame = 1;
    const mv = ai.getMoveVector(); // think → 選最近(near, x=100)
    // 追擊態朝目標：near 在右 → x 正規化為 +1（dist=100 > attackRange 120px? 100<120 → 攻擊態→停）
    // near dist=100px < attackRange(1.2*100=120) → 進攻擊態 → getMoveVector 回 0（攻擊態停）。
    expect(mv).toEqual({ x: 0, y: 0 });
    expect(self._faces.at(-1)).toBe(100); // 面向目標
  });

  it('P3(id2) offset=1 → 選第 2 近敵人（分散各 AI 目標）', () => {
    const e1 = fakeEnemy(300, 0); // 最近
    const e2 = fakeEnemy(600, 0); // 第 2 近
    const { ctx, state } = makeAiCtx([e1, e2]);
    const self = fakeSelf(2, 0, 0); // P3
    const ai = new AIController(ctx, self as never);
    state.frame = 1;
    ai.getMoveVector(); // think → 選 e2(第2近)；e2 dist=600 > 追擊
    // 追擊態朝 e2（x=600 在右）→ 移動正規化 +x。
    const mv = ai.getMoveVector();
    expect(mv.x).toBeCloseTo(1);
    expect(self._faces.at(-1)).toBe(600); // 面向第 2 近
  });

  it('無敵人 → 無目標、移動意圖 0、不攻擊', () => {
    const { ctx, state } = makeAiCtx([]);
    const self = fakeSelf(1, 0, 0);
    const ai = new AIController(ctx, self as never);
    state.frame = 1;
    expect(ai.getMoveVector()).toEqual({ x: 0, y: 0 });
    expect(ai.justPressedAttack()).toBe(false);
  });
});

describe('AIController — 攻擊態遲滯（Schmitt）+ 攻擊 edge', () => {
  it('遠處 → 追擊態（移動朝目標、不攻擊）；近到 attackRange 內 → 攻擊態（停、面向）', () => {
    const enemy = fakeEnemy(500, 0);
    const { ctx, state } = makeAiCtx([enemy]);
    const self = fakeSelf(1, 0, 0);
    const ai = new AIController(ctx, self as never);
    state.frame = 1;
    const mvFar = ai.getMoveVector(); // dist=500 > 120 → 追擊 → 朝目標
    expect(mvFar.x).toBeCloseTo(1);
    // 敵人移到攻擊距離內（100px < 120）。
    const near = fakeEnemy(100, 0);
    const { ctx: ctx2, state: st2 } = makeAiCtx([near]);
    const self2 = fakeSelf(1, 0, 0);
    const ai2 = new AIController(ctx2, self2 as never);
    st2.frame = 1;
    expect(ai2.getMoveVector()).toEqual({ x: 0, y: 0 }); // 攻擊態 → 停
  });

  it('攻擊態 + attackInterval 到期 → justPressedAttack 一次性 edge（讀後清）', () => {
    const near = fakeEnemy(100, 0); // 攻擊距離內
    const { ctx, state } = makeAiCtx([near]);
    const self = fakeSelf(1, 0, 0);
    const ai = new AIController(ctx, self as never);
    // 推進足夠時間讓 attackTimer(0.6s) 到期：delta 用大值。
    state.deltaMs = 700; // 0.7s > attackInterval 0.6
    state.frame = 1;
    ai.getMoveVector(); // think：進攻擊態 + attackTimer -=0.7 → <=0 → pendingAttack
    expect(ai.justPressedAttack()).toBe(true); // edge
    // 同幀再讀（frame 沒變 → 不重 think）→ 已被消耗。
    expect(ai.justPressedAttack()).toBe(false);
  });

  it('justPressedDash 恆 false（AI 不衝刺）', () => {
    const { ctx } = makeAiCtx([fakeEnemy(100, 0)]);
    const ai = new AIController(ctx, fakeSelf(1) as never);
    expect(ai.justPressedDash()).toBe(false);
  });
});
