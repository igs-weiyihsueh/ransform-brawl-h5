// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveHitFeel, HIT_FEEL_SCHEMA_VERSION } from '@/config/hitFeelSchema';
import { HIT_FEEL } from '@/config/hitFeelConfig';

/**
 * resolveHitFeel — 剩餘 color-0 falsy 欄補鎖（用戶第十一輪 hitfeel，征騎 0440620 已補 12+3 測；本檔補征騎未逐欄鎖的缺口，背書見回報）。
 * ★征騎已鎖:enabled/hitSparkEnabled=false 保留、hitFlashColor=0 保留、microFreeze/playerHitlag=0 保留（跑壞版 M1-M4 皆紅,鑑別足）。
 * ★缺口(跑壞版驗出):hitSparkColor=0x000000 / deathParticleColor=0x000000 兩個顏色欄「0 保留」征騎未逐欄鎖——
 *   把這兩欄同時 ??→|| 征騎 12 測全綠(slip)。本檔逐欄各鎖,任一欄 0-color 被 || 吃即紅。
 * ★三類 falsy 譜系(chest/dash 0-合法延伸,非 scale 0-不合法):數值 0 / bool false / 顏色 0x000000。
 * 維度3 斷各顏色欄 0 保留。⚠️ getResolvedHitFeel cache + 遊戲端套 anims/spark 接線屬狀態機(征騎 jsdom 整合驗 microFreeze 生效)——不補。
 */

function makeFile(overrides: Partial<typeof HIT_FEEL>) {
  return { version: HIT_FEEL_SCHEMA_VERSION, hitFeel: { ...HIT_FEEL, ...overrides } };
}

describe('resolveHitFeel — 剩餘顏色欄 0x000000（黑）逐欄保留（?? 非 ||）', () => {
  it('★ hitSparkColor=0x000000 保留（0 是合法黑色,非退回打包）', () => {
    const r = resolveHitFeel(makeFile({ hitSparkColor: 0x000000 }));
    expect(r.hitSparkColor).toBe(0x000000);
  });

  it('★ deathParticleColor=0x000000 保留', () => {
    const r = resolveHitFeel(makeFile({ deathParticleColor: 0x000000 }));
    expect(r.deathParticleColor).toBe(0x000000);
  });

  it('全四色欄同時=0x000000 → 全保留（hitFlash/hitSpark/death 三色 + 對照 punchScale=0 數值也保留）', () => {
    const r = resolveHitFeel(makeFile({
      hitFlashColor: 0x000000,
      hitSparkColor: 0x000000,
      deathParticleColor: 0x000000,
      punchScale: 0, // 數值 0 也保留（同譜系）
    }));
    expect(r.hitFlashColor).toBe(0x000000);
    expect(r.hitSparkColor).toBe(0x000000);
    expect(r.deathParticleColor).toBe(0x000000);
    expect(r.punchScale).toBe(0);
  });

  it('對照：非 0 顏色正常覆蓋（證明用的是 override 值）', () => {
    const r = resolveHitFeel(makeFile({ hitSparkColor: 0xff00ff }));
    expect(r.hitSparkColor).toBe(0xff00ff);
  });
});
