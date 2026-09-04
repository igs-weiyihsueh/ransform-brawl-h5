// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import Phaser from 'phaser';
import { getGuardPreset, GUARD_FALLBACK, GUARD_PRESETS } from '@/config/guardConfig';
import { GuardTarget } from '@/entities/GuardTarget';

/**
 * 守護波測試（決策 76f235e4）：guardConfig 預設查詢 + GuardTarget HP/敗判定。
 * 含壞版必紅：查無預設用 fallback 不炸、HP 歸 0 翻敗、hpRatio。
 * GuardTarget 需 Phaser 場景 → jsdom + 一個最小 headless game 的 scene。
 */
describe('getGuardPreset — 名稱查詢 + fallback', () => {
  it('Guard60 查得到正確數值', () => {
    const p = getGuardPreset('Guard60');
    expect(p.timeLimit).toBe(60);
    expect(p.targetHP).toBe(100);
    expect(p.rewardTickets).toBe(10);
    expect(p).toBe(GUARD_PRESETS.Guard60);
  });

  it('查無預設 → 用 fallback（不炸）', () => {
    expect(getGuardPreset('Nope')).toBe(GUARD_FALLBACK);
    expect(getGuardPreset(undefined)).toBe(GUARD_FALLBACK);
  });
});

describe('GuardTarget — HP / 敗判定 / hpRatio', () => {
  let game: Phaser.Game;
  let scene: Phaser.Scene;

  function withScene(fn: (s: Phaser.Scene) => void): Promise<void> {
    return new Promise((resolve) => {
      class T extends Phaser.Scene {
        constructor() {
          super({ key: 'T' });
        }
        create() {
          scene = this;
          fn(this);
          resolve();
        }
      }
      game = new Phaser.Game({
        type: Phaser.HEADLESS,
        width: 100,
        height: 100,
        scene: [T],
        audio: { noAudio: true },
        banner: false,
      });
    });
  }

  it('初始 HP 滿、未敗、hpRatio 1', async () => {
    await withScene(() => {});
    const t = new GuardTarget(scene, 0, 0, 100);
    expect(t.getHp()).toBe(100);
    expect(t.isDefeated()).toBe(false);
    expect(t.getHpRatio()).toBe(1);
    game.destroy(true);
  });

  it('takeDamage 扣 HP（不低於 0）；歸 0 翻 isDefeated（不銷毀）', async () => {
    await withScene(() => {});
    const t = new GuardTarget(scene, 0, 0, 100);
    t.takeDamage(30);
    expect(t.getHp()).toBe(70);
    expect(t.getHpRatio()).toBeCloseTo(0.7);
    expect(t.isDefeated()).toBe(false);
    t.takeDamage(80); // 超過 → clamp 0
    expect(t.getHp()).toBe(0);
    expect(t.isDefeated()).toBe(true); // 翻敗
    game.destroy(true);
  });

  // 🔴 壞版對照：敗後再扣不應變負、isDefeated 維持 true。
  it('壞版對照：歸 0 後 takeDamage 不會變負、isDefeated 恆真', async () => {
    await withScene(() => {});
    const t = new GuardTarget(scene, 0, 0, 100);
    t.takeDamage(100);
    t.takeDamage(50);
    expect(t.getHp()).toBe(0); // 非負
    expect(t.isDefeated()).toBe(true);
    game.destroy(true);
  });
});
