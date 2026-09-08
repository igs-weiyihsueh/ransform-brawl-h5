import { describe, expect, it } from 'vitest';
import {
  pushOutOfPlayer,
  pushOutOfPlayerSmoothed,
  DEFAULT_PLAYER_PUSH_SMOOTH,
} from '@/systems/enemySeparation';

/**
 * pushOutOfPlayerSmoothed 行為驗證（ContactSolver 階段② 玩家推怪防瞬移）。
 * 診斷：舊 pushOutOfPlayer 深度重疊時單幀硬頂到 minDist＝瞬移。平滑版用鬆弛+單幀上限分多幀順順解。
 */
describe('pushOutOfPlayerSmoothed — 玩家推怪平滑防瞬移', () => {
  const minDist = 90; // 玩家真空 50 + 怪 40 例

  it('沒穿透（dist>=minDist）→ 原位不動', () => {
    const r = pushOutOfPlayerSmoothed({ x: 100, y: 0 }, { x: 0, y: 0 }, minDist);
    expect(r).toEqual({ x: 100, y: 0 });
  });

  it('★深度重疊：單幀位移 <= maxStepPx（不瞬移；vs 硬頂版一次彈一大段）', () => {
    // 怪在玩家幾乎重疊處(dist=10)，fullCorrection=80。硬頂版一次彈 70+ → 瞬移。
    const enemy = { x: 10, y: 0 };
    const player = { x: 0, y: 0 };
    const hard = pushOutOfPlayer(enemy, player, minDist);
    const soft = pushOutOfPlayerSmoothed(enemy, player, minDist);
    const hardStep = Math.hypot(hard.x - enemy.x, hard.y - enemy.y);
    const softStep = Math.hypot(soft.x - enemy.x, soft.y - enemy.y);
    expect(hardStep).toBeGreaterThan(50); // 硬頂：一大段（瞬移）
    expect(softStep).toBeLessThanOrEqual(DEFAULT_PLAYER_PUSH_SMOOTH.maxStepPx + 1e-6); // 平滑：夾上限
  });

  it('★方向永遠遠離玩家（沿 enemy→player 反向推出）', () => {
    const r = pushOutOfPlayerSmoothed({ x: 10, y: 0 }, { x: 0, y: 0 }, minDist);
    expect(r.x).toBeGreaterThan(10); // 往 +x 遠離玩家
    expect(r.y).toBeCloseTo(0);
  });

  it('★分多幀收斂到 minDist（連續套用會逐步頂到位、不過衝）', () => {
    const player = { x: 0, y: 0 };
    let e = { x: 5, y: 0 }; // 深度重疊
    for (let i = 0; i < 40; i += 1) e = pushOutOfPlayerSmoothed(e, player, minDist);
    const finalDist = Math.hypot(e.x - player.x, e.y - player.y);
    expect(finalDist).toBeCloseTo(minDist, 1); // 收斂到 minDist，不超過（不過衝穿回另一側）
  });

  it('小重疊（fullCorrection < maxStep 且 鬆弛後很小）→ 一次幾乎解掉、不殘留大穿透', () => {
    // dist=88、minDist=90、fullCorrection=2。鬆弛 0.5 → 1；夠小，一步就近解。
    const player = { x: 0, y: 0 };
    let e = { x: 88, y: 0 };
    for (let i = 0; i < 10; i += 1) e = pushOutOfPlayerSmoothed(e, player, minDist);
    expect(Math.hypot(e.x, e.y)).toBeCloseTo(minDist, 1);
  });

  it('完全重疊（dist~0）→ 往右推（與硬頂版方向一致）、量夾上限', () => {
    const r = pushOutOfPlayerSmoothed({ x: 0, y: 0 }, { x: 0, y: 0 }, minDist);
    expect(r.x).toBeGreaterThan(0); // 往 +x
    expect(r.y).toBeCloseTo(0);
    expect(r.x).toBeLessThanOrEqual(DEFAULT_PLAYER_PUSH_SMOOTH.maxStepPx + 1e-6);
  });

  it('maxStepPx=0（停用上限）→ 退化成純鬆弛（解 fullCorrection×relaxation）', () => {
    // dist=10、fullCorrection=80、relaxation=0.5 → step=40。
    const r = pushOutOfPlayerSmoothed({ x: 10, y: 0 }, { x: 0, y: 0 }, minDist, 0, 0.5);
    expect(r.x - 10).toBeCloseTo(40);
  });
});
