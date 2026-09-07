// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { nearestPoint, lungeDecay } from '@/systems/targetingMath';

/**
 * targetingMath — 玩家 auto-aim + 攻擊前移 lunge（用戶第十一輪#2，翼騎 231b18c，additive）。
 * ① nearestPoint<T>(from, points): T|null — 找離 from 最近候選點（auto-aim 找最近怪）：
 *      空→null、多點比 d²(不開根)、★平手回先出現者(`<` 非 `<=`)、回原物件參照。
 * ② lungeDecay(vel, dt, factor, stopEps=1): number — lunge 速度指數衰減：
 *      decayed = vel × factor^(dt×60)；|decayed|<stopEps→0。★幀率無關(dt×60 冪次)、負對稱、近 0 歸零。
 * 維度3 斷回傳點身份 + 衰減數值。含壞版必紅(平手 <= / 忘 dt×60 / 沒 stopEps / abs 漏負)。
 * ⚠️ PlayerControlSystem auto-aim 傳 aim + Player startLunge/updateLunge 接線屬狀態機(翼騎 headless 驗怪上方→shape/斬光朝怪、lunge 前戳不回彈)——不補。
 */

describe('nearestPoint — auto-aim 找最近候選點', () => {
  it('空清單 → null', () => {
    expect(nearestPoint({ x: 0, y: 0 }, [])).toBeNull();
  });

  it('單點 → 回該點', () => {
    const p = { x: 5, y: 5 };
    expect(nearestPoint({ x: 0, y: 0 }, [p])).toBe(p);
  });

  it('多點 → 回距離最小者（from(0,0),[(10,0),(3,4),(100,0)]→(3,4) d=5）', () => {
    const pts = [{ x: 10, y: 0 }, { x: 3, y: 4 }, { x: 100, y: 0 }];
    expect(nearestPoint({ x: 0, y: 0 }, pts)).toBe(pts[1]); // d=5 < 10 < 100
  });

  it('★ 距離相同 → 回先出現者（穩定，< 非 <=）', () => {
    const pts = [{ x: 3, y: 4 }, { x: -3, y: -4 }, { x: 4, y: 3 }]; // 三點皆 d=5 平手
    expect(nearestPoint({ x: 0, y: 0 }, pts)).toBe(pts[0]); // 回第一個
  });

  it('負座標正常（比 d² 不受負號影響）', () => {
    const pts = [{ x: -100, y: -100 }, { x: -2, y: -1 }];
    expect(nearestPoint({ x: 0, y: 0 }, pts)).toBe(pts[1]); // d²=5 < 20000
  });

  it('回傳原物件參照（非複製，身份 ===）', () => {
    const target = { x: 7, y: 7, id: 'enemy_42' };
    const r = nearestPoint({ x: 0, y: 0 }, [target]);
    expect(r).toBe(target); // 同一參照
    expect((r as typeof target).id).toBe('enemy_42'); // 帶原物件額外欄位
  });
});

describe('lungeDecay — lunge 速度指數衰減（幀率無關）', () => {
  const FACTOR = 0.82;

  it('dt=1/60（一幀）→ 衰減 factor 倍（600×0.82=492）', () => {
    expect(lungeDecay(600, 1 / 60, FACTOR)).toBeCloseTo(492);
  });

  it('★ dt=2/60（兩幀）→ 衰減 factor²（幀率無關：dt×60 冪次）', () => {
    expect(lungeDecay(600, 2 / 60, FACTOR)).toBeCloseTo(600 * FACTOR * FACTOR); // 403.44
  });

  it('★ dt 拆兩次 vs 一次大 dt 結果一致（幀率無關性驗證）', () => {
    // 一次 dt=2/60 應等於連兩次 dt=1/60。
    const once = lungeDecay(600, 2 / 60, FACTOR);
    const step1 = lungeDecay(600, 1 / 60, FACTOR);
    const step2 = lungeDecay(step1, 1 / 60, FACTOR);
    expect(once).toBeCloseTo(step2);
  });

  it('★ 近 0 歸零（|decayed|<stopEps=1 → 0，避免無限小尾巴）', () => {
    expect(lungeDecay(0.5, 1 / 60, FACTOR)).toBe(0); // 0.5×0.82=0.41 <1 → 0
    expect(lungeDecay(1.1, 1 / 60, FACTOR)).toBe(0); // 1.1×0.82=0.902 <1 → 0
  });

  it('★ 負速度對稱（-600 → -492；負值也歸零）', () => {
    expect(lungeDecay(-600, 1 / 60, FACTOR)).toBeCloseTo(-492); // 對稱
    expect(lungeDecay(-0.5, 1 / 60, FACTOR)).toBe(0); // abs 判斷含負 → 近 0 也歸零
  });

  it('factor=1 → 不衰減（vel 原樣，>stopEps）', () => {
    expect(lungeDecay(600, 1 / 60, 1)).toBeCloseTo(600);
  });

  it('vel=0 → 0', () => {
    expect(lungeDecay(0, 1 / 60, FACTOR)).toBe(0);
  });

  it('自訂 stopEps：stopEps=10 → 8.2(<10) 歸零', () => {
    expect(lungeDecay(10, 1 / 60, FACTOR, 10)).toBe(0); // 10×0.82=8.2 <10 → 0
  });
});
