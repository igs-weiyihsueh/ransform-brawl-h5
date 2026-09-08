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
    playerId: 0,
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
  onPickup: (item: { pickUp: () => void; source?: string; heroKey?: string }, player: unknown) => void;
  takeSoulDamage: (player: unknown, d: number) => void;
} {
  return sys as unknown as {
    onPickup: (item: { pickUp: () => void; source?: string; heroKey?: string }, player: unknown) => void;
    takeSoulDamage: (player: unknown, d: number) => void;
  };
}

const fakeItem = () => ({ pickUp: vi.fn() });
/** 階段2：英雄變身道具（source='heroDrop'，帶 heroKey）。 */
const heroDropItem = (heroKey: string) => ({ pickUp: vi.fn(), source: 'heroDrop' as const, heroKey });

/**
 * 階段1（角色狀態機重構）：變身入口＝「投幣進場隨機抽英雄」transformToRandomHero。
 *   此 helper 走該入口完成變身（roster 目前只 SunWukong→必抽中），
 *   供既有「變身後行為（魂力/受擊扣魂/退變/回魂）」核心測沿用（下游邏輯不變）。
 */
function transformToHero(sys: TransformSystem, player: { playerId: number }): void {
  sys.transformToRandomHero(player.playerId, () => 0); // rng=0 → 抽 roster[0]（SunWukong）
}

describe('TransformSystem — 變身/魂力', () => {
  it('初始為凡人、魂力 0、soulRatio 0', () => {
    const { sys } = makeSystem();
    expect(sys.isTransformed(0)).toBe(false);
    expect(sys.getSoul(0)).toBe(0);
    expect(sys.getSoulRatio(0)).toBe(0);
  });

  it('投幣進場隨機抽英雄 → 變身、魂力滿、掛扣魂鉤子、金閃（階段1）', () => {
    const { sys, calls, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer);
    expect(sys.isTransformed(0)).toBe(true);
    expect(sys.getSoul(0)).toBe(MAX_SOUL_POWER);
    expect(sys.getSoulRatio(0)).toBe(1);
    expect(calls.switched).toContain('SunWukong');
    expect(calls.sinkSet.at(-1)).toBe(true); // 掛鉤子
    expect(calls.flashes).toBe(1);
  });

  it('變身中受敵人攻擊 → 扣魂力（用 dmg 值）', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // 變身，soul=100
    priv(sys).takeSoulDamage(fakePlayer, 25);
    expect(sys.getSoul(0)).toBe(75);
    priv(sys).takeSoulDamage(fakePlayer, 15);
    expect(sys.getSoul(0)).toBe(60);
  });

  it('變身中再撿道具 → 回復魂力 +50（clamp 100）', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // soul=100
    priv(sys).takeSoulDamage(fakePlayer, 70); // soul=30
    priv(sys).onPickup(fakeItem(), fakePlayer); // 已變身 +50 → 80
    expect(sys.getSoul(0)).toBe(30 + RECOVER_SOUL);
    priv(sys).onPickup(fakeItem(), fakePlayer); // +50 → clamp 100
    expect(sys.getSoul(0)).toBe(MAX_SOUL_POWER);
  });

  // 🔴 壞版必紅對照：魂力歸 0 必須退變（回凡人、清鉤子、soulRatio 0）。
  it('魂力歸 0 → 退變回凡人（清鉤子、換回 Human、soulRatio 0）', () => {
    const { sys, calls, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // 變身 soul=100
    priv(sys).takeSoulDamage(fakePlayer, 100); // 歸 0 → 退變
    expect(sys.isTransformed(0)).toBe(false);
    expect(sys.getSoul(0)).toBe(0);
    expect(sys.getSoulRatio(0)).toBe(0);
    expect(calls.switched.at(-1)).toBe('Human'); // 換回凡人
    expect(calls.sinkSet.at(-1)).toBe(false); // 清鉤子
  });

  // 十五輪：沒 credit 回待機 → revertToHuman 強制退回凡人（對齊 Unity 回待機 revert transform）。
  it('revertToHuman：變身中 → 退回凡人（換 Human、清鉤子、非變身）', () => {
    const { sys, calls, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // 變身
    expect(sys.isTransformed(0)).toBe(true);
    sys.revertToHuman(0); // 沒 credit 回待機呼叫
    expect(sys.isTransformed(0)).toBe(false);
    expect(sys.getSoul(0)).toBe(0);
    expect(calls.switched.at(-1)).toBe('Human'); // 換回凡人
    expect(calls.sinkSet.at(-1)).toBe(false); // 清扣魂鉤子
  });

  it('revertToHuman：未變身 → 冪等不動作（不重複 switchCharacter/flash）', () => {
    const { sys, calls } = makeSystem();
    const switchesBefore = calls.switched.length;
    const flashesBefore = calls.flashes;
    sys.revertToHuman(0);
    expect(sys.isTransformed(0)).toBe(false);
    expect(calls.switched.length).toBe(switchesBefore); // 未變身→不呼 switchCharacter
    expect(calls.flashes).toBe(flashesBefore);
  });

  it('退變後再次進場 → 重新變身（而非回魂）', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer);
    priv(sys).takeSoulDamage(fakePlayer, 100); // 退變
    transformToHero(sys, fakePlayer); // 未變身 → 再變身
    expect(sys.isTransformed(0)).toBe(true);
    expect(sys.getSoul(0)).toBe(MAX_SOUL_POWER);
  });

  // ── 階段2：英雄換英雄（怪掉英雄道具，撿了橫向換英雄） ──
  it('★階段2：英雄態撿英雄道具 → 換成道具帶的英雄 key（switchCharacter+魂力滿）', () => {
    const { sys, calls, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // 先變英雄（SunWukong）
    priv(sys).takeSoulDamage(fakePlayer, 60); // soul=40
    const before = calls.switched.length;
    priv(sys).onPickup(heroDropItem('SunWukong'), fakePlayer); // 撿英雄道具 → 橫向換
    expect(sys.isTransformed(0)).toBe(true);
    expect(sys.getHeroKey(0)).toBe('SunWukong'); // 換成道具帶的英雄
    expect(sys.getSoul(0)).toBe(MAX_SOUL_POWER); // 換英雄魂力重新滿（非 +50 回魂）
    expect(calls.switched.at(-1)).toBe('SunWukong'); // 有 switchCharacter
    expect(calls.switched.length).toBe(before + 1);
  });

  it('★階段2：凡人態撿英雄道具 → 不觸發變身（凡人只能投幣變英雄）', () => {
    const { sys, fakePlayer } = makeSystem();
    expect(sys.isTransformed(0)).toBe(false); // 凡人
    priv(sys).onPickup(heroDropItem('SunWukong'), fakePlayer);
    expect(sys.isTransformed(0)).toBe(false); // 仍凡人、不變身
    expect(sys.getHeroKey(0)).toBeNull();
  });

  it('★階段2：英雄道具帶的 heroKey 決定換成誰（非寫死 SunWukong）', () => {
    const { sys, calls, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer);
    // 帶不同 key（框架驗：換成道具指定的英雄，不寫死）。
    priv(sys).onPickup(heroDropItem('HeroX'), fakePlayer);
    expect(sys.getHeroKey(0)).toBe('HeroX');
    expect(calls.switched.at(-1)).toBe('HeroX');
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
    playerId: 0,
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
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // soul=100
    priv(sys).takeSoulDamage(fakePlayer, 99); // → 1
    expect(sys.getSoul(0)).toBe(1);
    expect(sys.isTransformed(0)).toBe(true); // 1 > 0 → 不退變（邊界另一側）
  });

  it('恰好扣到 0 → 退變（邊界這一側）', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer);
    priv(sys).takeSoulDamage(fakePlayer, 100); // 恰好 0
    expect(sys.getSoul(0)).toBe(0);
    expect(sys.isTransformed(0)).toBe(false);
  });

  it('扣過頭（damage > soul）→ clamp 到 0 不變負、且退變', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer);
    priv(sys).takeSoulDamage(fakePlayer, 9999);
    expect(sys.getSoul(0)).toBe(0); // Math.max(0, ...) clamp
    expect(sys.isTransformed(0)).toBe(false);
  });

  it('RecoverSoul clamp 100：90 + 50 → 100（不是 140）', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // 100
    priv(sys).takeSoulDamage(fakePlayer, 10); // 90
    expect(sys.getSoul(0)).toBe(90);
    priv(sys).onPickup(fakeItem(), fakePlayer); // 已變身 +50 → clamp 100
    expect(sys.getSoul(0)).toBe(100);
  });

  it('未達上限時 RecoverSoul 精確 +50（40 → 90，不 clamp）', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // 100
    priv(sys).takeSoulDamage(fakePlayer, 60); // 40
    priv(sys).onPickup(fakeItem(), fakePlayer); // 已變身 +50 → 90（未觸頂，驗值精確）
    expect(sys.getSoul(0)).toBe(90);
  });
});

describe('TransformSystem — 撿道具分流（已變身只回魂、不換角色不重置）', () => {
  it('已變身撿道具：只 +50 魂力，【不】再 switchCharacter、【不】重掛/清鉤子造成重變', () => {
    const { sys, calls, player } = makeSystemTracking();
    transformToHero(sys, player); // 第一次：變身
    expect(calls.switched).toEqual(['SunWukong']); // 只切一次
    const switchesAfterTransform = calls.switched.length;
    const flashesAfterTransform = calls.flashes;

    priv(sys).takeSoulDamage(player, 30); // soul=70
    priv(sys).onPickup(fakeItem(), player); // 已變身 → 只回魂
    expect(sys.getSoul(0)).toBe(100); // 70+50 clamp 100
    // 規格重點：不換角色（switched 不再增加）、不再金閃重變。
    expect(calls.switched.length).toBe(switchesAfterTransform);
    expect(calls.switched.at(-1)).toBe('SunWukong'); // 仍是悟空，沒被切走
    expect(calls.flashes).toBe(flashesAfterTransform); // 沒有第二次變身金閃
    expect(sys.isTransformed(0)).toBe(true);
  });

  it('投幣進場隨機抽英雄：switchCharacter=SunWukong、魂力滿（階段1）', () => {
    const { sys, calls, player } = makeSystemTracking();
    transformToHero(sys, player);
    expect(calls.switched).toEqual(['SunWukong']);
    expect(sys.getSoul(0)).toBe(100);
  });
});

describe('TransformSystem × EnergySystem — 模式/倍率隨變身切換（跨系統純邏輯）', () => {
  // 用同一個「會更新 charKey」的 player，接真的 EnergySystem，驗變身/退變後
  // EnergySystem 讀到的模式/倍率確實跟著切。這是跨系統但純邏輯、可決定性驗證。
  function wire() {
    const { sys, player, state } = makeSystemTracking();
    const energy = new EnergySystem();
    energy.init({ player, players: [player] } as unknown as GameContext);
    return { sys, energy, state, player };
  }

  it('變身 → 角色 SunWukong → EnergySystem 讀到 Full(cap4) + 倍率 1.0', () => {
    const { sys, energy, state, player } = wire();
    transformToHero(sys, player); // 變身 → switchCharacter('SunWukong')
    expect(state.charKey).toBe('SunWukong');
    // 倍率：EnergySystem.resolveAttackIntent 的 multiplier 由 profile 決定。
    expect(energy.resolveAttackIntent(0).multiplier).toBe(1.0);
    expect(energy.getMax(0)).toBe(4);
  });

  it('退變 → 角色 Human → EnergySystem 讀回 HumanSimple + 倍率 0.5', () => {
    const { sys, energy, state, player } = wire();
    transformToHero(sys, player); // 變身
    priv(sys).takeSoulDamage(player, 100); // 退變 → switchCharacter('Human')
    expect(state.charKey).toBe('Human');
    expect(energy.resolveAttackIntent(0).multiplier).toBe(0.5);
    expect(energy.getMax(0)).toBe(4); // 兩者 cap 皆 4，但模式/倍率不同
  });

  it('倍率確實隨變身在 1.0 / 0.5 間切換（同一 EnergySystem 前後讀到不同值）', () => {
    const { sys, energy, player } = wire();
    const before = energy.resolveAttackIntent(0).multiplier; // 凡人 0.5
    transformToHero(sys, player); // 變身
    const during = energy.resolveAttackIntent(0).multiplier; // 悟空 1.0
    priv(sys).takeSoulDamage(player, 100); // 退變
    const after = energy.resolveAttackIntent(0).multiplier; // 凡人 0.5
    expect(before).toBe(0.5);
    expect(during).toBe(1.0);
    expect(after).toBe(0.5);
  });
});

describe('TransformSystem — 退變後狀態乾淨、可重新變身', () => {
  it('退變後：清鉤子(sinkSet 最後為 false)、soulRatio 0、可再撿再變且魂力滿', () => {
    const { sys, calls, player } = makeSystemTracking();
    transformToHero(sys, player); // 變身
    priv(sys).takeSoulDamage(player, 100); // 退變
    expect(sys.isTransformed(0)).toBe(false);
    expect(sys.getSoulRatio(0)).toBe(0);
    expect(calls.sinkSet.at(-1)).toBe(false); // 鉤子已清

    // 再撿 → 重新變身，狀態乾淨（滿魂、重掛鉤子）。
    transformToHero(sys, player);
    expect(sys.isTransformed(0)).toBe(true);
    expect(sys.getSoul(0)).toBe(MAX_SOUL_POWER);
    expect(sys.getSoulRatio(0)).toBe(1);
    expect(calls.sinkSet.at(-1)).toBe(true); // 重新掛鉤子
    expect(calls.switched).toEqual(['SunWukong', 'Human', 'SunWukong']); // 變→退→再變
  });

  it('退變後受攻擊不再扣魂（鉤子已清 → takeSoulDamage 因未變身直接 return）', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer);
    priv(sys).takeSoulDamage(fakePlayer, 100); // 退變，soul=0
    priv(sys).takeSoulDamage(fakePlayer, 50); // 未變身 → guard return，不變負、不影響
    expect(sys.getSoul(0)).toBe(0);
    expect(sys.isTransformed(0)).toBe(false);
  });
});
