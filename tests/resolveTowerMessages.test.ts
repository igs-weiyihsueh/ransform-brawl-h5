// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveTowerMessages, TOWER_MESSAGE_DEFAULTS } from '@/config/towerConfig';
import { resolveTowerUi, TOWER_UI_DEFAULTS } from '@/config/towerConfig';
import { resolveTowerIntro, TOWER_INTRO_DEFAULTS } from '@/config/towerConfig';
import { resolveTowerRingParams } from '@/config/towerConfig';
import { validateTower, TOWER_SCHEMA_VERSION } from '@/config/towerSchema';

/**
 * towerConfig resolveTowerMessages — 塔波登場訊息照搬守護波兩段（用戶爆氣「照搬還漏東漏西」）。
 * resolveTowerMessages(preset): TowerMessages — 3 欄 ?? TOWER_MESSAGE_DEFAULTS：
 *   introEventText ?? '魔尖塔降臨' / towerMessageText ?? '打倒所有魔尖塔！' / eventTextDurationSec ?? 3。
 * ★同 resolveGuardMessages 0-值辨析：空字串 ''（明確清空保留，不退預設）；秒數 0 合法（?? 非 ||）。
 *   區分「明確清空 ''(保留)」vs「沒設定 undefined(退預設)」。含壞版必紅（??→|| 退預設）。
 * WaveSystem 塔波登場用 EffectSystem timedEventText(大字)+guardText(提示) 顯示兩段（同守護波元件）。
 */

describe('resolveTowerMessages — 塔波登場訊息逐欄 ??（?? 非 ||，空字串/0 保留）', () => {
  it('全省略（空 preset {}）→ 全退打包預設（魔尖塔降臨 / 打倒所有魔尖塔！ / 3）', () => {
    expect(resolveTowerMessages({})).toEqual({
      introEventText: '魔尖塔降臨',
      towerMessageText: '打倒所有魔尖塔！',
      eventTextDurationSec: 3,
    });
    expect(resolveTowerMessages({})).toEqual(TOWER_MESSAGE_DEFAULTS);
  });

  it('override 文字+時長 → 生效（尖塔降臨！ / 5）', () => {
    const r = resolveTowerMessages({ introEventText: '尖塔降臨！', eventTextDurationSec: 5 });
    expect(r.introEventText).toBe('尖塔降臨！');
    expect(r.eventTextDurationSec).toBe(5);
    expect(r.towerMessageText).toBe('打倒所有魔尖塔！'); // 未給→預設
  });

  it('★ 空字串 \'\' 保留（introEventText/towerMessageText=\'\' → \'\'，不退預設）', () => {
    const r = resolveTowerMessages({ introEventText: '', towerMessageText: '' });
    expect(r.introEventText).toBe('');
    expect(r.towerMessageText).toBe('');
  });

  it('★ eventTextDurationSec=0 保留（0 合法=不顯/立即，?? 非 ||）', () => {
    expect(resolveTowerMessages({ eventTextDurationSec: 0 }).eventTextDurationSec).toBe(0);
  });

  it('部分 override（只給一欄）→ 該欄 override、其餘預設', () => {
    const r = resolveTowerMessages({ towerMessageText: '打爆它們！' });
    expect(r.towerMessageText).toBe('打爆它們！');
    expect(r.introEventText).toBe('魔尖塔降臨');
    expect(r.eventTextDurationSec).toBe(3);
  });

  it('★ 對照鎖：introEventText=\'\'(明確清空保留) vs undefined(退預設) 兩態並存', () => {
    const r = resolveTowerMessages({ introEventText: '', towerMessageText: undefined });
    expect(r.introEventText).toBe('');
    expect(r.towerMessageText).toBe('打倒所有魔尖塔！');
  });
});

describe('validateTower — 訊息欄（文字非字串擋、秒數負擋、\'\'/0 合法過）', () => {
  const base = {
    version: TOWER_SCHEMA_VERSION,
    presets: {
      T: {
        towerCount: 4, timeLimitSec: 60, towerHp: 100,
        ringSkill: { ringCount: 3, baseRadiusPx: 60, radiusStepPx: 40, ringIntervalSec: 0.6, ringThicknessPx: 20, energyCost: 2, warningSec: 0.5 },
      },
    },
  };
  function withMsg(msg: Record<string, unknown>): unknown {
    const p = structuredClone(base);
    Object.assign(p.presets.T, msg);
    return p;
  }

  it('省略訊息欄 → 過（用預設）', () => {
    expect(validateTower(base).ok).toBe(true);
  });

  it('★ 空字串文字 + 秒數 0 → 過（\'\'/0 皆合法）', () => {
    expect(validateTower(withMsg({ introEventText: '', towerMessageText: '', eventTextDurationSec: 0 })).ok).toBe(true);
  });

  it('文字非字串 → 擋', () => {
    expect(validateTower(withMsg({ introEventText: 123 })).ok).toBe(false);
  });

  it('★ 秒數負 → 擋（0 過負擋）', () => {
    expect(validateTower(withMsg({ eventTextDurationSec: -1 })).ok).toBe(false);
  });

  it('★ ②vacuumRadiusPx（環真空帶半徑，選填 min0）：合法過 / 負擋', () => {
    expect(validateTower(withMsg({ ringSkill: { ringCount: 3, baseRadiusPx: 60, radiusStepPx: 40, ringIntervalSec: 0.6, ringThicknessPx: 20, energyCost: 2, warningSec: 0.5, vacuumRadiusPx: 80 } })).ok).toBe(true);
    expect(validateTower(withMsg({ ringSkill: { ringCount: 3, baseRadiusPx: 60, radiusStepPx: 40, ringIntervalSec: 0.6, ringThicknessPx: 20, energyCost: 2, warningSec: 0.5, vacuumRadiusPx: -5 } })).ok).toBe(false);
  });

  it('★ D 塔血條 UI + E 獎勵：合法值過 / rewardTickets 負擋', () => {
    expect(validateTower(withMsg({ barWidthPx: 200, barHeightPx: 20, barOffsetYPx: -50, labelOffsetYPx: 0, rewardTickets: 0 })).ok).toBe(true);
    expect(validateTower(withMsg({ rewardTickets: -1 })).ok).toBe(false);
    expect(validateTower(withMsg({ barWidthPx: -5 })).ok).toBe(false);
  });

  it('★ B 開場演出：合法過（introFocusSec 0/gatherPoint {x,y}）/ gatherPoint 非物件擋 / introFocusSec 負擋', () => {
    expect(validateTower(withMsg({ introFocusSec: 0, spotlightRadiusPx: 200, maxWalkSec: 3.5, gatherPointPx: { x: 500, y: 300 } })).ok).toBe(true);
    expect(validateTower(withMsg({ gatherPointPx: 'nope' })).ok).toBe(false);
    expect(validateTower(withMsg({ gatherPointPx: { x: 1 } })).ok).toBe(false); // 缺 y
    expect(validateTower(withMsg({ introFocusSec: -1 })).ok).toBe(false);
  });
});

describe('resolveTowerUi — 塔血條 UI + 獎勵逐欄 ??（0-nullish 安全）', () => {
  it('全省略 → 全退預設', () => {
    expect(resolveTowerUi({})).toEqual(TOWER_UI_DEFAULTS);
  });

  it('★ offsetY=0/負 + rewardTickets=0 保留（?? 非 ||）', () => {
    const r = resolveTowerUi({ barOffsetYPx: 0, labelOffsetYPx: -120, rewardTickets: 0 });
    expect(r.barOffsetYPx).toBe(0);
    expect(r.labelOffsetYPx).toBe(-120);
    expect(r.rewardTickets).toBe(0);
    expect(r.barWidthPx).toBe(TOWER_UI_DEFAULTS.barWidthPx); // 未給→預設
  });

  it('部分 override → 該欄生效、其餘預設', () => {
    const r = resolveTowerUi({ barWidthPx: 240, rewardTickets: 20 });
    expect(r.barWidthPx).toBe(240);
    expect(r.rewardTickets).toBe(20);
    expect(r.barHeightPx).toBe(TOWER_UI_DEFAULTS.barHeightPx);
  });
});

describe('resolveTowerIntro — B 開場演出逐欄 ??（中央聚集，0-nullish 安全）', () => {
  it('全省略 → 全退預設（gatherPoint 畫面中央 960,540）', () => {
    expect(resolveTowerIntro({})).toEqual(TOWER_INTRO_DEFAULTS);
    expect(resolveTowerIntro({}).gatherPointPx).toEqual({ x: 960, y: 540 });
  });

  it('★ introFocusSec=0 保留（0=不壓黑立即，?? 非 ||）', () => {
    expect(resolveTowerIntro({ introFocusSec: 0 }).introFocusSec).toBe(0);
  });

  it('gatherPoint 逐軸 ??（x=0 保留、y 未給退預設）', () => {
    const r = resolveTowerIntro({ gatherPointPx: { x: 0 } });
    expect(r.gatherPointPx.x).toBe(0); // 明確 0 保留
    expect(r.gatherPointPx.y).toBe(TOWER_INTRO_DEFAULTS.gatherPointPx.y); // 未給→預設
  });

  it('部分 override（spotlightRadius+maxWalk）→ 生效、其餘預設', () => {
    const r = resolveTowerIntro({ spotlightRadiusPx: 300, maxWalkSec: 5 });
    expect(r.spotlightRadiusPx).toBe(300);
    expect(r.maxWalkSec).toBe(5);
    expect(r.introFocusSec).toBe(TOWER_INTRO_DEFAULTS.introFocusSec);
  });
});

describe('resolveTowerRingParams — ②真空帶 vacuumRadiusPx 帶出（?? baseRadiusPx，0 保留）', () => {
  const baseRing = { ringCount: 3, baseRadiusPx: 60, radiusStepPx: 40, ringIntervalSec: 0.6, ringThicknessPx: 20, energyCost: 2, warningSec: 0.5 };

  it('省略 vacuumRadiusPx → 沿用 baseRadiusPx', () => {
    expect(resolveTowerRingParams({ ...baseRing }).vacuumRadiusPx).toBe(60);
  });

  it('有設 vacuumRadiusPx → 生效', () => {
    expect(resolveTowerRingParams({ ...baseRing, vacuumRadiusPx: 120 }).vacuumRadiusPx).toBe(120);
  });

  it('★ vacuumRadiusPx=0 保留（?? 非 ||）', () => {
    expect(resolveTowerRingParams({ ...baseRing, vacuumRadiusPx: 0 }).vacuumRadiusPx).toBe(0);
  });

  it('其餘環參數原樣帶出', () => {
    const r = resolveTowerRingParams({ ...baseRing, vacuumRadiusPx: 90 });
    expect(r.ringCount).toBe(3);
    expect(r.baseRadiusPx).toBe(60);
    expect(r.warningSec).toBe(0.5);
  });
});
