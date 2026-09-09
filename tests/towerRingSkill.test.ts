// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  resolveTowerRingParams,
  spawnRing,
  advanceRing,
  ringHitsPlayer,
  tickRingTimer,
  DEFAULT_TOWER_RING_PARAMS,
} from '@/systems/towerRingSkill';

describe('towerRingSkill — 魔尖塔環狀擴散技純邏輯', () => {
  describe('resolveTowerRingParams（RingSkillParams→執行期，0-nullish 合法）', () => {
    it('提供值 → 採用', () => {
      const p = resolveTowerRingParams({ intervalSec: 3, expandPxPerRing: 200, energyCost: 1 });
      expect(p.intervalSec).toBe(3);
      expect(p.expandPxPerSec).toBe(200);
      expect(p.energyCost).toBe(1);
    });
    it('expandPxPerRing=0 合法（不擴大）、energyCost=0 合法（不扣）', () => {
      const p = resolveTowerRingParams({ intervalSec: 2, expandPxPerRing: 0, energyCost: 0 });
      expect(p.expandPxPerSec).toBe(0);
      expect(p.energyCost).toBe(0);
    });
    it('缺欄/非正 intervalSec → 用預設', () => {
      const p = resolveTowerRingParams(null);
      expect(p).toMatchObject({
        intervalSec: DEFAULT_TOWER_RING_PARAMS.intervalSec,
        expandPxPerSec: DEFAULT_TOWER_RING_PARAMS.expandPxPerSec,
        energyCost: DEFAULT_TOWER_RING_PARAMS.energyCost,
      });
      const p2 = resolveTowerRingParams({ intervalSec: 0, expandPxPerRing: 100, energyCost: 2 });
      expect(p2.intervalSec).toBe(DEFAULT_TOWER_RING_PARAMS.intervalSec); // 0 非正 → 預設
    });
  });

  describe('spawnRing + advanceRing', () => {
    const params = resolveTowerRingParams({ intervalSec: 2, expandPxPerRing: 100, energyCost: 2 });
    it('新環半徑從 0 開始、hitPlayers 空', () => {
      const r = spawnRing({ x: 50, y: 60 }, params);
      expect(r.radius).toBe(0);
      expect(r.center).toEqual({ x: 50, y: 60 });
      expect(r.hitPlayers.size).toBe(0);
    });
    it('advanceRing 每幀半徑 += expandPxPerSec×dt', () => {
      const r = spawnRing({ x: 0, y: 0 }, params);
      advanceRing(r, 0.5, params);
      expect(r.radius).toBeCloseTo(50); // 100×0.5
      advanceRing(r, 0.5, params);
      expect(r.radius).toBeCloseTo(100);
    });
    it('超過 maxRadius → advanceRing 回 false（該移除）', () => {
      const small = resolveTowerRingParams({ intervalSec: 2, expandPxPerRing: 100, energyCost: 2 }, { maxRadiusPx: 60 });
      const r = spawnRing({ x: 0, y: 0 }, small);
      expect(advanceRing(r, 0.5, small)).toBe(true); // r=50 <=60
      expect(advanceRing(r, 0.5, small)).toBe(false); // r=100 >60 → 移除
    });
  });

  describe('★ringHitsPlayer（環圈判定，中心空 annulus）', () => {
    const params = resolveTowerRingParams({ intervalSec: 2, expandPxPerRing: 100, energyCost: 2 }, { halfThickness: 18 });
    const tower = { x: 0, y: 0 };

    it('環圈剛好掃到玩家（d≈radius）→ 命中', () => {
      const r = spawnRing(tower, params);
      r.radius = 100;
      // 玩家在距塔 100 處、半徑 20 → |100-100|=0 <= 18+20 → 命中
      expect(ringHitsPlayer(r, { x: 100, y: 0 }, 20)).toBe(true);
    });
    it('★中心空：環已擴很大、玩家在中心附近（d 遠小於 radius）→ 不命中（環內側是空的）', () => {
      const r = spawnRing(tower, params);
      r.radius = 300;
      // 玩家在塔中心(d=0)、環半徑 300 → |0-300|=300 > 18+20 → 不命中（環早掃過中心了）
      expect(ringHitsPlayer(r, { x: 0, y: 0 }, 20)).toBe(false);
    });
    it('環還沒擴到玩家（radius 遠小於 d）→ 不命中', () => {
      const r = spawnRing(tower, params);
      r.radius = 50;
      // 玩家在距塔 300 處 → |300-50|=250 > 18+20 → 環還沒到
      expect(ringHitsPlayer(r, { x: 300, y: 0 }, 20)).toBe(false);
    });
    it('環帶邊緣容差：|d-radius| == half+r → 命中（含等號）', () => {
      const r = spawnRing(tower, params);
      r.radius = 100;
      // d=138、radius=100 → |138-100|=38 == 18+20 → 命中（邊界）
      expect(ringHitsPlayer(r, { x: 138, y: 0 }, 20)).toBe(true);
      expect(ringHitsPlayer(r, { x: 139, y: 0 }, 20)).toBe(false); // 差 1px → 不命中
    });
    it('斜向距離也對（3-4-5）', () => {
      const r = spawnRing(tower, params);
      r.radius = 100;
      // 玩家 (60,80) → d=100 → 命中
      expect(ringHitsPlayer(r, { x: 60, y: 80 }, 5)).toBe(true);
    });
  });

  describe('tickRingTimer（達間隔才生環）', () => {
    it('累積未達 intervalSec → 不生', () => {
      const { fire, timer } = tickRingTimer(0.5, 0.5, 2);
      expect(fire).toBe(false);
      expect(timer).toBeCloseTo(1.0);
    });
    it('達 intervalSec → 生環 + timer 扣掉間隔（保留餘數）', () => {
      const { fire, timer } = tickRingTimer(1.8, 0.5, 2);
      expect(fire).toBe(true);
      expect(timer).toBeCloseTo(0.3); // 2.3 - 2
    });
  });

  describe('hitPlayers 去重（一個環對同玩家只扣一次）', () => {
    it('呼叫端用 ring.hitPlayers 記已扣玩家 → 同環第二次不重扣', () => {
      const params = resolveTowerRingParams({ intervalSec: 2, expandPxPerRing: 100, energyCost: 2 });
      const r = spawnRing({ x: 0, y: 0 }, params);
      r.radius = 100;
      const playerCenter = { x: 100, y: 0 };
      const pid = 0;
      // 首次命中 + 記錄
      expect(ringHitsPlayer(r, playerCenter, 20) && !r.hitPlayers.has(pid)).toBe(true);
      r.hitPlayers.add(pid);
      // 第二次雖仍幾何命中，但已記錄 → 呼叫端不重扣
      expect(ringHitsPlayer(r, playerCenter, 20) && !r.hitPlayers.has(pid)).toBe(false);
    });
  });
});
