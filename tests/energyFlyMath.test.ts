import { describe, expect, it } from 'vitest';
import {
  ENERGY_FLY,
  flyAlpha,
  flyPosition,
  flyScale,
  lerp,
} from '@/systems/energyFlyMath';

/**
 * 能量飛寶盒表演純數學測試（第4項）。
 * 飛光的 Phaser 繪製/tween 在 EffectSystem（相依 Phaser），這裡測純數學：
 * 飛行插值、縮放脈動、透明淡出。含壞版必紅。
 * ⚠️ 純視覺參數；chest 數值(addCharge)與此解耦、不受影響。
 */
describe('energyFlyMath — 能量飛光', () => {
  it('飛光時長對照 Unity RewardFlowUI ≈0.7s', () => {
    expect(ENERGY_FLY.durationSec).toBe(0.7);
  });

  it('lerp 基本', () => {
    expect(lerp(0, 100, 0)).toBe(0);
    expect(lerp(0, 100, 1)).toBe(100);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it('飛行位置：t=0 起點、t=1 終點、t=0.5 中點', () => {
    expect(flyPosition(100, 200, 900, 1000, 0)).toEqual({ x: 100, y: 200 });
    expect(flyPosition(100, 200, 900, 1000, 1)).toEqual({ x: 900, y: 1000 });
    expect(flyPosition(100, 200, 900, 1000, 0.5)).toEqual({ x: 500, y: 600 });
  });

  it('縮放脈動：圍繞基準 1.0、幅度 0.35 內', () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      const s = flyScale(t);
      expect(s).toBeGreaterThanOrEqual(ENERGY_FLY.scaleBase - ENERGY_FLY.scaleAmp - 1e-9);
      expect(s).toBeLessThanOrEqual(ENERGY_FLY.scaleBase + ENERGY_FLY.scaleAmp + 1e-9);
    }
  });

  it('透明：前段不透明、尾段(>0.8)漸淡、t=1 全透明', () => {
    expect(flyAlpha(0)).toBe(1);
    expect(flyAlpha(0.8)).toBe(1);
    expect(flyAlpha(1)).toBe(0);
    expect(flyAlpha(0.9)).toBeCloseTo(0.5, 6); // (0.9-0.8)/0.2=0.5 → 1-0.5
  });

  // 🔴 壞版對照：飛光位置必須真的從起點移動到終點（非恆在起點）。
  it('壞版對照：t 前進時位置確有移動（非卡在起點）', () => {
    const a = flyPosition(0, 0, 800, 0, 0.25);
    const b = flyPosition(0, 0, 800, 0, 0.75);
    expect(a.x).toBe(200);
    expect(b.x).toBe(600);
    expect(b.x).toBeGreaterThan(a.x); // 有往終點前進
  });

  // 🔴 壞版對照：縮放要有脈動（不同 t 的 scale 非恆定）。
  it('壞版對照：縮放隨 t 脈動（非恆1）', () => {
    const vals = [flyScale(0.08), flyScale(0.16), flyScale(0.25)];
    const allOne = vals.every((v) => Math.abs(v - 1) < 1e-9);
    expect(allOne).toBe(false); // 有脈動
  });
});
