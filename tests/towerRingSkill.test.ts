// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  resolveTowerRingParams,
  ringRadiusForIndex,
  createTowerRingState,
  advanceTowerRing,
  ringHitsPlayer,
  DEFAULT_TOWER_RING_PARAMS,
} from '@/systems/towerRingSkill';

describe('towerRingSkill — 魔尖塔依序固定環（★重做：一環接一環、非漣漪擴散）', () => {
  describe('resolveTowerRingParams（吃波騎 schema 欄位，0-nullish）', () => {
    it('新欄位 ringCount/baseRadiusPx/radiusStepPx/ringIntervalSec/ringThicknessPx/energyCost → 採用', () => {
      const p = resolveTowerRingParams({
        ringCount: 5, baseRadiusPx: 100, radiusStepPx: 140, ringIntervalSec: 0.5, ringThicknessPx: 40, energyCost: 3,
      });
      expect(p.ringCount).toBe(5);
      expect(p.baseRadiusPx).toBe(100);
      expect(p.radiusStepPx).toBe(140);
      expect(p.ringIntervalSec).toBe(0.5);
      expect(p.halfThicknessPx).toBe(20); // ringThicknessPx 40 → 半寬 20
      expect(p.energyCost).toBe(3);
    });
    it('缺欄 → 預設', () => {
      const p = resolveTowerRingParams(null);
      expect(p).toEqual(DEFAULT_TOWER_RING_PARAMS);
    });
    it('ringCount 非正 → 預設；baseRadiusPx 0 合法', () => {
      const p = resolveTowerRingParams({ ringCount: 0, baseRadiusPx: 0 });
      expect(p.ringCount).toBe(DEFAULT_TOWER_RING_PARAMS.ringCount);
      expect(p.baseRadiusPx).toBe(0);
    });
  });

  describe('ringRadiusForIndex（第 N 環固定半徑 = base + N×step）', () => {
    const p = resolveTowerRingParams({ ringCount: 4, baseRadius: 90, radiusStepPx: 120 });
    it('第 0 環最小＝baseRadius', () => expect(ringRadiusForIndex(0, p)).toBe(90));
    it('第 1 環＝base+step', () => expect(ringRadiusForIndex(1, p)).toBe(210));
    it('第 3 環＝base+3×step（由內往外遞增）', () => expect(ringRadiusForIndex(3, p)).toBe(90 + 360));
  });

  describe('★advanceTowerRing（依序換環：達間隔→換下一環固定半徑→循環→清命中去重）', () => {
    const p = resolveTowerRingParams({ ringCount: 3, baseRadius: 90, radiusStepPx: 120, ringIntervalSec: 0.6 });
    it('未達間隔 → 不換環', () => {
      const s = createTowerRingState();
      expect(advanceTowerRing(s, 0.3, p).advanced).toBe(false);
      expect(s.ringIndex).toBe(0); // 仍第 0 環
    });
    it('達間隔 → 換到下一環（index+1）+ advanced=true', () => {
      const s = createTowerRingState();
      const r = advanceTowerRing(s, 0.6, p);
      expect(r.advanced).toBe(true);
      expect(s.ringIndex).toBe(1);
    });
    it('★生到第 ringCount 環後循環回第 0 環（週而復始）', () => {
      const s = createTowerRingState(); // index 0
      advanceTowerRing(s, 0.6, p); // →1
      advanceTowerRing(s, 0.6, p); // →2
      advanceTowerRing(s, 0.6, p); // →0（循環，ringCount=3：0,1,2,0）
      expect(s.ringIndex).toBe(0);
    });
    it('★換環時清空 hitPlayersThisRing（新環對同玩家可再扣一次）', () => {
      const s = createTowerRingState();
      s.hitPlayersThisRing.add(0);
      advanceTowerRing(s, 0.6, p);
      expect(s.hitPlayersThisRing.size).toBe(0);
    });
    it('餘數保留（timer 累積不丟）', () => {
      const s = createTowerRingState();
      advanceTowerRing(s, 0.9, p); // 0.9 → 換環，timer 餘 0.3
      expect(s.timer).toBeCloseTo(0.3);
    });
  });

  describe('★ringHitsPlayer（固定半徑環帶 annulus，中心空）', () => {
    const tower = { x: 0, y: 0 };
    const half = 20;
    it('站在環帶上（d≈ringRadius）→ 命中', () => {
      expect(ringHitsPlayer(tower, 200, half, { x: 200, y: 0 }, 20)).toBe(true);
    });
    it('★中心空：玩家在塔中心附近、環半徑大（d 遠小於 ringRadius）→ 不命中', () => {
      expect(ringHitsPlayer(tower, 300, half, { x: 0, y: 0 }, 20)).toBe(false);
    });
    it('環外（d 遠大於 ringRadius）→ 不命中', () => {
      expect(ringHitsPlayer(tower, 100, half, { x: 400, y: 0 }, 20)).toBe(false);
    });
    it('環帶邊界容差 |d-r|==half+playerR → 命中（含等號），差 1px → 不中', () => {
      expect(ringHitsPlayer(tower, 200, half, { x: 240, y: 0 }, 20)).toBe(true); // |240-200|=40==20+20
      expect(ringHitsPlayer(tower, 200, half, { x: 241, y: 0 }, 20)).toBe(false);
    });
    it('斜向距離（3-4-5）', () => {
      expect(ringHitsPlayer(tower, 100, half, { x: 60, y: 80 }, 5)).toBe(true); // d=100
    });
  });
});
