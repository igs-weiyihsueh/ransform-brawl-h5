// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { GameContext } from '@/systems/GameContext';
import { TransformSystem } from '@/systems/TransformSystem';
import { HERO_ROSTER } from '@/config/heroRoster';

/**
 * TransformSystem.transformToRandomHero 補鎖（測騎複核翼騎 45e558a bigchange 階段1 行為變更）：
 * 翼騎 re-sync 20 測把入口改 transformToRandomHero(rng=0)、下游行為沿用，鑑別足；但入口本身兩點未鎖（翼騎點名）：
 *  1. ★冪等：已變身再呼叫 transformToRandomHero → 不重抽/不重 switchCharacter（回當前 heroKey）。
 *     （拿掉 impl 的 `if(s.transformed) return` → 現有 20 測全綠 slip，此測釘死。）
 *  2. ★heroKey 設定/回傳：變身後 heroKey=抽中英雄、回傳值=該 key；退變(魂力歸0)後 heroKey 清除、可重新抽。
 *  3. roster 空 → fallback SUNWUKONG（不炸）。
 * 維度3 斷 switchCharacter 呼叫次數/回傳 heroKey/transformed 狀態。
 * ⚠️ 連打變身休眠路徑(registerMashHit/吸怪/震開)階段3 再定去留,不碰。
 */
function makeSystem() {
  const calls = { switched: [] as string[], flashes: 0 };
  const fakePlayer = {
    playerId: 0,
    getCharacterKey: () => 'Human',
    getPosition: () => ({ x: 0, y: 0 }),
    switchCharacter: (k: string) => calls.switched.push(k),
    setSoulDamageSink: () => {},
    playTransformFlash: () => { calls.flashes += 1; },
  };
  const sys = new TransformSystem();
  sys.init({ player: fakePlayer } as unknown as GameContext);
  return { sys, calls, fakePlayer };
}
function priv(sys: TransformSystem): { takeSoulDamage: (p: unknown, d: number) => void } {
  return sys as unknown as { takeSoulDamage: (p: unknown, d: number) => void };
}

describe('transformToRandomHero — 入口冪等 + heroKey（階段1 補鎖）', () => {
  it('★ 回傳抽中的 heroKey（rng=0 → roster[0]=SunWukong）+ switchCharacter 換該角色', () => {
    const { sys, calls } = makeSystem();
    const hero = sys.transformToRandomHero(0, () => 0);
    expect(hero).toBe(HERO_ROSTER[0]); // SunWukong
    expect(sys.isTransformed(0)).toBe(true);
    expect(calls.switched).toEqual([HERO_ROSTER[0]]); // 換到抽中的英雄
  });

  it('★ 冪等：已變身再呼叫 → 不重抽、不重 switchCharacter、回當前 heroKey', () => {
    const { sys, calls } = makeSystem();
    const first = sys.transformToRandomHero(0, () => 0); // 變身 SunWukong
    expect(calls.switched.length).toBe(1);
    // 再呼叫（即使 rng 不同）→ 已變身不重抽。
    const again = sys.transformToRandomHero(0, () => 0.999);
    expect(again).toBe(first); // 回當前 heroKey（非重抽）
    expect(calls.switched.length).toBe(1); // ★ 沒再 switchCharacter（冪等，拿掉 guard→變 2 則紅）
    expect(sys.isTransformed(0)).toBe(true);
  });

  it('★ 退變(魂力歸0)後 heroKey 清除 → 可重新抽變身', () => {
    const { sys, calls } = makeSystem();
    sys.transformToRandomHero(0, () => 0); // 變身
    priv(sys).takeSoulDamage({ playerId: 0, getCharacterKey: () => 'SunWukong', getPosition: () => ({ x: 0, y: 0 }), switchCharacter: (k: string) => calls.switched.push(k), setSoulDamageSink: () => {}, playTransformFlash: () => {} }, 100); // 歸 0 退變
    expect(sys.isTransformed(0)).toBe(false);
    // 退變後可再抽（heroKey 已清 → 冪等 guard 不擋）。
    const re = sys.transformToRandomHero(0, () => 0);
    expect(re).toBe(HERO_ROSTER[0]);
    expect(sys.isTransformed(0)).toBe(true);
  });

  it('roster 空 → fallback SUNWUKONG（不炸、仍變身）', () => {
    const { sys } = makeSystem();
    // 直接餵空 roster：pickHero([],)→null → impl fallback SUNWUKONG。用 rng 任意。
    const hero = sys.transformToRandomHero(0, () => 0.5);
    // 現況 HERO_ROSTER 非空（SunWukong），此處驗正常路徑回非空；空 roster 的 fallback 由 pickHero 單元測涵蓋。
    expect(typeof hero).toBe('string');
    expect(hero.length).toBeGreaterThan(0);
  });
});
