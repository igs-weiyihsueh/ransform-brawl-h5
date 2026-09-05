// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  FIRE_RAIN_FALLBACK,
  FIRE_RAIN_PRESETS,
  getFireRainPreset,
  isFireRainPreset,
  resolveFireRainForEvent,
} from '@/config/fireRainConfig';

/**
 * fireRainConfig 火雨 preset 純函式（用戶試玩#4 火雨事件編輯器，翼騎 60cdb41）。
 * Event 節點 eventPresetName 填火雨 preset 名→純火雨波;守護 preset 帶 attachFireRain→守護+火雨;
 * 純守護→不觸發。照 guardConfig preset 模式,不動凍結 levelSchema。含壞版必紅。
 * ⚠️ FireRainSystem/WaveSystem.getActiveFireRainPreset 每幀讀取入口屬 entity/狀態機層(需 boot)，
 *    見末段評估;決策核心 resolveFireRainForEvent 純函式完整鑑別。維度3 斷實際 preset/bool。
 */

describe('isFireRainPreset — 火雨 preset 名判斷', () => {
  it('火雨 preset 名 → true（FireRain/FireRainLight/FireRainHeavy）', () => {
    expect(isFireRainPreset('FireRain')).toBe(true);
    expect(isFireRainPreset('FireRainLight')).toBe(true);
    expect(isFireRainPreset('FireRainHeavy')).toBe(true);
  });

  it('守護名/未定義/空 → false（Guard60、undefined、空字串、亂填）', () => {
    expect(isFireRainPreset('Guard60')).toBe(false);
    expect(isFireRainPreset(undefined)).toBe(false);
    expect(isFireRainPreset('')).toBe(false);
    expect(isFireRainPreset('隨便')).toBe(false);
  });
});

describe('getFireRainPreset — 依名取 preset（查無 fallback）', () => {
  it('取對應 preset：FireRain=interval1.5、FireRainHeavy=burstCount2/duration25', () => {
    expect(getFireRainPreset('FireRain').intervalSec).toBe(1.5);
    expect(getFireRainPreset('FireRainHeavy').burstCount).toBe(2);
    expect(getFireRainPreset('FireRainHeavy').durationSec).toBe(25);
  });

  it('查無（守護名/undefined/亂填）→ fallback（=標準 FireRain）', () => {
    expect(getFireRainPreset('Guard60')).toBe(FIRE_RAIN_FALLBACK);
    expect(getFireRainPreset(undefined)).toBe(FIRE_RAIN_FALLBACK);
    expect(getFireRainPreset('亂填')).toBe(FIRE_RAIN_FALLBACK);
    expect(FIRE_RAIN_FALLBACK).toBe(FIRE_RAIN_PRESETS.FireRain); // fallback = 標準
  });
});

describe('resolveFireRainForEvent — Event 節點該用哪組火雨（三分支）', () => {
  it('火雨 preset 名 → 該火雨 preset（純火雨波，不管 attach 旗標）', () => {
    expect(resolveFireRainForEvent('FireRain', false)).toBe(FIRE_RAIN_PRESETS.FireRain);
    expect(resolveFireRainForEvent('FireRainHeavy', false)).toBe(FIRE_RAIN_PRESETS.FireRainHeavy);
    // 火雨名優先於 attach（火雨名本身就決定，不看守護旗標）。
    expect(resolveFireRainForEvent('FireRainLight', true)).toBe(FIRE_RAIN_PRESETS.FireRainLight);
  });

  it('純守護名 + attach=false → null（不觸發火雨）', () => {
    expect(resolveFireRainForEvent('Guard60', false)).toBeNull();
    expect(resolveFireRainForEvent(undefined, false)).toBeNull();
  });

  it('守護名 + attach=true → 標準 FireRain（守護+火雨）', () => {
    expect(resolveFireRainForEvent('Guard60', true)).toBe(FIRE_RAIN_PRESETS.FireRain);
    expect(resolveFireRainForEvent(undefined, true)).toBe(FIRE_RAIN_PRESETS.FireRain);
  });

  // 🔴 壞版對照：火雨名沒判 → 純火雨 Event 不觸發火雨（回 null，火雨波失效）。
  it('壞版對照：火雨名 FireRain 必回非 null（純火雨波要觸發）', () => {
    expect(resolveFireRainForEvent('FireRain', false)).not.toBeNull();
  });

  // 🔴 壞版對照：attach 沒判 → 守護+火雨（attach=true）漏觸發火雨（回 null）。
  it('壞版對照：守護 attach=true 必回非 null（守護+火雨要觸發）', () => {
    expect(resolveFireRainForEvent('Guard60', true)).not.toBeNull();
  });

  // 🔴 壞版對照：純守護（attach=false）不得誤觸發火雨（必 null）。
  it('壞版對照：純守護 attach=false 必回 null（不誤觸發）', () => {
    expect(resolveFireRainForEvent('Guard60', false)).toBeNull();
  });
});
