import { describe, it, expect } from 'vitest';
import {
  rollDrop,
  pickWeightedDropSkill,
  damageShield,
  isShieldBroken,
  lifespanPhase,
  blinkVisible,
  overlapPickup,
} from '@/systems/douqiItemMath';
import { DOUQI_ITEM_CONFIG } from '@/config/douqiItemConfig';

describe('douqiItemMath', () => {
  describe('rollDrop', () => {
    it('rng < dropChance → 掉', () => expect(rollDrop(0.06, () => 0.05)).toBe(true));
    it('rng >= dropChance → 不掉', () => expect(rollDrop(0.06, () => 0.06)).toBe(false));
    it('dropChance<=0 → 不掉', () => expect(rollDrop(0, () => 0)).toBe(false));
  });

  describe('pickWeightedDropSkill (加權；T 稀有 0.25)', () => {
    const entries = DOUQI_ITEM_CONFIG.entries; // A/B/C/E/F 各1、T 0.25（H 已移除），total=5.25
    it('rng=0 → 第一筆 A', () => expect(pickWeightedDropSkill(entries, () => 0)).toBe('A'));
    it('rng 落在第二段 → B', () => expect(pickWeightedDropSkill(entries, () => 1.5 / 5.25)).toBe('B'));
    it('rng 接近 1 → T（最後、稀有段）', () => expect(pickWeightedDropSkill(entries, () => 0.999)).toBe('T'));
    it('空陣列 → null', () => expect(pickWeightedDropSkill([], () => 0)).toBe(null));
    it('★T 稀有：權重 0.25/5.25≈4.8%（落在 5.0~5.25 段才中 T）', () => {
      expect(pickWeightedDropSkill(entries, () => 4.9 / 5.25)).toBe('F'); // 5.0 前是 F（第5筆）
      expect(pickWeightedDropSkill(entries, () => 5.1 / 5.25)).toBe('T'); // 5.0 後才 T
    });
    it('★H 已移除：掉落池不含 H', () => {
      expect(entries.some((e) => e.skill === 'H')).toBe(false);
    });
  });

  describe('damageShield / isShieldBroken (階段1.5 用、先備)', () => {
    it('扣血夾 ≥0', () => {
      expect(damageShield(3, 1)).toBe(2);
      expect(damageShield(1, 5)).toBe(0);
      expect(damageShield(3, 0)).toBe(3);
    });
    it('破盾判定', () => {
      expect(isShieldBroken(0)).toBe(true);
      expect(isShieldBroken(1)).toBe(false);
    });
    it('打 3 下破盾（shieldHp3）', () => {
      let hp = 3;
      hp = damageShield(hp, 1); expect(isShieldBroken(hp)).toBe(false); // 2
      hp = damageShield(hp, 1); expect(isShieldBroken(hp)).toBe(false); // 1
      hp = damageShield(hp, 1); expect(isShieldBroken(hp)).toBe(true); // 0 破
    });
  });

  describe('lifespanPhase (alive/blinking/expired)', () => {
    // lifespan14000、blinkBefore2500 → blinking 起於 11500、expired 於 14000
    it('前段 alive', () => expect(lifespanPhase(5000, 14000, 2500)).toBe('alive'));
    it('剩 <2500 → blinking', () => expect(lifespanPhase(11600, 14000, 2500)).toBe('blinking'));
    it('剛好 blinkBefore 邊界 → blinking', () => expect(lifespanPhase(11500, 14000, 2500)).toBe('blinking'));
    it('逾時 → expired', () => expect(lifespanPhase(14000, 14000, 2500)).toBe('expired'));
    it('超過 → expired', () => expect(lifespanPhase(15000, 14000, 2500)).toBe('expired'));
  });

  describe('blinkVisible (週期顯隱)', () => {
    it('前半顯、後半隱（period200）', () => {
      expect(blinkVisible(0, 200)).toBe(true); // 0<100 顯
      expect(blinkVisible(99, 200)).toBe(true);
      expect(blinkVisible(100, 200)).toBe(false); // 100>=100 隱
      expect(blinkVisible(150, 200)).toBe(false);
      expect(blinkVisible(200, 200)).toBe(true); // 下週期
    });
    it('period<=0 → 恆顯', () => expect(blinkVisible(50, 0)).toBe(true));
  });

  describe('overlapPickup (距離拾取)', () => {
    // pickupRadius15 + playerRadius20 = 35
    it('距離內 → 拾', () => expect(overlapPickup(0, 0, 30, 0, 15, 20)).toBe(true)); // 30<=35
    it('距離外 → 不拾', () => expect(overlapPickup(0, 0, 40, 0, 15, 20)).toBe(false)); // 40>35
    it('邊界 = 35 → 拾', () => expect(overlapPickup(0, 0, 35, 0, 15, 20)).toBe(true));
  });
});
