import { describe, expect, it } from 'vitest';
import { pointInCircle, pointInOrientedRect, bumpCombo, comboSkillReady, comboSkillEdgeTriggered } from '@/systems/comboSkillMath';

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

describe('comboSkillEdgeTriggered — 門檻邊緣觸發（===threshold，修 >= 每擊重放 bug、v45 規則）', () => {
  // 圓形斬 threshold3/unlockLevel2
  it('combo 剛好等於門檻+等級夠→true（只在剛到那擊觸發）', () => expect(comboSkillEdgeTriggered(3, 2, 3, 2)).toBe(true));
  it('★combo 超過門檻（4/5/6…）→false（不再每擊重放，修氣波 combo6 後重複 bug）', () => {
    expect(comboSkillEdgeTriggered(4, 5, 3, 2)).toBe(false);
    expect(comboSkillEdgeTriggered(6, 5, 3, 2)).toBe(false);
    expect(comboSkillEdgeTriggered(9, 9, 3, 2)).toBe(false);
  });
  it('combo 未達門檻→false', () => expect(comboSkillEdgeTriggered(2, 5, 3, 2)).toBe(false));
  it('combo 到門檻但等級不夠→false（爆發 combo9 但 Lv5<6）', () => expect(comboSkillEdgeTriggered(9, 5, 9, 6)).toBe(false));
  it('氣波 combo===6&Lv≥4→true、combo7→false（一輪只放一次）', () => {
    expect(comboSkillEdgeTriggered(6, 4, 6, 4)).toBe(true);
    expect(comboSkillEdgeTriggered(7, 4, 6, 4)).toBe(false);
  });
  it('★一輪 1→10 逐擊：圓只在3、氣波只在6、爆發只在9 各觸發一次', () => {
    const fires = { circle: 0, line: 0, burst: 0 };
    for (let c = 1; c <= 10; c++) {
      if (comboSkillEdgeTriggered(c, 6, 3, 2)) fires.circle++;
      if (comboSkillEdgeTriggered(c, 6, 6, 4)) fires.line++;
      if (comboSkillEdgeTriggered(c, 6, 9, 6)) fires.burst++;
    }
    expect(fires).toEqual({ circle: 1, line: 1, burst: 1 }); // 各恰一次
  });
});
