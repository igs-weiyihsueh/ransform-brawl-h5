// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MAX_SOUL_POWER } from '@/config/transformConfig';
import type { GameContext } from '@/systems/GameContext';
import { TransformSystem } from '@/systems/TransformSystem';
import { EnergySystem } from '@/systems/EnergySystem';

/**
 * TransformSystem 變身狀態測試（決策 15fec2a4）。
 *
 * 用 fake player 記錄 switchCharacter / setSoulDamageSink / flash 呼叫，不需 Phaser。
 * 透過反射呼叫 private onPickup 驗核心狀態機（避免 spawnItem 需 scene）。
 *
 * ★大更動回歸修(#2)：角色無血量、被打不該回凡人。舊「受擊扣魂力→歸0 detransform」機制已移除：
 *   - transform() 不再掛 soulDamageSink（改 setSoulDamageSink(null)）；takeSoulDamage 方法已刪。
 *   - 被打改只扣二段能量（loseSecondTransformEnergy，clamp 0、歸零仍維持英雄，見 secondTransformMath/loseSecondEnergy 測）。
 *   - detransform 只由 credit 耗盡的 revertToHuman 走。
 *   - soul（getSoul/getSoulRatio）成 vestigial：變身後恆滿(MAX)，被打不降；revertToHuman 才歸 0。
 *   舊魂力扣減/歸0退變/魂力邊界測 → 改斷新設計行為（被打仍 hero、只 revertToHuman 退變）。
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

// 透過型別逃逸呼叫 private 方法（測試核心狀態機）。takeSoulDamage 已刪（大更動#2），不再逃逸。
function priv(sys: TransformSystem): {
  onPickup: (item: { pickUp: () => void; source?: string; heroKey?: string }, player: unknown) => void;
} {
  return sys as unknown as {
    onPickup: (item: { pickUp: () => void; source?: string; heroKey?: string }, player: unknown) => void;
  };
}

const fakeItem = () => ({ pickUp: vi.fn() });
/** 階段2：英雄變身道具（source='heroDrop'，帶 heroKey）。 */
const heroDropItem = (heroKey: string) => ({ pickUp: vi.fn(), source: 'heroDrop' as const, heroKey });

/**
 * 階段1（角色狀態機重構）：變身入口＝「投幣進場隨機抽英雄」transformToRandomHero。
 *   此 helper 走該入口完成變身（roster 目前只 SunWukong→必抽中），
 *   供既有「變身後行為（回魂/退變）」核心測沿用（下游邏輯不變）。
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

  it('投幣進場隨機抽英雄 → 變身、魂力滿、金閃；★不再掛扣魂鉤子（大更動#2，sink=null）', () => {
    const { sys, calls, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer);
    expect(sys.isTransformed(0)).toBe(true);
    expect(sys.getSoul(0)).toBe(MAX_SOUL_POWER);
    expect(sys.getSoulRatio(0)).toBe(1);
    expect(calls.switched).toContain('SunWukong');
    expect(calls.sinkSet.at(-1)).toBe(false); // ★大更動#2：不再掛扣魂鉤子（setSoulDamageSink(null)）
    expect(calls.flashes).toBe(1);
  });

  it('★大更動#2：變身後「被打」不扣魂力、不退變（角色無血量，仍是英雄、soul 恆滿）', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // 變身，soul=100
    // 被打的傷害改走二段能量（loseSecondTransformEnergy），不動 soul、不 detransform。
    // soul 已無扣減路徑（takeSoulDamage 已刪）→ 恆滿。
    expect(sys.getSoul(0)).toBe(MAX_SOUL_POWER);
    expect(sys.isTransformed(0)).toBe(true);
    expect(sys.getSoulRatio(0)).toBe(1);
  });

  it('變身中再撿一般道具 → 回魂 +50 邏輯仍在（soul 已滿故 clamp 100、仍變身）', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // soul=100
    priv(sys).onPickup(fakeItem(), fakePlayer); // 已變身 +50 → clamp 100
    expect(sys.getSoul(0)).toBe(MAX_SOUL_POWER);
    expect(sys.isTransformed(0)).toBe(true);
  });

  // ★大更動#2：detransform 只由 credit 耗盡的 revertToHuman 走（被打不退變）。
  it('revertToHuman：變身中 → 退回凡人（換 Human、soul 歸 0、soulRatio 0、非變身）', () => {
    const { sys, calls, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // 變身 soul=100
    sys.revertToHuman(0); // credit 耗盡回待機
    expect(sys.isTransformed(0)).toBe(false);
    expect(sys.getSoul(0)).toBe(0);
    expect(sys.getSoulRatio(0)).toBe(0);
    expect(calls.switched.at(-1)).toBe('Human'); // 換回凡人
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

  it('退變(revertToHuman)後再次進場 → 重新變身（而非回魂）、魂力滿', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer);
    sys.revertToHuman(0); // 退變
    transformToHero(sys, fakePlayer); // 未變身 → 再變身
    expect(sys.isTransformed(0)).toBe(true);
    expect(sys.getSoul(0)).toBe(MAX_SOUL_POWER);
  });

  // ── 階段2：英雄換英雄（怪掉英雄道具，撿了橫向換英雄） ──
  it('★階段2：英雄態撿英雄道具 → 換成道具帶的英雄 key（switchCharacter+魂力滿）', () => {
    const { sys, calls, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // 先變英雄（SunWukong），soul=100
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

describe('TransformSystem — 魂力 vestigial（大更動#2 後：被打不降、只 revertToHuman 歸 0）', () => {
  it('變身後 soul 恆滿、被打無扣減路徑（takeSoulDamage 已刪）→ 仍變身、soul=MAX', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // soul=100
    // 大更動#2：無任何路徑扣 soul（被打改扣二段能量）→ soul 恆 MAX。
    expect(sys.getSoul(0)).toBe(MAX_SOUL_POWER);
    expect(sys.getSoulRatio(0)).toBe(1);
    expect(sys.isTransformed(0)).toBe(true);
  });

  it('revertToHuman → soul clamp 0、soulRatio 0、退回凡人（唯一 detransform 路徑）', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer);
    sys.revertToHuman(0);
    expect(sys.getSoul(0)).toBe(0);
    expect(sys.getSoulRatio(0)).toBe(0);
    expect(sys.isTransformed(0)).toBe(false);
  });

  it('RecoverSoul：變身後撿道具 +50 邏輯仍在（soul 已滿 → clamp 100，不超過）', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer); // 100
    priv(sys).onPickup(fakeItem(), fakePlayer); // 已變身 +50 → clamp 100（不是 150）
    expect(sys.getSoul(0)).toBe(MAX_SOUL_POWER);
  });

  it('未變身撿道具 → 不回魂（soul 維持 0、不變身）', () => {
    const { sys, fakePlayer } = makeSystem();
    priv(sys).onPickup(fakeItem(), fakePlayer); // 凡人撿一般道具 → no-op
    expect(sys.getSoul(0)).toBe(0);
    expect(sys.isTransformed(0)).toBe(false);
  });
});

describe('TransformSystem — 撿道具分流（已變身只回魂、不換角色不重置）', () => {
  it('已變身撿一般道具：回魂邏輯執行但【不】再 switchCharacter、【不】重掛/清鉤子造成重變', () => {
    const { sys, calls, player } = makeSystemTracking();
    transformToHero(sys, player); // 第一次：變身
    expect(calls.switched).toEqual(['SunWukong']); // 只切一次
    const switchesAfterTransform = calls.switched.length;
    const flashesAfterTransform = calls.flashes;

    priv(sys).onPickup(fakeItem(), player); // 已變身 → 只回魂（soul 已滿 clamp 100）
    expect(sys.getSoul(0)).toBe(100);
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
    sys.revertToHuman(0); // ★大更動#2：退變只由 revertToHuman（credit 耗盡）走 → switchCharacter('Human')
    expect(state.charKey).toBe('Human');
    expect(energy.resolveAttackIntent(0).multiplier).toBe(0.5);
    expect(energy.getMax(0)).toBe(4); // 兩者 cap 皆 4，但模式/倍率不同
  });

  it('倍率確實隨變身在 1.0 / 0.5 間切換（同一 EnergySystem 前後讀到不同值）', () => {
    const { sys, energy, player } = wire();
    const before = energy.resolveAttackIntent(0).multiplier; // 凡人 0.5
    transformToHero(sys, player); // 變身
    const during = energy.resolveAttackIntent(0).multiplier; // 悟空 1.0
    sys.revertToHuman(0); // 退變
    const after = energy.resolveAttackIntent(0).multiplier; // 凡人 0.5
    expect(before).toBe(0.5);
    expect(during).toBe(1.0);
    expect(after).toBe(0.5);
  });
});

describe('TransformSystem — 退變後狀態乾淨、可重新變身', () => {
  it('退變(revertToHuman)後：soulRatio 0、sink 維持清空(false)、可再進場再變且魂力滿', () => {
    const { sys, calls, player } = makeSystemTracking();
    transformToHero(sys, player); // 變身
    sys.revertToHuman(0); // ★大更動#2：退變只由 revertToHuman 走
    expect(sys.isTransformed(0)).toBe(false);
    expect(sys.getSoulRatio(0)).toBe(0);
    expect(calls.sinkSet.at(-1)).toBe(false); // 大更動#2：全程無掛鉤子（transform/detransform 都 setSoulDamageSink(null)）

    // 再進場 → 重新變身，狀態乾淨（滿魂）。
    transformToHero(sys, player);
    expect(sys.isTransformed(0)).toBe(true);
    expect(sys.getSoul(0)).toBe(MAX_SOUL_POWER);
    expect(sys.getSoulRatio(0)).toBe(1);
    expect(calls.sinkSet.at(-1)).toBe(false); // ★大更動#2：仍不掛鉤子（sink=null）
    expect(calls.switched).toEqual(['SunWukong', 'Human', 'SunWukong']); // 變→退→再變
  });

  it('★大更動#2：被打不再扣魂/不退變（無 takeSoulDamage 路徑）→ 變身後被打仍 hero、soul 滿', () => {
    const { sys, fakePlayer } = makeSystem();
    transformToHero(sys, fakePlayer);
    // 舊「受擊扣魂→歸0退變」已移除；被打改扣二段能量（見 loseSecondEnergy 測），不動 soul、不退變。
    expect(sys.getSoul(0)).toBe(MAX_SOUL_POWER);
    expect(sys.isTransformed(0)).toBe(true);
  });
});
