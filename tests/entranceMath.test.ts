import { describe, expect, it } from 'vitest';
import {
  ENTRANCE,
  entrancePosition,
  landingX,
  lerp,
  parabolaHeight,
} from '@/systems/entranceMath';

/**
 * 進場跳躍（JumpToField）純數學測試（項目 3）。
 * 進場的 isJumping/真空環切換在 Player entity（Phaser 相依），這裡測純數學：
 * 拋物線、落點分散、進場位置。含壞版必紅。
 */
describe('entranceMath — 進場跳躍', () => {
  it('參數對照 Unity(×PPU=100)：jumpHeight200/duration0.6/spacing150', () => {
    expect(ENTRANCE.jumpHeightPx).toBe(200);
    expect(ENTRANCE.durationSec).toBe(0.6);
    expect(ENTRANCE.landingSpacingPx).toBe(150);
  });

  it('拋物線：t=0/1 高度0（起跳/落地）、t=0.5 最高=jumpHeight', () => {
    expect(parabolaHeight(0)).toBe(0);
    expect(parabolaHeight(1)).toBe(0);
    expect(parabolaHeight(0.5)).toBe(ENTRANCE.jumpHeightPx); // 200×4×0.5×0.5=200
  });

  it('拋物線對稱：t 與 1-t 同高', () => {
    expect(parabolaHeight(0.3)).toBeCloseTo(parabolaHeight(0.7), 6);
  });

  it('落點按 playerId 分散（centerX=960）：P0~P3 = 735/885/1035/1185', () => {
    // (id-1.5)×150 + 960
    expect(landingX(0, 960)).toBe(735); // -2.25×100... = -225 +960
    expect(landingX(1, 960)).toBe(885);
    expect(landingX(2, 960)).toBe(1035);
    expect(landingX(3, 960)).toBe(1185);
  });

  it('落點對稱分散於中央（P0/P3 與中心等距、不疊中央）', () => {
    const c = 960;
    expect(c - landingX(0, c)).toBe(landingX(3, c) - c); // 對稱
    expect(landingX(1, c)).not.toBe(landingX(2, c)); // 不疊
  });

  it('lerp 基本', () => {
    expect(lerp(0, 100, 0)).toBe(0);
    expect(lerp(0, 100, 1)).toBe(100);
    expect(lerp(0, 100, 0.5)).toBe(50);
  });

  it('進場位置：t=0 在起點、t=1 在終點（高度歸0）', () => {
    const p0 = entrancePosition(100, -120, 800, 540, 0);
    expect(p0.x).toBe(100);
    expect(p0.y).toBe(-120);
    const p1 = entrancePosition(100, -120, 800, 540, 1);
    expect(p1.x).toBe(800);
    expect(p1.y).toBe(540);
  });

  it('進場中(t=0.5) y 在基線上方（往上跳、H5 減拋物線）', () => {
    const baseY = lerp(-120, 540, 0.5); // 210
    const p = entrancePosition(100, -120, 800, 540, 0.5);
    expect(p.y).toBe(baseY - ENTRANCE.jumpHeightPx); // 210-200=10，在基線上方
    expect(p.y).toBeLessThan(baseY);
  });

  // 🔴 壞版對照：拋物線若拿掉(恆0)，t=0.5 就不會比基線高（沒跳起來）。
  it('壞版對照：t=0.5 確有跳起（y < 基線，非等於）', () => {
    const baseY = lerp(-120, 540, 0.5);
    const p = entrancePosition(100, -120, 800, 540, 0.5);
    expect(p.y).not.toBe(baseY); // 有拋物線位移
  });

  // 🔴 壞版對照：落點分散若拿掉(全同 centerX)，多人會疊在中央。
  it('壞版對照：四人落點互異（不全等於中心）', () => {
    const c = 960;
    const xs = [landingX(0, c), landingX(1, c), landingX(2, c), landingX(3, c)];
    expect(new Set(xs).size).toBe(4); // 四點互異
    expect(xs.every((x) => x === c)).toBe(false); // 非全疊中央
  });
});
