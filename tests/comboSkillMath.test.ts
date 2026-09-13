import { describe, expect, it } from 'vitest';
import { pointInCircle, pointInOrientedRect, bumpCombo, comboSkillReady } from '@/systems/comboSkillMath';

describe('pointInCircle', () => {
  it('圓內→true', () => expect(pointInCircle(3, 4, 0, 0, 5)).toBe(true)); // dist 5 = radius
  it('圓外→false', () => expect(pointInCircle(3, 4, 0, 0, 4.9)).toBe(false));
  it('中心→true', () => expect(pointInCircle(0, 0, 0, 0, 1)).toBe(true));
});

describe('pointInOrientedRect — 直線氣波矩形（origin 底邊中心、前向 angle）', () => {
  // 朝右(angle=0)、length 420、halfWidth 45。
  it('正前方矩形內→true', () => expect(pointInOrientedRect(200, 0, 0, 0, 0, 420, 45)).toBe(true));
  it('正前方偏側 40（< halfWidth45）→true', () => expect(pointInOrientedRect(200, 40, 0, 0, 0, 420, 45)).toBe(true));
  it('側偏 50（> halfWidth45）→false', () => expect(pointInOrientedRect(200, 50, 0, 0, 0, 420, 45)).toBe(false));
  it('後方（forward<0）→false', () => expect(pointInOrientedRect(-10, 0, 0, 0, 0, 420, 45)).toBe(false));
  it('超出長度（forward>length）→false', () => expect(pointInOrientedRect(430, 0, 0, 0, 0, 420, 45)).toBe(false));
  it('朝上(angle=-90°)前方點→true', () => expect(pointInOrientedRect(0, -200, 0, 0, -Math.PI / 2, 420, 45)).toBe(true));
});

describe('bumpCombo — 無衰減、cap 在 max（歸零由 empower 觸發）', () => {
  it('遞增 +1', () => expect(bumpCombo(2, 10)).toBe(3));
  it('達 max 維持不超（不自動歸零）', () => expect(bumpCombo(10, 10)).toBe(10));
  it('接近 max +1 到 max', () => expect(bumpCombo(9, 10)).toBe(10));
});

describe('comboSkillReady — 門檻+等級雙條件', () => {
  it('combo 夠+等級夠→true', () => expect(comboSkillReady(3, 2, 3, 2)).toBe(true));
  it('combo 夠但等級不夠→false', () => expect(comboSkillReady(3, 1, 3, 2)).toBe(false));
  it('等級夠但 combo 不夠→false', () => expect(comboSkillReady(2, 5, 3, 2)).toBe(false));
  it('圓形斬 combo6/Lv4 也滿足 combo≥3&Lv≥2', () => expect(comboSkillReady(6, 4, 3, 2)).toBe(true));
});
