// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  mashAttractStep,
  isWithinMashKnockback,
  MASH_ATTRACT_RADIUS_PX,
  MASH_ATTRACT_SPEED_PX_SEC,
  MASH_ATTRACT_MIN_DIST_PX,
  MASH_KNOCKBACK_RADIUS_PX,
} from '@/systems/mashTransformMath';

/**
 * mashTransformMath 吸怪/震開 — 連打變身 3 演出強化（用戶新設計，翼騎 81539c9，additive）。
 * 讀 src 81539c9：
 *  - mashAttractStep(pos,center,dt,radius=340,speed=95,minDist=44) → 本幀新位置(新物件)：
 *      dist>radius 或 dist<=minDist → 原位不動；否則往 center 移 min(speed×max(0,dt), dist−minDist)
 *      （不越過 minDist、不 overshoot、負 dt 安全、沿連線）。
 *  - isWithinMashKnockback(dist,radius=360) → dist<=radius（含邊界）。
 * 維度3 斷位置/bool。含壞版必紅(超範圍沒擋不動/minDist 沒擋/overshoot/邊界含否)。
 * ⚠️ Enemy.applyMashAttract/applyMashKnockback(immovable 豁免) + TransformSystem enterMash footGlow 接線屬狀態機(翼騎驗)——不補。
 */

const C = { x: 0, y: 0 }; // center

describe('mashAttractStep — 連打吸怪本幀位移', () => {
  it('★ dist > radius(340) → 原位不動（範圍外不吸）', () => {
    const pos = { x: 400, y: 0 }; // dist 400 > 340
    expect(mashAttractStep(pos, C, 1)).toEqual({ x: 400, y: 0 });
  });

  it('★ dist <= minDist(44) → 原位不動（已夠近不再吸,避免抖動/穿模）', () => {
    const pos = { x: 40, y: 0 }; // dist 40 <= 44
    expect(mashAttractStep(pos, C, 1)).toEqual({ x: 40, y: 0 });
    // 剛好 =minDist 也不動（<=）。
    expect(mashAttractStep({ x: 44, y: 0 }, C, 1)).toEqual({ x: 44, y: 0 });
  });

  it('正常拉近：範圍內移 speed×dt 往 center（沿連線）', () => {
    const pos = { x: 200, y: 0 }; // dist 200，在 (44,340) 間
    const r = mashAttractStep(pos, C, 0.1); // move=min(95×0.1=9.5, 200−44=156)=9.5
    expect(r.x).toBeCloseTo(200 - 9.5); // 往 center(左)移 9.5
    expect(r.y).toBeCloseTo(0);
  });

  it('沿連線斜向移動（不只水平）', () => {
    const pos = { x: 60, y: 80 }; // dist 100，在範圍內
    const r = mashAttractStep(pos, C, 0.1); // move=min(9.5, 100−44=56)=9.5；單位向量(-0.6,-0.8)
    expect(r.x).toBeCloseTo(60 - 9.5 * 0.6); // 60-5.7
    expect(r.y).toBeCloseTo(80 - 9.5 * 0.8); // 80-7.6
    expect(Math.hypot(r.x, r.y)).toBeCloseTo(100 - 9.5); // 沿連線 → 新距離=舊-move
  });

  it('★ 剩餘距離 < 步長 → 只走到 minDist,不 overshoot 越過', () => {
    const pos = { x: 50, y: 0 }; // dist 50，剩餘到 minDist = 50−44 = 6
    const r = mashAttractStep(pos, C, 1); // move=min(95×1=95, 6)=6 → 走到 44（=minDist）
    expect(r.x).toBeCloseTo(44); // 剛好到 minDist,不衝過 center
    expect(Math.hypot(r.x, r.y)).toBeGreaterThanOrEqual(MASH_ATTRACT_MIN_DIST_PX - 1e-6);
  });

  it('★ dt=0 → 不動（move=0）', () => {
    expect(mashAttractStep({ x: 200, y: 0 }, C, 0)).toEqual({ x: 200, y: 0 });
  });

  it('★ 負 dt → 不動（Math.max(0,dt),不倒退）', () => {
    expect(mashAttractStep({ x: 200, y: 0 }, C, -1)).toEqual({ x: 200, y: 0 });
  });

  it('回新物件（不改原 pos）', () => {
    const pos = { x: 200, y: 0 };
    const r = mashAttractStep(pos, C, 0.1);
    expect(r).not.toBe(pos); // 新物件
    expect(pos).toEqual({ x: 200, y: 0 }); // 原輸入不變
  });

  it('★ 自訂參數：radius/speed/minDist 可覆蓋預設', () => {
    // radius=100：dist 150>100 → 不動。
    expect(mashAttractStep({ x: 150, y: 0 }, C, 1, 100)).toEqual({ x: 150, y: 0 });
    // speed=50：dist 200,move=min(50×0.1=5,156)=5。
    expect(mashAttractStep({ x: 200, y: 0 }, C, 0.1, 340, 50).x).toBeCloseTo(195);
  });
});

describe('isWithinMashKnockback — 完成震開範圍（含邊界）', () => {
  it('dist < radius(360) → true', () => {
    expect(isWithinMashKnockback(100)).toBe(true);
    expect(isWithinMashKnockback(0)).toBe(true);
  });

  it('★ dist = radius(360) → true（含邊界 <=）', () => {
    expect(isWithinMashKnockback(MASH_KNOCKBACK_RADIUS_PX)).toBe(true); // 360 含
  });

  it('★ dist > radius → false', () => {
    expect(isWithinMashKnockback(360.01)).toBe(false);
    expect(isWithinMashKnockback(500)).toBe(false);
  });

  it('自訂 radius 覆蓋預設', () => {
    expect(isWithinMashKnockback(150, 100)).toBe(false); // 150 > 100
    expect(isWithinMashKnockback(100, 100)).toBe(true); // =100 含
  });
});
