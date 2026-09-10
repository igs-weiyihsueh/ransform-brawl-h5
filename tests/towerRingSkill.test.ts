// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  resolveTowerRingParams,
  ringRadiusForIndex,
  createTowerRingState,
  tickTowerRingPhase,
  ringHitsPlayer,
  resolveTowerPositions,
  defaultTowerPositions,
  DEFAULT_TOWER_RING_PARAMS,
  effectiveInnerRadius,
  MIN_HOLLOW_PX,
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
    describe('②真空帶 vacuumRadiusPx（用戶可調；省略＝沿用 baseRadiusPx）', () => {
      it('有給 vacuumRadiusPx → 採用（跟 baseRadiusPx 獨立）', () => {
        const p = resolveTowerRingParams({ baseRadiusPx: 60, vacuumRadiusPx: 200 });
        expect(p.vacuumRadiusPx).toBe(200);
        expect(p.baseRadiusPx).toBe(60);
      });
      it('省略 vacuumRadiusPx → 沿用 baseRadiusPx', () => {
        const p = resolveTowerRingParams({ baseRadiusPx: 75 });
        expect(p.vacuumRadiusPx).toBe(75);
      });
      it('vacuumRadiusPx 0 合法（0-nullish，環從塔中心起）', () => {
        const p = resolveTowerRingParams({ baseRadiusPx: 60, vacuumRadiusPx: 0 });
        expect(p.vacuumRadiusPx).toBe(0);
      });
      it('vacuumRadiusPx 負 → 退回 baseRadiusPx', () => {
        const p = resolveTowerRingParams({ baseRadiusPx: 90, vacuumRadiusPx: -10 });
        expect(p.vacuumRadiusPx).toBe(90);
      });
    });
    describe('★effectiveInnerRadius（變身-leader review 把關①：中空防退化下限）', () => {
      it('正常 vacuumRadiusPx（大於下限）→ 直接採用（用戶調值生效）', () => {
        // halfThickness 12 → 下限 12+30=42；vacuum 200 > 42 → 用 200
        expect(effectiveInnerRadius(200, 12)).toBe(200);
      });
      it('vacuumRadiusPx 太小（<= 下限）→ 撐到下限（中空不退化）', () => {
        // halfThickness 12 → 下限 42；vacuum 10 太小 → 撐到 42（內緣 42-12=30=MIN_HOLLOW_PX）
        expect(effectiveInnerRadius(10, 12)).toBe(42);
      });
      it('vacuumRadiusPx=0（用戶設 0）→ 不退化到 0，撐到下限保留中空', () => {
        expect(effectiveInnerRadius(0, 20)).toBe(20 + MIN_HOLLOW_PX);
      });
      it('內緣（effectiveBase - halfThickness）恆 >= MIN_HOLLOW_PX（中空保證）', () => {
        for (const [v, h] of [[0, 5], [5, 40], [30, 30], [1000, 50]] as const) {
          const eb = effectiveInnerRadius(v, h);
          expect(eb - h).toBeGreaterThanOrEqual(MIN_HOLLOW_PX);
        }
      });
    });
  });

  describe('ringRadiusForIndex（第 N 環固定半徑 = base + N×step）', () => {
    const p = resolveTowerRingParams({ ringCount: 4, baseRadius: 90, radiusStepPx: 120 });
    it('第 0 環最小＝baseRadius', () => expect(ringRadiusForIndex(0, p)).toBe(90));
    it('第 1 環＝base+step', () => expect(ringRadiusForIndex(1, p)).toBe(210));
    it('第 3 環＝base+3×step（由內往外遞增）', () => expect(ringRadiusForIndex(3, p)).toBe(90 + 360));
  });

  describe('★C9 tickTowerRingPhase（兩階段節奏：warning 零判定 → active 炸+判定 → 下一環 warning）', () => {
    // warningSec 0.5、ringInterval(active) 0.6、ringCount 3。
    const p = resolveTowerRingParams({ ringCount: 3, baseRadiusPx: 90, radiusStepPx: 120, ringIntervalSec: 0.6, warningSec: 0.5 });

    it('初始＝第 0 環 warning phase', () => {
      const s = createTowerRingState();
      expect(s.ringIndex).toBe(0);
      expect(s.phase).toBe('warning');
    });

    it('★warning 期間 phase 恆 warning（不變量①：呼叫端據此不判定）', () => {
      const s = createTowerRingState();
      const r = tickTowerRingPhase(s, 0.3, p); // < warningSec 0.5
      expect(r.phase).toBe('warning');
      expect(r.enterActive).toBe(false);
    });

    it('★warning 跑滿 warningSec → 進 active（enterActive 只一次、清命中去重）', () => {
      const s = createTowerRingState();
      s.hitPlayersThisRing.add(9); // 前殘留
      const r = tickTowerRingPhase(s, 0.5, p); // 達 warningSec
      expect(r.enterActive).toBe(true);
      expect(s.phase).toBe('active');
      expect(s.hitPlayersThisRing.size).toBe(0); // 進 active 清去重
      // 再 tick 一小步：不該再發 enterActive（不變量②：不雙擊）
      const r2 = tickTowerRingPhase(s, 0.05, p);
      expect(r2.enterActive).toBe(false);
      expect(r2.phase).toBe('active');
    });

    it('★active 跑滿 ringIntervalSec → 換下一環 + 回 warning（enterWarning 一次）', () => {
      const s = createTowerRingState();
      tickTowerRingPhase(s, 0.5, p); // →active（環 0）
      const r = tickTowerRingPhase(s, 0.6, p); // active 跑滿 →換環回 warning
      expect(r.enterWarning).toBe(true);
      expect(s.phase).toBe('warning');
      expect(s.ringIndex).toBe(1); // 換到下一環
    });

    it('★一環 active 結束才開下環 warning（不會 active→直接下環 active 跳過預警）', () => {
      const s = createTowerRingState();
      tickTowerRingPhase(s, 0.5, p); // 環0 →active
      tickTowerRingPhase(s, 0.6, p); // 環0 active 完 →環1 warning
      expect(s.phase).toBe('warning');
      expect(s.ringIndex).toBe(1);
      // 環1 warning 未滿 → 仍 warning（不判定）
      expect(tickTowerRingPhase(s, 0.3, p).phase).toBe('warning');
    });

    it('★環循環：0→1→2→0（ringCount=3，每環走完 warning+active）', () => {
      const s = createTowerRingState();
      const cycle = () => { tickTowerRingPhase(s, 0.5, p); tickTowerRingPhase(s, 0.6, p); }; // 一環 warning+active
      cycle(); expect(s.ringIndex).toBe(1);
      cycle(); expect(s.ringIndex).toBe(2);
      cycle(); expect(s.ringIndex).toBe(0); // 循環回內圈
    });

    it('★warningSec=0 → 無預警，換環同幀直接進 active（enterWarning+enterActive 同幀各一次）', () => {
      const p0 = resolveTowerRingParams({ ringCount: 3, ringIntervalSec: 0.6, warningSec: 0 });
      const s = createTowerRingState();
      // warningSec=0：初始 warning phaseTimer 0 >= 0 → 第一 tick 就進 active
      const r0 = tickTowerRingPhase(s, 0.016, p0);
      expect(r0.enterActive).toBe(true);
      expect(s.phase).toBe('active');
      // active 跑滿 → 換環，同幀 enterWarning+enterActive（無預警環）
      const r1 = tickTowerRingPhase(s, 0.6, p0);
      expect(r1.enterWarning).toBe(true);
      expect(r1.enterActive).toBe(true);
      expect(s.phase).toBe('active');
      expect(s.ringIndex).toBe(1);
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
    describe('★Bug4 橢圓化判定（squashY 對齊視覺貼地壓扁，上下對稱）', () => {
      const sq = 0.5;
      it('水平方向不受 squash 影響（dy=0）：環半徑 200 → x=200 命中', () => {
        expect(ringHitsPlayer(tower, 200, half, { x: 200, y: 0 }, 20, sq)).toBe(true);
      });
      it('★垂直方向：正圓會誤判、橢圓化才對——玩家在塔正下方 y=200，環半徑 200', () => {
        // 正圓(squashY=1)：d=200==ringRadius → 命中（但視覺橢圓下緣只到 200×0.5=100，看似安全＝上下不對稱 bug）
        expect(ringHitsPlayer(tower, 200, half, { x: 0, y: 200 }, 20, 1)).toBe(true);
        // 橢圓化(squashY=0.5)：dy'=200/0.5=400 → d=400 遠大於環 200 → 不命中（跟視覺一致：站遠了不該被打）
        expect(ringHitsPlayer(tower, 200, half, { x: 0, y: 200 }, 20, sq)).toBe(false);
      });
      it('★上下對稱：塔正上/正下同距離判定一致', () => {
        const up = ringHitsPlayer(tower, 200, half, { x: 0, y: -100 }, 20, sq);
        const down = ringHitsPlayer(tower, 200, half, { x: 0, y: 100 }, 20, sq);
        expect(up).toBe(down); // 對稱
      });
      it('橢圓下緣命中：玩家在正下方 y=100（視覺橢圓下緣=200×0.5=100）→ 命中', () => {
        // dy'=100/0.5=200 → d=200==ringRadius → 命中（＝視覺環下緣位置，判定跟視覺一致）
        expect(ringHitsPlayer(tower, 200, half, { x: 0, y: 100 }, 20, sq)).toBe(true);
      });
      it('squashY 省略＝正圓（向後相容）', () => {
        expect(ringHitsPlayer(tower, 200, half, { x: 0, y: 200 }, 20)).toBe(true); // 正圓
      });
    });
  });

  describe('★A2 resolveTowerPositions（前 N 用設定、不足/省略用預設環形補到 towerCount）', () => {
    it('positions 省略 → 全用預設環形，數量=towerCount', () => {
      const out = resolveTowerPositions(undefined, 4, 1920, 1080);
      expect(out.length).toBe(4);
      for (const p of out) { expect(Number.isFinite(p.x)).toBe(true); expect(Number.isFinite(p.y)).toBe(true); }
    });
    it('positions 前 2 座用設定，其餘用預設補（長度<towerCount）', () => {
      const given = [{ x: 100, y: 200 }, { x: 300, y: 400 }];
      const out = resolveTowerPositions(given, 4, 1920, 1080);
      expect(out.length).toBe(4);
      expect(out[0]).toEqual({ x: 100, y: 200 }); // 前 2 座用設定
      expect(out[1]).toEqual({ x: 300, y: 400 });
      // 後 2 座預設（有限值、非設定的兩點）
      expect(Number.isFinite(out[2].x)).toBe(true);
      expect(Number.isFinite(out[3].y)).toBe(true);
    });
    it('positions 比 towerCount 多 → 只取前 towerCount 座', () => {
      const given = [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }];
      const out = resolveTowerPositions(given, 2, 1920, 1080);
      expect(out.length).toBe(2);
      expect(out[0]).toEqual({ x: 1, y: 1 });
      expect(out[1]).toEqual({ x: 2, y: 2 });
    });
    it('defaultTowerPositions n=1 → 放場中心附近（單座）', () => {
      const out = defaultTowerPositions(1, 1920, 1080);
      expect(out.length).toBe(1);
      expect(out[0].x).toBeCloseTo(960); // 場中心 X
    });
  });
});
