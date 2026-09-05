// @vitest-environment jsdom
/**
 * 多人遷移 S5 ④ — WaveSystem 波次×人數縮放測試。翼騎 S5 = 31ee717。
 *
 * 波次難度依人數縮放：killQuota/maxAlive/spawnThreshold × playerCountScale
 *   playerCountScale = 1 + (n-1)*0.5 → 1人×1 / 2人×1.5 / 3人×2 / 4人×2.5（n=players.length）。
 *
 * 測 playerCountScale 的縮放值（private，反射呼叫）+ count 邊界。
 * ⚠️ 這是「多人該變難」的鑑別：壞版忽略 playerCount（恆×1）→ 多人沒變難 → 紅。
 */
import { describe, expect, it } from 'vitest';
import { WaveSystem } from '@/systems/WaveSystem';
import type { GameContext } from '@/systems/GameContext';

/** 建 WaveSystem（注入 previewLevels 避免 fetch）+ N 個 player 的 fake ctx。 */
function makeWave(playerCount: number): WaveSystem {
  const players = Array.from({ length: playerCount }, (_v, i) => ({ playerId: i }));
  const sys = new WaveSystem([]); // preloadedLevels=[] → 不 fetch
  sys.init({ players } as unknown as GameContext);
  return sys;
}

/** 反射取 private playerCountScale()。 */
function scaleOf(sys: WaveSystem): number {
  return (sys as unknown as { playerCountScale: () => number }).playerCountScale();
}

describe('WaveSystem — S5 ④ playerCountScale（波次×人數）', () => {
  it('1 人 → ×1', () => {
    expect(scaleOf(makeWave(1))).toBeCloseTo(1);
  });
  it('2 人 → ×1.5', () => {
    expect(scaleOf(makeWave(2))).toBeCloseTo(1.5);
  });
  it('3 人 → ×2', () => {
    expect(scaleOf(makeWave(3))).toBeCloseTo(2);
  });
  it('4 人 → ×2.5', () => {
    expect(scaleOf(makeWave(4))).toBeCloseTo(2.5);
  });

  it('縮放隨人數單調遞增（1<2<3<4）', () => {
    const s = [1, 2, 3, 4].map((n) => scaleOf(makeWave(n)));
    expect(s[0]).toBeLessThan(s[1]);
    expect(s[1]).toBeLessThan(s[2]);
    expect(s[2]).toBeLessThan(s[3]);
  });

  it('邊界：0 人也退化為 ×1（Math.max(1,n)）', () => {
    // 理論上不會 0 人，但 playerCountScale 用 max(1,n) 防呆 → 仍 ×1（不會 <1 或負）。
    expect(scaleOf(makeWave(0))).toBeCloseTo(1);
  });
});
