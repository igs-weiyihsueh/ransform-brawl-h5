import { describe, expect, it } from 'vitest';
import { MAP_BOUNDS } from '@/config/mapConfig';
import { FIRE_RAIN, pickFireRainPoint, playersInStrike } from '@/systems/fireRainMath';

/**
 * 天降火雨純邏輯（#10）測試：落點縮邊/不重疊/上限 + 傷害圈內玩家（只傷玩家）。含壞版必紅。
 */
describe('fireRainMath — 落點選擇', () => {
  it('預設值對照 Unity(×PPU)：interval1.5/radius100/warning1/damage1/maxConcurrent3', () => {
    expect(FIRE_RAIN.intervalSec).toBe(1.5);
    expect(FIRE_RAIN.radiusPx).toBe(100);
    expect(FIRE_RAIN.warningSec).toBe(1);
    expect(FIRE_RAIN.damage).toBe(1);
    expect(FIRE_RAIN.maxConcurrent).toBe(3);
  });

  it('縮邊：落點整個火柱圈都在場地內（中心 ≥ minX+r、≤ maxX-r）', () => {
    const p = pickFireRainPoint([], () => 0.5)!; // 中間
    expect(p.x).toBeGreaterThanOrEqual(MAP_BOUNDS.minX + FIRE_RAIN.radiusPx - 1e-6);
    expect(p.x).toBeLessThanOrEqual(MAP_BOUNDS.maxX - FIRE_RAIN.radiusPx + 1e-6);
    expect(p.y).toBeGreaterThanOrEqual(MAP_BOUNDS.minY + FIRE_RAIN.radiusPx - 1e-6);
    expect(p.y).toBeLessThanOrEqual(MAP_BOUNDS.maxY - FIRE_RAIN.radiusPx + 1e-6);
  });

  it('maxConcurrent 上限：在途 3 道 → 回 null（不再選）', () => {
    const three = [{ x: 300, y: 300 }, { x: 700, y: 300 }, { x: 1100, y: 300 }];
    expect(pickFireRainPoint(three, () => 0.5)).toBeNull();
  });

  it('不重疊：新落點與在途保持 ≥ radius×2（rng 逼近既有點時多次嘗試都太近→null）', () => {
    // rng 恆 0.5 → 每次都選正中；已有一道在正中 → 新的太近 → 回 null。
    const center = pickFireRainPoint([], () => 0.5)!;
    const r = pickFireRainPoint([center], () => 0.5);
    expect(r).toBeNull(); // 12 次嘗試都落同點、太近 → 放棄
  });

  // 🔴 壞版對照：縮邊必須生效（落點不貼邊，中心離邊界 ≥ radius）。
  it('壞版對照：落點中心離左邊界 ≥ radius（縮邊，非貼邊 minX）', () => {
    const p = pickFireRainPoint([], () => 0)!; // rng=0 → 落在縮邊後的 minX
    expect(p.x).toBeGreaterThanOrEqual(MAP_BOUNDS.minX + FIRE_RAIN.radiusPx - 1e-6);
    expect(p.x).not.toBe(MAP_BOUNDS.minX); // 非貼原邊界
  });
});

describe('fireRainMath — 傷害判定（只傷玩家）', () => {
  it('圈內玩家被判定命中、圈外不中', () => {
    const center = { x: 500, y: 500 };
    const players = [
      { x: 500, y: 500 }, // 正中，中
      { x: 500 + 99, y: 500 }, // 99<100，中
      { x: 500 + 150, y: 500 }, // 150>100，不中
    ];
    expect(playersInStrike(center, players)).toEqual([0, 1]);
  });

  // 🔴 壞版對照：半徑外玩家不得被判中（否則全場誤傷）。
  it('壞版對照：半徑外玩家不中（非全中）', () => {
    const hit = playersInStrike({ x: 0, y: 0 }, [{ x: 500, y: 500 }]);
    expect(hit).toEqual([]);
  });

  // 🔴 壞版對照：邊界剛好 = radius 算中（<=），> radius 不中。
  it('壞版對照：剛好在半徑邊界算中、超過不中', () => {
    expect(playersInStrike({ x: 0, y: 0 }, [{ x: 100, y: 0 }])).toEqual([0]); // =100 中
    expect(playersInStrike({ x: 0, y: 0 }, [{ x: 101, y: 0 }])).toEqual([]); // >100 不中
  });
});
