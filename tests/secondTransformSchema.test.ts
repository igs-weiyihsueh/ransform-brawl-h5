import { describe, expect, it } from 'vitest';
import {
  resolveSecondTransformEnabled,
  resolveSecondTransform,
  SECOND_TRANSFORM_SCHEMA_VERSION,
  defaultSecondTransformFile,
  type ResolvedSecondTransform,
} from '@/config/secondTransformSchema';

/** 測試用打包預設（固定值，不依賴 config，讓斷言穩定）。 */
const PKG: ResolvedSecondTransform = {
  enabled: false,
  energyPerKill: 0.12,
  decayPerSec: 0.125,
  scaleMult: 1.4,
  attackRangeMult: 1.4,
  fillThreshold: 1,
};

/**
 * secondTransformSchema — 二段變身「啟用開關」override 解析（用戶要編輯器可控開/關）。
 * resolveSecondTransformEnabled(override, packaged=SECOND_TRANSFORM_CONFIG.enabled)：
 *   合法 {version:1, enabled:bool} → override.enabled；否則（null/非物件/version 錯/enabled 非 bool）→ packaged。
 * ★大更動回歸修(#1)：SECOND_TRANSFORM_CONFIG.enabled false→true（二段變身上線，變身後顯 soulRing）→
 *   省略 packaged 參數時 fallback 現在回 **true**。fallback/守衛邏輯本身沒變，只是打包預設值翻了。
 *   壞版對照仍用「顯式 packaged」鎖 fallback 走向（override 無效→回 packaged，非讀 override）。
 */
describe('resolveSecondTransformEnabled — override 優先、fallback 打包預設', () => {
  it('override 沒設（null/undefined）→ 回打包預設（現預設 true）', () => {
    expect(resolveSecondTransformEnabled(null)).toBe(true);
    expect(resolveSecondTransformEnabled(undefined)).toBe(true);
  });

  it('合法 override enabled=true → 啟用（用戶編輯器開開關）', () => {
    expect(resolveSecondTransformEnabled({ version: 1, enabled: true })).toBe(true);
  });

  it('合法 override enabled=false → 關（用戶編輯器關開關，override 蓋過打包預設 true）', () => {
    expect(resolveSecondTransformEnabled({ version: 1, enabled: false })).toBe(false);
    // ★load-bearing：override.enabled=false 必須壓過 packaged=true（證明採用的是 override 非 packaged）。
    expect(resolveSecondTransformEnabled({ version: 1, enabled: false }, true)).toBe(false);
  });

  it('packaged 參數可覆寫 fallback（override 無效時回 packaged，兩向皆鎖）', () => {
    expect(resolveSecondTransformEnabled(null, true)).toBe(true);
    expect(resolveSecondTransformEnabled(null, false)).toBe(false);
  });

  it('★壞版對照：version 錯 → 不採用、回 packaged（顯式 packaged=false 鎖走向）', () => {
    // 顯式 packaged=false：若誤讀 override.enabled=true 會回 true → 紅。故用 false 鎖「回 packaged 非 override」。
    expect(resolveSecondTransformEnabled({ version: 2, enabled: true }, false)).toBe(false);
    expect(resolveSecondTransformEnabled({ enabled: true }, false)).toBe(false); // 缺 version
    // 省略 packaged（預設 true）→ 也回 packaged(true)，同樣證明沒讀 override 的 true（此處恰同值，故上面顯式 false 才是鑑別關鍵）。
    expect(resolveSecondTransformEnabled({ version: 2, enabled: false })).toBe(true);
  });

  it('★壞版對照：enabled 非 boolean → 不採用、回 packaged（顯式 packaged=false 鎖走向）', () => {
    expect(resolveSecondTransformEnabled({ version: 1, enabled: 'true' }, false)).toBe(false);
    expect(resolveSecondTransformEnabled({ version: 1, enabled: 1 }, false)).toBe(false);
    expect(resolveSecondTransformEnabled({ version: 1 }, false)).toBe(false); // 缺 enabled
  });

  it('★壞版對照：非物件（字串/數字/陣列）→ 回 packaged（顯式 packaged=false 鎖走向）', () => {
    expect(resolveSecondTransformEnabled('nope' as unknown, false)).toBe(false);
    expect(resolveSecondTransformEnabled(123 as unknown, false)).toBe(false);
    expect(resolveSecondTransformEnabled([1, 2] as unknown, false)).toBe(false);
  });

  it('SCHEMA_VERSION=1、defaultSecondTransformFile 為 {version:1, enabled:現預設(true)}', () => {
    expect(SECOND_TRANSFORM_SCHEMA_VERSION).toBe(1);
    const f = defaultSecondTransformFile();
    expect(f.version).toBe(1);
    expect(f.enabled).toBe(true); // 打包預設現為開（二段上線）
    // 數值欄帶打包預設（匯出範例完整）。
    expect(typeof f.energyPerKill).toBe('number');
    expect(typeof f.decayPerSec).toBe('number');
    expect(typeof f.scaleMult).toBe('number');
    expect(typeof f.attackRangeMult).toBe('number');
  });
});

describe('resolveSecondTransform — 逐欄 override 優先、fallback 打包預設', () => {
  it('override 沒設（null/undefined/非物件）→ 全回 packaged', () => {
    expect(resolveSecondTransform(null, PKG)).toEqual(PKG);
    expect(resolveSecondTransform(undefined, PKG)).toEqual(PKG);
    expect(resolveSecondTransform('nope' as unknown, PKG)).toEqual(PKG);
    expect(resolveSecondTransform(123 as unknown, PKG)).toEqual(PKG);
  });

  it('version 錯 → 全回 packaged', () => {
    expect(resolveSecondTransform({ version: 2, enabled: true, scaleMult: 2 }, PKG)).toEqual(PKG);
  });

  it('★全欄 override → 各欄採用', () => {
    const r = resolveSecondTransform(
      { version: 1, enabled: true, energyPerKill: 0.3, decayPerSec: 0.2, scaleMult: 1.8, attackRangeMult: 2.0, fillThreshold: 0.6 },
      PKG,
    );
    expect(r).toEqual({ enabled: true, energyPerKill: 0.3, decayPerSec: 0.2, scaleMult: 1.8, attackRangeMult: 2.0, fillThreshold: 0.6 });
  });

  it('★逐欄 fallback：只給部分欄 → 其餘沿用 packaged', () => {
    const r = resolveSecondTransform({ version: 1, enabled: true, scaleMult: 1.6 }, PKG);
    expect(r.enabled).toBe(true);
    expect(r.scaleMult).toBe(1.6); // 有給→採用
    expect(r.energyPerKill).toBe(PKG.energyPerKill); // 沒給→packaged
    expect(r.decayPerSec).toBe(PKG.decayPerSec);
    expect(r.attackRangeMult).toBe(PKG.attackRangeMult);
    expect(r.fillThreshold).toBe(PKG.fillThreshold); // 沒給→packaged
  });

  it('★壞版對照：數值欄非有限正數（0/負/NaN/字串）→ 該欄 fallback packaged', () => {
    const r = resolveSecondTransform(
      { version: 1, enabled: true, energyPerKill: 0, decayPerSec: -1, scaleMult: NaN, attackRangeMult: '2' },
      PKG,
    );
    expect(r.energyPerKill).toBe(PKG.energyPerKill); // 0 不合法→fallback
    expect(r.decayPerSec).toBe(PKG.decayPerSec); // 負→fallback
    expect(r.scaleMult).toBe(PKG.scaleMult); // NaN→fallback
    expect(r.attackRangeMult).toBe(PKG.attackRangeMult); // 字串→fallback
  });

  it('enabled 非 boolean → 用 packaged.enabled（數值欄仍各自解析）', () => {
    const r = resolveSecondTransform({ version: 1, enabled: 'yes', energyPerKill: 0.4 }, { ...PKG, enabled: true });
    expect(r.enabled).toBe(true); // packaged.enabled
    expect(r.energyPerKill).toBe(0.4); // 數值仍採用
  });

  it('★物件守衛：function-with-props（typeof≠object）→ 全回 packaged', () => {
    const fn = Object.assign(function () {}, { version: 1, enabled: true, scaleMult: 2 });
    expect(resolveSecondTransform(fn as unknown, PKG)).toEqual(PKG);
  });

  // fillThreshold（集滿門檻，用戶要開放）：ratio (0,1]（energy cap=1，>1 永不觸發故拒）。
  describe('fillThreshold 集滿門檻（ratio (0,1] 守衛）', () => {
    // PKG_F 各欄與 fillThreshold 全不同值 → 抓 fillThreshold fallback 誤讀其他欄的串欄 mutant（測騎教訓）。
    const PKG_F: ResolvedSecondTransform = {
      enabled: false,
      energyPerKill: 0.11,
      decayPerSec: 0.22,
      scaleMult: 1.33,
      attackRangeMult: 1.77,
      fillThreshold: 0.9,
    };

    it('合法 (0,1] → 採用（調低=更容易集滿觸發）', () => {
      expect(resolveSecondTransform({ version: 1, enabled: true, fillThreshold: 0.5 }, PKG_F).fillThreshold).toBe(0.5);
      expect(resolveSecondTransform({ version: 1, enabled: true, fillThreshold: 1 }, PKG_F).fillThreshold).toBe(1); // 邊界 1 採用
      expect(resolveSecondTransform({ version: 1, enabled: true, fillThreshold: 0.01 }, PKG_F).fillThreshold).toBe(0.01);
    });

    it('★>1 拒（energy cap=1 永不觸發）→ fallback packaged', () => {
      expect(resolveSecondTransform({ version: 1, enabled: true, fillThreshold: 1.5 }, PKG_F).fillThreshold).toBe(0.9);
      expect(resolveSecondTransform({ version: 1, enabled: true, fillThreshold: 2 }, PKG_F).fillThreshold).toBe(0.9);
    });

    it('★壞值 0/負/NaN/字串/Infinity → fallback packaged', () => {
      expect(resolveSecondTransform({ version: 1, enabled: true, fillThreshold: 0 }, PKG_F).fillThreshold).toBe(0.9);
      expect(resolveSecondTransform({ version: 1, enabled: true, fillThreshold: -0.5 }, PKG_F).fillThreshold).toBe(0.9);
      expect(resolveSecondTransform({ version: 1, enabled: true, fillThreshold: NaN }, PKG_F).fillThreshold).toBe(0.9);
      expect(resolveSecondTransform({ version: 1, enabled: true, fillThreshold: '0.5' }, PKG_F).fillThreshold).toBe(0.9);
      expect(resolveSecondTransform({ version: 1, enabled: true, fillThreshold: Infinity }, PKG_F).fillThreshold).toBe(0.9);
    });

    it('沒給 fillThreshold → fallback packaged（且不誤讀其他欄，PKG_F 各欄不同值）', () => {
      const r = resolveSecondTransform({ version: 1, enabled: true, scaleMult: 1.6 }, PKG_F);
      expect(r.fillThreshold).toBe(0.9); // 沒給→自己的 packaged，非 scaleMult/其他
    });

    it('version 錯 → fillThreshold 也回 packaged', () => {
      expect(resolveSecondTransform({ version: 2, enabled: true, fillThreshold: 0.5 }, PKG_F).fillThreshold).toBe(0.9);
    });
  });

  it('resolveSecondTransformEnabled 與 resolveSecondTransform.enabled 一致', () => {
    expect(resolveSecondTransformEnabled({ version: 1, enabled: true })).toBe(
      resolveSecondTransform({ version: 1, enabled: true }).enabled,
    );
  });
});
