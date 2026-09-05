// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pushLoadFactor } from '@/systems/enemySeparation';

/**
 * pushLoadFactor 純函式（推怪負重，翼騎 d904d6a，搬 Unity pushResistance/pushMinSpeedFactor）。
 * factor = max(minFactor, 1/(1 + resistance×pushedCount))：敵人越多推越有阻力(移動越慢)、有下限。
 * 只影響移動不影響衝刺(呼叫端 Player.move ×pushLoadMult)。維度3 斷實際 factor 值,非 call-count。含壞版必紅。
 * ⚠️ computePushLoad 每幀數真空圈敵人 + 排除 dead/菁英immovable/grabber 屬 entity/系統層(需 boot)不補;
 *    pushLoadFactor 降速公式純函式補足。
 */
const R = 0.35; // Unity pushResistance
const MIN = 0.3; // Unity pushMinSpeedFactor

describe('pushLoadFactor — 推怪負重降速公式', () => {
  it('0 隻 → 1（不降速，推 0 隻正常速）', () => {
    expect(pushLoadFactor(0, R, MIN)).toBe(1);
  });

  it('遞減：1隻≈0.741、2隻≈0.588（推越多越慢，resistance×count）', () => {
    expect(pushLoadFactor(1, R, MIN)).toBeCloseTo(1 / (1 + 0.35), 4); // 0.7407
    expect(pushLoadFactor(2, R, MIN)).toBeCloseTo(1 / (1 + 0.7), 4); // 0.5882
    // 單調遞減：越多隻 factor 越小。
    expect(pushLoadFactor(2, R, MIN)).toBeLessThan(pushLoadFactor(1, R, MIN));
    expect(pushLoadFactor(1, R, MIN)).toBeLessThan(pushLoadFactor(0, R, MIN));
  });

  it('★ clamp 下限：很多隻(10隻 公式 0.222)→ 觸底 minFactor(0.3)、不再更低（別龜速到0）', () => {
    // 10 隻：1/(1+3.5)=0.2222 < 0.3 → clamp 到 0.3。
    expect(pushLoadFactor(10, R, MIN)).toBe(0.3);
    // 更多隻也不低於下限。
    expect(pushLoadFactor(100, R, MIN)).toBe(0.3);
    expect(pushLoadFactor(10, R, MIN)).toBeGreaterThanOrEqual(MIN);
  });

  it('剛好觸底邊界前後：未達下限照公式、達下限後夾住', () => {
    // 找一個公式值略高於 0.3 的：count=6 → 1/(1+2.1)=0.3226 > 0.3 → 用公式。
    expect(pushLoadFactor(6, R, MIN)).toBeCloseTo(1 / (1 + 2.1), 4);
    expect(pushLoadFactor(6, R, MIN)).toBeGreaterThan(0.3);
    // count=7 → 1/(1+2.45)=0.2899 < 0.3 → 夾到 0.3。
    expect(pushLoadFactor(7, R, MIN)).toBe(0.3);
  });

  it('防呆：負數 pushedCount → 1（當 0 隻，不異常放大）', () => {
    expect(pushLoadFactor(-5, R, MIN)).toBe(1);
    expect(pushLoadFactor(-1, R, MIN)).toBe(1);
  });
});
