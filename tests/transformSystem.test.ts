// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MAX_SOUL_POWER, RECOVER_SOUL } from '@/config/transformConfig';
import type { GameContext } from '@/systems/GameContext';
import { TransformSystem } from '@/systems/TransformSystem';
import { EnergySystem } from '@/systems/EnergySystem';

/**
 * TransformSystem 魂力/變身狀態測試（決策 15fec2a4）。
 *
 * 用 fake player 記錄 switchCharacter / setSoulDamageSink / flash 呼叫，不需 Phaser。
 * 透過反射呼叫 private onPickup/takeSoulDamage 驗核心狀態機（避免 spawnItem 需 scene）。
 * 含壞版必紅對照：魂力歸 0 必須退變。
 */
function makeSystem() {
  const calls = {
    switched: [] as string[],
    sinkSet: [] as boolean[],
    flashes: 0,
  };
  const fakePlayer = {
    getCharacterKey: () => 'Human',
    getPosition: () => ({ x: 0, y: 0 }),
    switchCharacter: (k: string) => calls.switched.push(k),
    setSoulDamageSink: (s: unknown) => calls.sinkSet.push(s !== null),
    playTransformFlash: () => {
      calls.flashes += 1;
    },
  };
  const sys = new TransformSystem();
  sys.init({ player: fakePlayer } as unknown as GameContext);
  return { sys, calls, fakePlayer };
}

// 透過型別逃逸呼叫 private 方法（測試核心狀態機）。
function priv(sys: TransformSystem): {
  onPickup: (item: { pickUp: () => void }) => void;
  takeSoulDamage: (d: number) => void;
} {
  return sys as unknown as {
    onPickup: (item: { pickUp: () => void }) => void;
    takeSoulDamage: (d: number) => void;
  };
}

const fakeItem = () => ({ pickUp: vi.fn() });

describe('TransformSystem — 變身/魂力', () => {
  it('初始為凡人、魂力 0、soulRatio 0', () => {
    const { sys } = makeSystem();
    expect(sys.isTransformed()).toBe(false);
    expect(sys.getSoul()).toBe(0);
    expect(sys.getSoulRatio()).toBe(0);
  });

  it('未變身撿道具 → 變身悟空、魂力滿、掛扣魂鉤子、金閃', () => {
    const { sys, calls } = makeSystem();
    priv(sys).onPickup(fakeItem());
    expect(sys.isTransformed()).toBe(true);
    expect(sys.getSoul()).toBe(MAX_SOUL_POWER);
    expect(sys.getSoulRatio()).toBe(1);
    expect(calls.switched).toContain('SunWukong');
    expect(calls.sinkSet.at(-1)).toBe(true); // 掛鉤子
    expect(calls.flashes).toBe(1);
  });

  it('變身中受敵人攻擊 → 扣魂力（用 dmg 值）', () => {
    const { sys } = makeSystem();
    priv(sys).onPickup(fakeItem()); // 變身，soul=100
    priv(sys).takeSoulDamage(25);
    expect(sys.getSoul()).toBe(75);
    priv(sys).takeSoulDamage(15);
    expect(sys.getSoul()).toBe(60);
  });

  it('變身中再撿道具 → 回復魂力 +50（clamp 100）', () => {
    const { sys } = makeSystem();
    priv(sys).onPickup(fakeItem()); // soul=100
    priv(sys).takeSoulDamage(70); // soul=30
    priv(sys).onPickup(fakeItem()); // +50 → 80
    expect(sys.getSoul()).toBe(30 + RECOVER_SOUL);
    priv(sys).onPickup(fakeItem()); // +50 → clamp 100
    expect(sys.getSoul()).toBe(MAX_SOUL_POWER);
  });

  // 🔴 壞版必紅對照：魂力歸 0 必須退變（回凡人、清鉤子、soulRatio 0）。
  it('魂力歸 0 → 退變回凡人（清鉤子、換回 Human、soulRatio 0）', () => {
    const { sys, calls } = makeSystem();
    priv(sys).onPickup(fakeItem()); // 變身 soul=100
    priv(sys).takeSoulDamage(100); // 歸 0 → 退變
    expect(sys.isTransformed()).toBe(false);
    expect(sys.getSoul()).toBe(0);
    expect(sys.getSoulRatio()).toBe(0);
    expect(calls.switched.at(-1)).toBe('Human'); // 換回凡人
    expect(calls.sinkSet.at(-1)).toBe(false); // 清鉤子
  });

  it('退變後再撿道具 → 重新變身（而非回魂）', () => {
    const { sys } = makeSystem();
    priv(sys).onPickup(fakeItem());
    priv(sys).takeSoulDamage(100); // 退變
    priv(sys).onPickup(fakeItem()); // 未變身 → 再變身
    expect(sys.isTransformed()).toBe(true);
    expect(sys.getSoul()).toBe(MAX_SOUL_POWER);
  });
});

// ===========================================================================
// 深度強化（QA 測騎接手）：魂力邊界 / 撿道具分流 / 模式倍率隨變身切換 / 重變狀態乾淨。
// ===========================================================================

/** 進階 fake player：會【真的更新】自己的 characterKey（反映 switchCharacter），
 *  讓後面「接 EnergySystem 讀模式/倍率」的跨系統純邏輯測試成立。 */
function makeSystemTracking() {
  const state = { charKey: 'Human' };
  const calls = { switched: [] as string[], sinkSet: [] as boolean[], flashes: 0 };
  const player = {
    getCharacterKey: () => state.charKey,
    getPosition: () => ({ x: 0, y: 0 }),
    switchCharacter: (k: string) => {
      state.charKey = k; // 真的切，讓 getCharacterKey 反映
      calls.switched.push(k);
    },
    setSoulDamageSink: (s: unknown) => calls.sinkSet.push(s !== null),
    playTransformFlash: () => {
      calls.flashes += 1;
    },
  };
  const sys = new TransformSystem();
  sys.init({ player } as unknown as GameContext);
  return { sys, calls, player, state };
}

describe('TransformSystem — 魂力邊界（恰好 0 vs 1、clamp0、clamp100）', () => {
  it('扣到剩 1（未歸 0）→ 仍變身、soul=1', () => {
    const { sys } = makeSystem();
    priv(sys).onPickup(fakeItem()); // soul=100
    priv(sys).takeSoulDamage(99); // → 1
    expect(sys.getSoul()).toBe(1);
    expect(sys.isTransformed()).toBe(true); // 1 > 0 → 不退變（邊界另一側）
  });

  it('恰好扣到 0 → 退變（邊界這一側）', () => {
    const { sys } = makeSystem();
    priv(sys).onPickup(fakeItem());
    priv(sys).takeSoulDamage(100); // 恰好 0
    expect(sys.getSoul()).toBe(0);
    expect(sys.isTransformed()).toBe(false);
  });

  it('扣過頭（damage > soul）→ clamp 到 0 不變負、且退變', () => {
    const { sys } = makeSystem();
    priv(sys).onPickup(fakeItem());
    priv(sys).takeSoulDamage(9999);
    expect(sys.getSoul()).toBe(0); // Math.max(0, ...) clamp
    expect(sys.isTransformed()).toBe(false);
  });

  it('RecoverSoul clamp 100：90 + 50 → 100（不是 140）', () => {
    const { sys } = makeSystem();
    priv(sys).onPickup(fakeItem()); // 100
    priv(sys).takeSoulDamage(10); // 90
    expect(sys.getSoul()).toBe(90);
    priv(sys).onPickup(fakeItem()); // +50 → clamp 100
    expect(sys.getSoul()).toBe(100);
  });

  it('未達上限時 RecoverSoul 精確 +50（40 → 90，不 clamp）', () => {
    const { sys } = makeSystem();
    priv(sys).onPickup(fakeItem()); // 100
    priv(sys).takeSoulDamage(60); // 40
    priv(sys).onPickup(fakeItem()); // +50 → 90（未觸頂，驗值精確）
    expect(sys.getSoul()).toBe(90);
  });
});

describe('TransformSystem — 撿道具分流（已變身只回魂、不換角色不重置）', () => {
  it('已變身撿道具：只 +50 魂力，【不】再 switchCharacter、【不】重掛/清鉤子造成重變', () => {
    const { sys, calls } = makeSystemTracking();
    priv(sys).onPickup(fakeItem()); // 第一次：變身
    expect(calls.switched).toEqual(['SunWukong']); // 只切一次
    const switchesAfterTransform = calls.switched.length;
    const flashesAfterTransform = calls.flashes;

    priv(sys).takeSoulDamage(30); // soul=70
    priv(sys).onPickup(fakeItem()); // 已變身 → 只回魂
    expect(sys.getSoul()).toBe(100); // 70+50 clamp 100
    // 規格重點：不換角色（switched 不再增加）、不再金閃重變。
    expect(calls.switched.length).toBe(switchesAfterTransform);
    expect(calls.switched.at(-1)).toBe('SunWukong'); // 仍是悟空，沒被切走
    expect(calls.flashes).toBe(flashesAfterTransform); // 沒有第二次變身金閃
    expect(sys.isTransformed()).toBe(true);
  });

  it('未變身撿道具：走變身分流（switchCharacter=SunWukong、魂力滿）', () => {
    const { sys, calls } = makeSystemTracking();
    priv(sys).onPickup(fakeItem());
    expect(calls.switched).toEqual(['SunWukong']);
    expect(sys.getSoul()).toBe(100);
  });
});

describe('TransformSystem × EnergySystem — 模式/倍率隨變身切換（跨系統純邏輯）', () => {
  // 用同一個「會更新 charKey」的 player，接真的 EnergySystem，驗變身/退變後
  // EnergySystem 讀到的模式/倍率確實跟著切。這是跨系統但純邏輯、可決定性驗證。
  function wire() {
    const { sys, player, state } = makeSystemTracking();
    const energy = new EnergySystem();
    energy.init({ player } as unknown as GameContext);
    return { sys, energy, state };
  }

  it('變身 → 角色 SunWukong → EnergySystem 讀到 Full(cap4) + 倍率 1.0', () => {
    const { sys, energy, state } = wire();
    priv(sys).onPickup(fakeItem()); // 變身 → switchCharacter('SunWukong')
    expect(state.charKey).toBe('SunWukong');
    // 倍率：EnergySystem.resolveAttackIntent 的 multiplier 由 profile 決定。
    expect(energy.resolveAttackIntent().multiplier).toBe(1.0);
    expect(energy.getMax()).toBe(4);
  });

  it('退變 → 角色 Human → EnergySystem 讀回 HumanSimple + 倍率 0.5', () => {
    const { sys, energy, state } = wire();
    priv(sys).onPickup(fakeItem()); // 變身
    priv(sys).takeSoulDamage(100); // 退變 → switchCharacter('Human')
    expect(state.charKey).toBe('Human');
    expect(energy.resolveAttackIntent().multiplier).toBe(0.5);
    expect(energy.getMax()).toBe(4); // 兩者 cap 皆 4，但模式/倍率不同
  });

  it('倍率確實隨變身在 1.0 / 0.5 間切換（同一 EnergySystem 前後讀到不同值）', () => {
    const { sys, energy } = wire();
    const before = energy.resolveAttackIntent().multiplier; // 凡人 0.5
    priv(sys).onPickup(fakeItem()); // 變身
    const during = energy.resolveAttackIntent().multiplier; // 悟空 1.0
    priv(sys).takeSoulDamage(100); // 退變
    const after = energy.resolveAttackIntent().multiplier; // 凡人 0.5
    expect(before).toBe(0.5);
    expect(during).toBe(1.0);
    expect(after).toBe(0.5);
  });
});

describe('TransformSystem — 退變後狀態乾淨、可重新變身', () => {
  it('退變後：清鉤子(sinkSet 最後為 false)、soulRatio 0、可再撿再變且魂力滿', () => {
    const { sys, calls } = makeSystemTracking();
    priv(sys).onPickup(fakeItem()); // 變身
    priv(sys).takeSoulDamage(100); // 退變
    expect(sys.isTransformed()).toBe(false);
    expect(sys.getSoulRatio()).toBe(0);
    expect(calls.sinkSet.at(-1)).toBe(false); // 鉤子已清

    // 再撿 → 重新變身，狀態乾淨（滿魂、重掛鉤子）。
    priv(sys).onPickup(fakeItem());
    expect(sys.isTransformed()).toBe(true);
    expect(sys.getSoul()).toBe(MAX_SOUL_POWER);
    expect(sys.getSoulRatio()).toBe(1);
    expect(calls.sinkSet.at(-1)).toBe(true); // 重新掛鉤子
    expect(calls.switched).toEqual(['SunWukong', 'Human', 'SunWukong']); // 變→退→再變
  });

  it('退變後受攻擊不再扣魂（鉤子已清 → takeSoulDamage 因未變身直接 return）', () => {
    const { sys } = makeSystem();
    priv(sys).onPickup(fakeItem());
    priv(sys).takeSoulDamage(100); // 退變，soul=0
    priv(sys).takeSoulDamage(50); // 未變身 → guard return，不變負、不影響
    expect(sys.getSoul()).toBe(0);
    expect(sys.isTransformed()).toBe(false);
  });
});
