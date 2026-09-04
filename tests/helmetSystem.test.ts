import { describe, expect, it } from 'vitest';
import { BUFF_DURATION } from '@/config/buffConfig';
import { BuffSystem } from '@/systems/BuffSystem';
import { HelmetSystem } from '@/systems/HelmetSystem';
import type { GameContext } from '@/systems/GameContext';

/**
 * HelmetSystem 測試（B#6）：頭盔【單槽】——撿新頭盔先移除前一個能力再套新的（同時只一個能力）。
 * 用真的 BuffSystem 當 ctx.buff（驗單槽 = 對 buff 的 remove/apply 接線正確）。
 * 純邏輯（equip/equipRandom 不需 Phaser；equipRandom 用 Math.random 選能力）。
 */
function makeHelmet() {
  const buff = new BuffSystem();
  buff.init({} as unknown as GameContext);
  const helmet = new HelmetSystem();
  const ctx = {
    buff,
    input: { justPressedHelmet: () => false },
  } as unknown as GameContext;
  helmet.init(ctx);
  return { helmet, buff };
}

describe('HelmetSystem — 單槽（重撿覆蓋，同時只一個能力）', () => {
  it('撿第一個頭盔 → 該能力 buff active、lastEquipped 記錄', () => {
    const { helmet, buff } = makeHelmet();
    helmet.equip('MoveSpeed');
    expect(buff.isActive('MoveSpeed')).toBe(true);
    expect(helmet.getLastEquipped()).toBe('MoveSpeed');
    expect(buff.getRemaining('MoveSpeed')).toBe(BUFF_DURATION.MoveSpeed);
  });

  it('撿【不同】新頭盔 → 移除前一個能力、只留新的（單槽）', () => {
    const { helmet, buff } = makeHelmet();
    helmet.equip('MoveSpeed');
    helmet.equip('Dash'); // 換頭盔
    expect(buff.isActive('MoveSpeed')).toBe(false); // 前一個被移除
    expect(buff.isActive('Dash')).toBe(true); // 只剩新的
    expect(helmet.getLastEquipped()).toBe('Dash');
    expect(buff.getActiveIds()).toEqual(['Dash']); // 同時只一個能力
  });

  it('連撿三個不同頭盔 → 永遠只有最後一個 active（單槽不累積）', () => {
    const { helmet, buff } = makeHelmet();
    helmet.equip('MoveSpeed');
    helmet.equip('Shield');
    helmet.equip('Freeze');
    expect(buff.getActiveIds()).toEqual(['Freeze']);
    expect(buff.isActive('MoveSpeed')).toBe(false);
    expect(buff.isActive('Shield')).toBe(false);
  });

  it('撿【相同】能力頭盔 → refresh 計時（不移除再套，走 buff refresh）', () => {
    const { helmet, buff } = makeHelmet();
    helmet.equip('Dash');
    buff.update(5); // 剩 3
    expect(buff.getRemaining('Dash')).toBeCloseTo(BUFF_DURATION.Dash - 5);
    helmet.equip('Dash'); // 同能力重撿 → refresh
    expect(buff.getRemaining('Dash')).toBe(BUFF_DURATION.Dash); // 計時重置
    expect(buff.getActiveIds()).toEqual(['Dash']); // 仍只一個
  });

  it('equip 有 statTag 的能力 → buff 帶對應 stat/magnitude（MoveSpeed→moveSpeed×1.5）', () => {
    const { helmet, buff } = makeHelmet();
    helmet.equip('MoveSpeed');
    expect(buff.getStatMultiplier('moveSpeed')).toBeCloseTo(1.5);
  });

  it('換到純 hook 能力（Shield，無 statTag）→ 前一個 stat 效果被移除還原', () => {
    const { helmet, buff } = makeHelmet();
    helmet.equip('MoveSpeed'); // moveSpeed ×1.5
    expect(buff.getStatMultiplier('moveSpeed')).toBeCloseTo(1.5);
    helmet.equip('Shield'); // 純 hook，無 statTag；單槽移除 MoveSpeed
    expect(buff.getStatMultiplier('moveSpeed')).toBe(1); // 還原
    expect(buff.isActive('Shield')).toBe(true);
  });
});
