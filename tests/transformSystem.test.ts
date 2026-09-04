// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MAX_SOUL_POWER, RECOVER_SOUL } from '@/config/transformConfig';
import type { GameContext } from '@/systems/GameContext';
import { TransformSystem } from '@/systems/TransformSystem';

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
