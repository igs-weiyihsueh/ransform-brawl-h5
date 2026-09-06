// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  GRAB,
  GRABBER_SPEED_PX,
  accumulateIdle,
  grabberChaseStep,
  grabberTouchesPlayer,
  shouldEscapeGrab,
  shouldTriggerGrab,
  tickGrabCountdown,
} from '@/systems/grabMath';
import { PPU } from '@/config/gameConfig';
import type { Vec2 } from '@/systems/hitDetection';

/**
 * 抓人機制純邏輯（用戶試玩#4，翼騎 79ba146）測試。含壞版必紅。
 * idle 累加規則（進場重置/命中歸0/戰鬥累加/非戰鬥凍結）+ grabber 追擊（防 tunneling）
 * + 觸碰判定 + 倒數自動掙脫。維度3 斷實際數值/位移/bool，非 call-count。
 * ⚠️ grabber 追人/被抓表演/animator 屬 GrabSystem entity 層（需 boot），不補；純規則/幾何補。
 */

describe('accumulateIdle — idle 累加規則', () => {
  it('進場重置：justEntered → 0（不管當前多少）', () => {
    expect(accumulateIdle(7, 1, true, false, true)).toBe(0);
    expect(accumulateIdle(0, 1, false, false, true)).toBe(0);
  });

  it('命中敵人歸 0：hitThisFrame → 0（有在打怪就重置）', () => {
    expect(accumulateIdle(5, 1, true, true, false)).toBe(0);
    expect(accumulateIdle(3, 0.5, false, true, false)).toBe(0);
  });

  it('戰鬥階段累加 dt（inCombat 且沒命中沒進場）', () => {
    expect(accumulateIdle(3, 1, true, false, false)).toBe(4); // 翼騎驗證例
    expect(accumulateIdle(0, 0.5, true, false, false)).toBe(0.5);
  });

  it('★ 非戰鬥凍結：保留當前值（不加不清，跨波累積）— 修「木樁/波次間隙誤觸發」', () => {
    expect(accumulateIdle(3, 1, false, false, false)).toBe(3); // 保留、不加
    expect(accumulateIdle(7.5, 5, false, false, false)).toBe(7.5); // 非戰鬥再久也不加
  });

  it('優先序：進場 > 命中 > 戰鬥累加（justEntered 壓過 hit/combat）', () => {
    expect(accumulateIdle(5, 1, true, true, true)).toBe(0); // 進場最優先
    expect(accumulateIdle(5, 1, true, true, false)).toBe(0); // 命中壓過累加
  });
});

describe('shouldTriggerGrab — 觸發門檻 (>= idleTriggerSeconds 8)', () => {
  it('達 8 → true、未達 → false、邊界=8 含', () => {
    expect(shouldTriggerGrab(8)).toBe(true);
    expect(shouldTriggerGrab(8.1)).toBe(true);
    expect(shouldTriggerGrab(7.99)).toBe(false);
    expect(shouldTriggerGrab(0)).toBe(false);
    expect(GRAB.idleTriggerSeconds).toBe(8);
  });
});

describe('grabberChaseStep — 朝玩家追擊（防 tunneling）', () => {
  it('遠距：朝玩家前進 speed×dt（沿方向、量 = speed×dt）', () => {
    // grabber(0,0)→player(1000,0)，speed=GRABBER_SPEED_PX(1000px/s)、dt=0.1 → 走 100px。
    const next = grabberChaseStep({ x: 0, y: 0 }, { x: 1000, y: 0 }, 0.1, GRABBER_SPEED_PX);
    expect(next.x).toBeCloseTo(GRABBER_SPEED_PX * 0.1); // 100
    expect(next.y).toBeCloseTo(0);
  });

  it('★ 近距不超過剩餘距離（防 tunneling）：一步會超過 → clamp 到玩家位置', () => {
    // 剩 30px，一步 speed×dt=100px > 30 → clamp 到玩家(30,0)，不衝過頭。
    const next = grabberChaseStep({ x: 0, y: 0 }, { x: 30, y: 0 }, 0.1, GRABBER_SPEED_PX);
    expect(next.x).toBeCloseTo(30);
    expect(next.y).toBeCloseTo(0);
    // 不會越過玩家（x 不 > 30）。
    expect(next.x).toBeLessThanOrEqual(30 + 1e-6);
  });

  it('斜向：沿單位方向前進（3-4-5，dist 500、走 100 → (60,80)）', () => {
    const next = grabberChaseStep({ x: 0, y: 0 }, { x: 300, y: 400 }, 0.1, GRABBER_SPEED_PX);
    expect(next.x).toBeCloseTo(60); // 0.6×100
    expect(next.y).toBeCloseTo(80); // 0.8×100
  });

  it('已在玩家位置(dist~0) → 不動、不 NaN', () => {
    const next = grabberChaseStep({ x: 500, y: 500 }, { x: 500, y: 500 }, 0.1);
    expect(next.x).toBe(500);
    expect(next.y).toBe(500);
    expect(Number.isNaN(next.x)).toBe(false);
  });

  it('grabber 速度 = grabberSpeedUnits×PPU', () => {
    expect(GRABBER_SPEED_PX).toBe(GRAB.grabberSpeedUnits * PPU);
  });
});

describe('grabberTouchesPlayer — 觸碰判定', () => {
  it('中心距 <= touchDist → true；超出 → false；邊界=touchDist 含', () => {
    const g: Vec2 = { x: 0, y: 0 };
    expect(grabberTouchesPlayer(g, { x: 50, y: 0 }, 60)).toBe(true); // 50<=60
    expect(grabberTouchesPlayer(g, { x: 60, y: 0 }, 60)).toBe(true); // 邊界
    expect(grabberTouchesPlayer(g, { x: 61, y: 0 }, 60)).toBe(false); // 超出
  });
});

describe('tickGrabCountdown — 被抓倒數→自動掙脫', () => {
  it('倒數遞減、未到 0 → autoEscape=false', () => {
    const r = tickGrabCountdown(5, 1);
    expect(r.remaining).toBeCloseTo(4);
    expect(r.autoEscape).toBe(false);
  });

  it('倒數到 0/以下 → remaining clamp 0、autoEscape=true', () => {
    const r = tickGrabCountdown(0.5, 1);
    expect(r.remaining).toBe(0); // 不負
    expect(r.autoEscape).toBe(true);
    const r2 = tickGrabCountdown(0, 0.016);
    expect(r2.autoEscape).toBe(true);
  });
});

/**
 * shouldEscapeGrab — 被抓掙脫判定（用戶九輪#1「被抓時衝刺無法掙脫」根治，翼騎 9df973c，additive）。
 * = attackEdge || dashEdge || autoEscape：三手段任一 true → 掙脫。
 *   attackEdge 本幀新起攻擊(原有)、★dashEdge 本幀新起衝刺(#1 新增)、autoEscape 倒數歸零。
 * 維度3 斷 bool 契約(8 組合窮舉)。★核心壞版：少 dashEdge(=修前 attackEdge||autoEscape)→(F,T,F)紅=衝刺掙脫失效。
 * ⚠️ GrabSystem wasDashing edge 偵測 + releaseGrabberWithKnockback + Player setGrabbed play('idle') 接線屬狀態機(翼騎 headless 驗被抓→startDash→衝出 250px 不被拉回)——不補。
 */
describe('shouldEscapeGrab — 被抓掙脫判定（任一手段即掙脫）', () => {
  it('(F,F,F) → false（無任何掙脫手段,維持被抓）', () => {
    expect(shouldEscapeGrab(false, false, false)).toBe(false);
  });
  it('(T,F,F) → true（攻擊掙脫）', () => {
    expect(shouldEscapeGrab(true, false, false)).toBe(true);
  });
  it('★ (F,T,F) → true（衝刺掙脫,#1 新增 dashEdge——核心）', () => {
    expect(shouldEscapeGrab(false, true, false)).toBe(true);
  });
  it('(F,F,T) → true（倒數歸零自動掙脫）', () => {
    expect(shouldEscapeGrab(false, false, true)).toBe(true);
  });
  it('兩兩/全 true 組合 → 全 true（任一即掙脫）', () => {
    expect(shouldEscapeGrab(true, true, false)).toBe(true);
    expect(shouldEscapeGrab(true, false, true)).toBe(true);
    expect(shouldEscapeGrab(false, true, true)).toBe(true);
    expect(shouldEscapeGrab(true, true, true)).toBe(true);
  });
});
