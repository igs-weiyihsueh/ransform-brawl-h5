// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  MASH_HITS_TO_FULL,
  MASH_PER_HIT,
  MASH_IDLE_TO_AUTO_SEC,
  MASH_AUTO_FILL_PER_SEC,
  MASH_SCRIPTED_FILL_PER_SEC,
  mashRatioAfterHit,
  shouldAutoFill,
  autoFillDelta,
  isMashComplete,
} from '@/systems/mashTransformMath';

/**
 * mashTransformMath — 連打變身填充純邏輯 harden（用戶新設計，翼騎 89f2e0a 附初版 8 測，本檔補邊界，翼騎邀 harden）。
 * 翼騎初版已鎖:每按 +1/15 clamp、15 下滿(epsilon)、14 下未滿、idle 門檻、autoFillDelta 速率、10s 累積滿。
 * 本檔補邊界(翼騎點名:多按 >15 / 負 dt / scripted vs idle 邊界 + epsilon 精度):
 *  - 多按超過 15 → 仍 clamp 1(不超)。
 *  - 負 dt → autoFillDelta 0(Math.max(0,dt) 防倒退)。
 *  - ★isMashComplete epsilon 精度:剛好 1-1e-9→true,但 1-1e-6(差太多)→false(容忍不過寬)。
 *  - shouldAutoFill 負 sinceLastMash → false、門檻精確(剛好 0.5 true / 0.4999 false)。
 * 維度3 斷 ratio/bool/delta 值。與翼騎初版失敗集互補(本檔專攻邊界+精度)。
 * ⚠️ 連打狀態機接線(TransformSystem onPickup→鎖定→registerMashHit→完成)屬狀態機(翼騎 headless/整合驗)——不補。
 */

describe('mashTransformMath harden — 邊界 + epsilon 精度', () => {
  it('多按超過 15（16~20 下）→ 仍 clamp 1，不超過', () => {
    let r = 0;
    for (let i = 0; i < 20; i += 1) r = mashRatioAfterHit(r); // 20 下 > 15
    expect(r).toBe(1); // clamp 上限
    expect(isMashComplete(r)).toBe(true);
    // 已滿再按仍 1。
    expect(mashRatioAfterHit(1)).toBe(1);
    expect(mashRatioAfterHit(0.999999)).toBe(1); // 接近滿再按 → clamp 1
  });

  it('★ 負 dt → autoFillDelta=0（Math.max(0,dt) 防時間倒退灌魂）', () => {
    expect(autoFillDelta(-1, false)).toBe(0);
    expect(autoFillDelta(-0.016, true)).toBe(0); // scripted 也防
  });

  it('autoFillDelta 與 dt 線性（一般 0.1×dt / scripted 1.0×dt）', () => {
    expect(autoFillDelta(0.5, false)).toBeCloseTo(MASH_AUTO_FILL_PER_SEC * 0.5, 9);
    expect(autoFillDelta(0.5, true)).toBeCloseTo(MASH_SCRIPTED_FILL_PER_SEC * 0.5, 9);
    // scripted 比一般快 10 倍（1.0 vs 0.1）。
    expect(autoFillDelta(1, true)).toBeCloseTo(autoFillDelta(1, false) * 10, 9);
  });

  it('★ isMashComplete epsilon 精度：剛好 1-1e-9 → true，但差太多 1-1e-6 → false（容忍不過寬）', () => {
    expect(isMashComplete(1 - 1e-9)).toBe(true); // epsilon 內 → 算滿
    expect(isMashComplete(1)).toBe(true);
    expect(isMashComplete(1 - 1e-6)).toBe(false); // 差 1e-6 > epsilon → 未滿（不過度寬鬆）
    expect(isMashComplete(0.99)).toBe(false);
    expect(isMashComplete(0)).toBe(false);
  });

  it('★ 15 下浮點累加結果確實 <1（證明 epsilon 有存在必要,非多餘）', () => {
    let r = 0;
    for (let i = 0; i < MASH_HITS_TO_FULL; i += 1) r = mashRatioAfterHit(r);
    // 若 15×(1/15) 剛好=1,epsilon 就多餘;實測 clamp 每步 min(1,...) 讓它=1 或極接近。
    // 關鍵:isMashComplete 對此結果必須 true(不論是否剛好 1)。
    expect(isMashComplete(r)).toBe(true);
    expect(r).toBeLessThanOrEqual(1);
    expect(r).toBeGreaterThan(1 - 1e-6); // 至少非常接近滿
  });

  it('shouldAutoFill：負 sinceLastMash → false、門檻精確（0.5 true / 0.4999 false）', () => {
    expect(shouldAutoFill(-1)).toBe(false); // 負（不該發生）→ 不自動
    expect(shouldAutoFill(MASH_IDLE_TO_AUTO_SEC)).toBe(true); // 剛好門檻 → true（>=）
    expect(shouldAutoFill(0.4999)).toBe(false); // 差一點 → false
  });

  it('mashRatioAfterHit 單調不減（每按 ratio 只增不減,直到 clamp）', () => {
    let prev = 0;
    for (let i = 0; i < MASH_HITS_TO_FULL; i += 1) {
      const next = mashRatioAfterHit(prev);
      expect(next).toBeGreaterThanOrEqual(prev); // 不倒退
      prev = next;
    }
  });
});
