// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveGuardMessages, GUARD_MESSAGE_DEFAULTS } from '@/config/guardConfig';
import { validateGuard, GUARD_SCHEMA_VERSION } from '@/config/guardSchema';

/**
 * guardConfig resolveGuardMessages — 守護波開場訊息可編輯（用戶第十四輪，翼騎 41d070e，additive）。
 * resolveGuardMessages(preset): GuardMessages — 3 欄 ?? GUARD_MESSAGE_DEFAULTS：
 *   introEventText ?? '限時事件' / guardMessageText ?? '協力合作，守護雕像' / eventTextDurationSec ?? 3。
 * ★這輪 0-值辨析新增「空字串 '' falsy 合法」：introEventText='' = 用戶明確清空(不顯示文字)，是合法值。
 *   `'' || 預設` = 預設（錯！），必須 `'' ?? 預設` = ''——文字版 falsy 陷阱（同 hitfeel color 0x000000 / bool false）。
 *   ★區分「明確清空 ''(保留)」vs「沒設定 undefined(退預設)」。秒數 0 亦保留(?? 非 ||)。
 * 維度3 斷解析文字/秒數 + validateGuard 訊息欄範圍。含壞版必紅(文字 ??→|| '' 退預設 / 秒數 ??→|| 0 退預設)。
 * ⚠️ GuardEvent ③ 嚴格接續 gate + EffectSystem timedEventText/guardText 接線屬狀態機(翼騎 tsx 驗算術+headless editor UI)——不補。
 */

describe('resolveGuardMessages — 守護開場訊息逐欄 ??（?? 非 ||，空字串/0 保留）', () => {
  it('全省略（空 preset {}）→ 全退打包預設（限時事件 / 協力合作，守護雕像 / 3）', () => {
    expect(resolveGuardMessages({})).toEqual({
      introEventText: '限時事件',
      guardMessageText: '協力合作，守護雕像',
      eventTextDurationSec: 3,
    });
    expect(resolveGuardMessages({})).toEqual(GUARD_MESSAGE_DEFAULTS);
  });

  it('override 文字+時長 → 生效（魔王來襲 / 5）', () => {
    const r = resolveGuardMessages({ introEventText: '魔王來襲', eventTextDurationSec: 5 });
    expect(r.introEventText).toBe('魔王來襲');
    expect(r.eventTextDurationSec).toBe(5);
    expect(r.guardMessageText).toBe('協力合作，守護雕像'); // 未給→預設
  });

  it('★ 空字串 \'\' 保留（introEventText/guardMessageText=\'\' → \'\'，不退預設；文字版 falsy 陷阱）', () => {
    const r = resolveGuardMessages({ introEventText: '', guardMessageText: '' });
    expect(r.introEventText).toBe(''); // ★ ?? 非 ||：'' 保留（用戶清空）
    expect(r.guardMessageText).toBe('');
  });

  it('★ eventTextDurationSec=0 保留（0 合法=不顯/立即，?? 非 ||）', () => {
    expect(resolveGuardMessages({ eventTextDurationSec: 0 }).eventTextDurationSec).toBe(0);
  });

  it('部分 override（只給一欄）→ 該欄 override、其餘預設', () => {
    const r = resolveGuardMessages({ guardMessageText: '守住它！' });
    expect(r.guardMessageText).toBe('守住它！');
    expect(r.introEventText).toBe('限時事件'); // 其餘預設
    expect(r.eventTextDurationSec).toBe(3);
  });

  it('★ 對照鎖：introEventText=\'\'(明確清空保留) vs undefined(退預設) 兩態並存', () => {
    // '' → 保留；同時另一欄不給（undefined）→ 退預設。
    const r = resolveGuardMessages({ introEventText: '', guardMessageText: undefined });
    expect(r.introEventText).toBe(''); // 明確清空 → 保留
    expect(r.guardMessageText).toBe('協力合作，守護雕像'); // 沒設定 → 退預設
  });
});

describe('validateGuard — 訊息欄（文字非字串擋、秒數負擋、\'\'/0 合法過）', () => {
  const base = {
    version: GUARD_SCHEMA_VERSION,
    presets: {
      G: {
        timeLimit: 60, targetHP: 100, rewardTickets: 10, maxAlive: 6,
        spawnThreshold: 4, spawnInterval: 1, spawnRadiusPx: 350,
        cornerOffsetXPx: 150, cornerOffsetYPx: 150, introFocusSec: 1.6,
        maxWalkSec: 3.5, spotlightRadiusPx: 200,
        spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }],
      },
    },
  };
  function withMsg(msg: Record<string, unknown>): unknown {
    const p = structuredClone(base);
    Object.assign(p.presets.G, msg);
    return p;
  }

  it('省略訊息欄 → 過（用預設）', () => {
    expect(validateGuard(base).ok).toBe(true);
  });

  it('★ 空字串文字 + 秒數 0 → 過（\'\'/0 皆合法）', () => {
    expect(validateGuard(withMsg({ introEventText: '', guardMessageText: '', eventTextDurationSec: 0 })).ok).toBe(true);
  });

  it('文字非字串 → 擋', () => {
    expect(validateGuard(withMsg({ introEventText: 123 })).ok).toBe(false);
  });

  it('★ 秒數負 → 擋（0 過負擋）', () => {
    expect(validateGuard(withMsg({ eventTextDurationSec: -1 })).ok).toBe(false);
  });
});
