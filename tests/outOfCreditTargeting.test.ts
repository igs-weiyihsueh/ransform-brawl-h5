import { describe, it, expect } from 'vitest';
import { isValidEnemyTarget } from '@/systems/targetingMath';

describe('十五輪 沒credit核心 — isValidEnemyTarget 排除 isOutOfCredit', () => {
  it('outOfCredit 玩家 → 非有效目標（不鎖定）', () => {
    const oocPlayer = { isWaiting: () => false, isOutOfCredit: () => true };
    expect(isValidEnemyTarget(oocPlayer)).toBe(false);
  });
  it('非 outOfCredit 且非 waiting → 有效目標', () => {
    const active = { isWaiting: () => false, isOutOfCredit: () => false };
    expect(isValidEnemyTarget(active)).toBe(true);
  });
  it('waiting 玩家 → 非有效目標（原行為保留）', () => {
    const waiting = { isWaiting: () => true, isOutOfCredit: () => false };
    expect(isValidEnemyTarget(waiting)).toBe(false);
  });
  it('無 isOutOfCredit（相容 stub）→ 只看 isWaiting，有效', () => {
    const stub = { isWaiting: () => false };
    expect(isValidEnemyTarget(stub)).toBe(true);
  });
  // 🔴 壞版必紅對照：若沒排除 isOutOfCredit，outOfCredit 玩家會被誤判為有效目標
  it('壞版對照：outOfCredit 玩家絕不可為有效目標（沒排除=紅）', () => {
    const ooc = { isWaiting: () => false, isOutOfCredit: () => true };
    expect(isValidEnemyTarget(ooc)).not.toBe(true);
  });

  it('非耗盡/非待機 → 有效目標（兩態都放行才追）', () => {
    const active = { isWaiting: () => false, isOutOfCredit: () => false };
    expect(isValidEnemyTarget(active)).toBe(true);
  });
});
