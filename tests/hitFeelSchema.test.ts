// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  resolveHitFeel,
  validateHitFeel,
  defaultHitFeelFile,
  HIT_FEEL_SCHEMA_VERSION,
} from '@/config/hitFeelSchema';
import { HIT_FEEL } from '@/config/hitFeelConfig';

/**
 * hitFeelSchema（用戶第十一輪：hitfeel 補套用機制，additive）。
 *  1. resolveHitFeel(override, packaged)：override 通過 validate → 逐欄 ?? 打包；壞/null → 打包（行為不變）。
 *  2. validateHitFeel：時長/scale/距離 >=0（★0 合法只擋負）、顏色 0..0xFFFFFF、bool。
 * ★0-nullish 語意（異靈定，同 chest/dash 非 scale）：microFreezeDuration=0 / playerHitlagDuration=0
 *   = 不做頓幀/hitlag，是【合法】設定，resolveHitFeel 用 ?? 非 || → 0/false 不被誤退回預設。
 * 維度3 斷解析值/過擋。含壞版必紅（★0 保留 / false 保留 / 負擋 / 缺欄 fallback）。
 */

function makeFile(overrides: Partial<typeof HIT_FEEL>) {
  return { version: HIT_FEEL_SCHEMA_VERSION, hitFeel: { ...HIT_FEEL, ...overrides } };
}

describe('resolveHitFeel — override 優先、逐欄 ??（0-nullish）', () => {
  it('override=null → 打包預設（行為 100% 不變）', () => {
    expect(resolveHitFeel(null)).toEqual(HIT_FEEL);
  });

  it('override 壞（validate 失敗）→ 打包預設', () => {
    expect(resolveHitFeel({ version: 999, hitFeel: {} })).toEqual(HIT_FEEL);
    expect(resolveHitFeel({ nonsense: true })).toEqual(HIT_FEEL);
  });

  it('合法 override → 用 override 值（microFreeze/playerHitlag 覆蓋生效）', () => {
    const r = resolveHitFeel(makeFile({ microFreezeDuration: 0.2, playerHitlagDuration: 0.25 }));
    expect(r.microFreezeDuration).toBe(0.2);
    expect(r.playerHitlagDuration).toBe(0.25);
  });

  it('★0-nullish：microFreezeDuration=0 / playerHitlagDuration=0 保留（不被 || 退回預設 0.06/0.1）', () => {
    const r = resolveHitFeel(makeFile({ microFreezeDuration: 0, playerHitlagDuration: 0 }));
    expect(r.microFreezeDuration).toBe(0); // 0=不做頓幀，合法
    expect(r.playerHitlagDuration).toBe(0); // 0=不做 hitlag，合法
  });

  it('★0-nullish：enabled=false / hitSparkEnabled=false 保留（不被 || 退回 true）', () => {
    const r = resolveHitFeel(makeFile({ enabled: false, hitSparkEnabled: false }));
    expect(r.enabled).toBe(false);
    expect(r.hitSparkEnabled).toBe(false);
  });

  it('★0-nullish：hitFlashColor=0x000000（黑）保留', () => {
    const r = resolveHitFeel(makeFile({ hitFlashColor: 0x000000 }));
    expect(r.hitFlashColor).toBe(0x000000);
  });
});

describe('validateHitFeel — 型別/範圍（0 合法只擋負）', () => {
  const okFile = defaultHitFeelFile();

  it('打包預設檔驗證通過', () => {
    expect(validateHitFeel(okFile).ok).toBe(true);
  });

  it('★時長=0 通過（不做頓幀/hitlag 合法）', () => {
    expect(validateHitFeel(makeFile({ microFreezeDuration: 0, playerHitlagDuration: 0, hitFlashDuration: 0 })).ok).toBe(true);
  });

  it('★負時長擋', () => {
    expect(validateHitFeel(makeFile({ microFreezeDuration: -0.1 })).ok).toBe(false);
    expect(validateHitFeel(makeFile({ playerHitlagDuration: -1 })).ok).toBe(false);
  });

  it('顏色超出 0..0xFFFFFF 擋、非整數擋', () => {
    expect(validateHitFeel(makeFile({ hitFlashColor: 0x1000000 })).ok).toBe(false);
    expect(validateHitFeel(makeFile({ hitFlashColor: -1 })).ok).toBe(false);
    expect(validateHitFeel(makeFile({ hitSparkColor: 1.5 })).ok).toBe(false);
  });

  it('enabled 非布林擋、hitFeel 缺欄擋', () => {
    expect(validateHitFeel({ version: HIT_FEEL_SCHEMA_VERSION, hitFeel: { ...HIT_FEEL, enabled: 'yes' } }).ok).toBe(false);
    expect(validateHitFeel({ version: HIT_FEEL_SCHEMA_VERSION, hitFeel: { enabled: true } }).ok).toBe(false); // 缺其他欄
  });

  it('version 錯 / 根非物件擋', () => {
    expect(validateHitFeel(makeFile({}) && { version: 2, hitFeel: { ...HIT_FEEL } }).ok).toBe(false);
    expect(validateHitFeel(null).ok).toBe(false);
  });
});
