/**
 * towerRingSkill.ts — 魔尖塔「環狀技」純邏輯（征騎，2 新事件階段 B，★重做：一環接一環依序固定環）。
 *
 * ★正確規格（用戶驗收確認，decision dfa9a033）：**不是漣漪連續擴大的單環**，而是
 * **一環接一環、依序、固定半徑**：
 *  - 以塔為中心，第一環最小（中空處＝塔本身）→ 每 ringIntervalSec（約 0.6s，可設）→ 前環消失 →
 *    第二環更大圈（固定半徑）→ 消失 → 第三環更大…由內往外一圈一圈推。
 *  - 每環**固定半徑**（第 N 環半徑＝baseRadius + N×radiusStepPx，N 從 0 起），**同時只有一個環**（前環消失下環才出）。
 *  - 生到第 ringCount 環後 **循環回第一環**（塔存活期間持續放，週而復始）。
 *  - 每環是**中空環帶 annulus**：站環帶（|d-radius|<=halfThickness+playerRadius）才被打，中心/環外不被打。
 *  - 命中扣 energyCost（2）段能量（走 loseSecondTransformEnergy）+ per-ring 去重（一環對同玩家只扣一次）。
 *
 * 純函式/純資料、零 Phaser、零遊戲 runtime 依賴（可測）。世界座標用像素 {x,y}。
 * 特效（fx_tower_ring 單張）由 EffectSystem 接：依序單環顯示（每環出現時在該固定半徑顯示、下環出現前消失），
 * ★不是連續擴散。本檔只管「當前是第幾環/該環固定半徑多大/有沒有打到玩家/何時換下一環」時序邏輯。
 */

import type { Vec2 } from '@/systems/hitDetection';

/** 環狀技執行期參數（由波騎 TowerWave 節點 schema 補齊）。 */
export interface TowerRingRuntimeParams {
  /** 環數（一輪由內往外幾環，>=1）。 */
  ringCount: number;
  /** 第 0 環（最內圈）半徑（px）。中空處＝塔本身，故 baseRadius 通常 >= 塔半徑。 */
  baseRadiusPx: number;
  /** 每環往外遞增的半徑量（px）：第 N 環半徑＝baseRadiusPx + N×radiusStepPx。 */
  radiusStepPx: number;
  /** 每環出現間隔秒（前環消失→下環出現的節奏，約 0.6）。 */
  ringIntervalSec: number;
  /** 環圈判定厚度帶半寬（px）：環帶＝[radius-halfThickness, radius+halfThickness]。 */
  halfThicknessPx: number;
  /** 命中扣能量段數。 */
  energyCost: number;
  /** C9：每環進入 active（判定+炸）前的紅圈預警秒數（>=0；0＝無預警立即 active）。 */
  warningSec: number;
}

export const DEFAULT_TOWER_RING_PARAMS: TowerRingRuntimeParams = {
  ringCount: 4,
  baseRadiusPx: 90,
  radiusStepPx: 120,
  ringIntervalSec: 0.6,
  halfThicknessPx: 20,
  energyCost: 2,
  warningSec: 0.5,
};

/**
 * 由波騎 TowerWave 節點的環狀技 schema 補齊成執行期參數（0-nullish 合法：只擋負/非正該擋的）。
 * ★欄位名對齊波騎 RingSkillParams：ringCount/baseRadiusPx/radiusStepPx/ringIntervalSec/ringThicknessPx/energyCost。
 * ringThicknessPx＝環帶總寬 → 判定用半寬 halfThicknessPx=ringThicknessPx/2。
 */
export function resolveTowerRingParams(
  ring:
    | {
        ringCount?: number;
        baseRadiusPx?: number;
        radiusStepPx?: number;
        ringIntervalSec?: number;
        ringThicknessPx?: number;
        energyCost?: number;
        warningSec?: number;
      }
    | null
    | undefined,
): TowerRingRuntimeParams {
  const d = DEFAULT_TOWER_RING_PARAMS;
  return {
    ringCount: ring?.ringCount != null && ring.ringCount >= 1 ? Math.floor(ring.ringCount) : d.ringCount,
    baseRadiusPx: ring?.baseRadiusPx != null && ring.baseRadiusPx >= 0 ? ring.baseRadiusPx : d.baseRadiusPx,
    radiusStepPx: ring?.radiusStepPx != null && ring.radiusStepPx >= 0 ? ring.radiusStepPx : d.radiusStepPx,
    ringIntervalSec: ring?.ringIntervalSec != null && ring.ringIntervalSec > 0 ? ring.ringIntervalSec : d.ringIntervalSec,
    halfThicknessPx: ring?.ringThicknessPx != null && ring.ringThicknessPx > 0 ? ring.ringThicknessPx / 2 : d.halfThicknessPx,
    energyCost: ring?.energyCost != null && ring.energyCost >= 0 ? ring.energyCost : d.energyCost,
    warningSec: ring?.warningSec != null && ring.warningSec >= 0 ? ring.warningSec : d.warningSec,
  };
}

/** 第 N 環（N 從 0 起）的固定半徑（px）。 */
export function ringRadiusForIndex(index: number, params: TowerRingRuntimeParams): number {
  return params.baseRadiusPx + index * params.radiusStepPx;
}

/**
 * 一座塔的環狀技狀態（呼叫端每座塔持一份）。★C9 兩階段：
 *  - ringIndex：目前第幾環（0..ringCount-1）。
 *  - phase：'warning'（顯紅圈預警、★零判定）| 'active'（炸+命中判定）。
 *  - phaseTimer：目前 phase 已經過秒數。
 *  - hitPlayersThisRing：本環 active 已扣過的玩家（進 active 時清 → 每環對同玩家只扣一次）。
 */
export type TowerRingPhase = 'warning' | 'active';
export interface TowerRingState {
  ringIndex: number;
  phase: TowerRingPhase;
  phaseTimer: number;
  hitPlayersThisRing: Set<number>;
}

/** 建立一座塔的初始環狀技狀態（從第 0 環的 warning 預警開始）。 */
export function createTowerRingState(): TowerRingState {
  return { ringIndex: 0, phase: 'warning', phaseTimer: 0, hitPlayersThisRing: new Set() };
}

/**
 * ★C9 環狀節奏 phase machine（純邏輯，變身-leader 3 不變量）：每環兩階段
 *   warning（顯紅圈預警 warningSec、**零判定**）→ active（炸+命中判定，持續 ringIntervalSec）→ 換下一環的 warning。
 *
 * 回傳本幀事件（呼叫端據此播 VFX / 跑命中判定）：
 *   - enterWarning：本幀「剛進入某環的 warning」→ 呼叫端播該環紅色預警空心環（不判定）。
 *   - enterActive：本幀「剛進入某環的 active」→ 呼叫端播該環攻擊色空心環 + ★**只有此 phase 才跑命中判定**。
 *   - ringIndex：當前環（供半徑）。phase：當前 phase。
 *
 * ★不變量①：warning phase 零判定——呼叫端只在 phase==='active' 才跑 ringHitsPlayer+applyStun。
 * ★不變量②：每環單次判定、轉換無洩漏——enterActive 那幀只回一次（呼叫端命中判定該幀起跑、per-ring 去重）；
 *   warning→active / active→下環 warning 轉換各自只發一次事件（不雙擊）。
 * ★warningSec=0 → 該環無預警，直接進 active（enterWarning 與 enterActive 可同幀，但仍各只一次）。
 */
export function tickTowerRingPhase(
  state: TowerRingState,
  dt: number,
  params: TowerRingRuntimeParams,
): { enterWarning: boolean; enterActive: boolean; ringIndex: number; phase: TowerRingPhase } {
  const warnSec = Math.max(0, params.warningSec);
  const activeSec = Math.max(0.001, params.ringIntervalSec);
  let enterWarning = false;
  let enterActive = false;

  state.phaseTimer += dt;

  // warning phase：跑滿 warningSec → 進 active（清本環命中去重、發 enterActive）。
  if (state.phase === 'warning') {
    if (state.phaseTimer >= warnSec) {
      state.phase = 'active';
      state.phaseTimer -= warnSec; // 溢出時間帶入 active（不吞幀）
      state.hitPlayersThisRing.clear();
      enterActive = true;
    }
    return { enterWarning, enterActive, ringIndex: state.ringIndex, phase: state.phase };
  }

  // active phase：跑滿 ringIntervalSec → 換下一環（循環）、回到 warning（發 enterWarning）。
  if (state.phaseTimer >= activeSec) {
    state.phaseTimer -= activeSec;
    state.ringIndex = (state.ringIndex + 1) % Math.max(1, params.ringCount);
    state.phase = 'warning';
    enterWarning = true;
    // warningSec=0：本幀立刻再進 active（無預警環），仍各只發一次事件。
    if (warnSec <= 0 && state.phaseTimer >= 0) {
      state.phase = 'active';
      state.hitPlayersThisRing.clear();
      enterActive = true;
    }
  }
  return { enterWarning, enterActive, ringIndex: state.ringIndex, phase: state.phase };
}

/**
 * ★環圈命中判定（annulus，中心空）：玩家圓是否碰到「當前環那一圈厚度帶」（固定半徑）。
 * 玩家中心到塔心距離 d、玩家半徑 r：碰到環帶 ⇔ |d - ringRadius| <= halfThickness + r。
 * d < ringRadius-half-r（環內側空心）→ 不命中；d > ringRadius+half+r（環外）→ 不命中。
 */
export function ringHitsPlayer(
  towerCenter: Vec2,
  ringRadius: number,
  halfThicknessPx: number,
  playerCenter: Vec2,
  playerRadius: number,
): boolean {
  const dx = playerCenter.x - towerCenter.x;
  const dy = playerCenter.y - towerCenter.y;
  const d = Math.hypot(dx, dy);
  return Math.abs(d - ringRadius) <= halfThicknessPx + playerRadius;
}

/**
 * A2 預設塔位（環形/散佈）：當 preset.positions 省略或不足 towerCount 時，game-side 補足到 towerCount 座。
 * 以場中心為圓心排成一圈（n==1 直接放中心）；半徑取場寬/高較小邊的 ~0.28，避免貼邊。
 * 純函式（給測騎測）。座標＝場景座標（1920×1080 基準，與 GAME_WIDTH/HEIGHT 同基準）。
 */
export function defaultTowerPositions(n: number, sceneW: number, sceneH: number): Vec2[] {
  const count = Math.max(1, Math.floor(n));
  const cx = sceneW / 2;
  const cy = sceneH * 0.46; // 略高於正中（給下方玩家/UI 空間）
  if (count === 1) return [{ x: cx, y: cy }];
  const ringR = Math.min(sceneW, sceneH) * 0.28;
  const out: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const ang = -Math.PI / 2 + (i / count) * Math.PI * 2; // 從正上方順時針均分
    out.push({ x: cx + Math.cos(ang) * ringR, y: cy + Math.sin(ang) * ringR });
  }
  return out;
}

/**
 * A2 解析塔位：前 N 座用 preset.positions（若有、依序），其餘（含 positions 省略/不足）用 defaultTowerPositions 補到 towerCount。
 * ★長度可 != towerCount：前 min(positions.length, count) 用設定、其餘用預設環形補足。純函式。
 */
export function resolveTowerPositions(
  positions: readonly Vec2[] | undefined,
  towerCount: number,
  sceneW: number,
  sceneH: number,
): Vec2[] {
  const count = Math.max(1, Math.floor(towerCount));
  const defaults = defaultTowerPositions(count, sceneW, sceneH);
  const given = positions ?? [];
  const out: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const p = given[i];
    out.push(p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : defaults[i]);
  }
  return out;
}
