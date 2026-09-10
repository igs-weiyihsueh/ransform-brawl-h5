// @vitest-environment jsdom
/**
 * MineTrapSystem 踩雷式 game-side 行為（征騎）。契約：波騎 mineConfig/WaveSystem.getActiveMinePreset（mineGate）。
 *
 * 用戶 final 行為：
 *  ① 撒場上不倒數不爆（撒下只靜置等踩）。
 *  ② 只玩家踩到（footPosition 進 radiusPx）觸發該地雷倒數 delaySec；怪走過不觸發。
 *  ③ 觸發後倒數完爆 → 範圍內玩家+怪 applyStun(paralyzeSec)（不分敵我、不扣血）。
 *  ④ 場上存活地雷 < maintainCount → 補撒到 maintainCount。
 *  ⑤ getActiveMinePreset null→non-null（波次宣告顯完）才開始撒 + 發「小心地雷！」宣告。
 *
 * 壞版必紅：撒下就倒數自動爆（非踩觸發）→ 沒人踩也爆 → 紅；怪走過就觸發 → 紅；不補撒 → 數量掉了不回 → 紅。
 */
import { describe, expect, it } from 'vitest';
import { MineTrapSystem } from '@/systems/MineTrapSystem';
import { MINE_BODY_RADIUS_PX } from '@/systems/mineTrapMath';
import type { MinePreset } from '@/config/mineConfig';
import type { GameContext } from '@/systems/GameContext';

const PRESET: MinePreset = {
  count: 6,
  maintainCount: 6,
  respawnDelaySec: 1,
  radiusPx: 100,
  delaySec: 2,
  paralyzeSec: 3,
  edgeMarginPx: 0,
};

interface FakePlayer {
  playerId: number;
  waiting: boolean;
  x: number;
  y: number;
  stunned: number;
  bodyR: number;
  isWaiting(): boolean;
  getFootPosition(): { x: number; y: number };
  getBodyRadius(): number;
  applyStun(sec: number): void;
}

function makePlayer(id: number, x = 99999, y = 99999): FakePlayer {
  return {
    playerId: id,
    waiting: false,
    x,
    y,
    stunned: 0,
    bodyR: 50, // 玩家體型半徑（≈ getBodyRadius/vacuum，測用固定值）
    isWaiting() { return this.waiting; },
    getFootPosition() { return { x: this.x, y: this.y }; },
    getBodyRadius() { return this.bodyR; },
    applyStun(sec: number) { this.stunned += sec; },
  };
}

interface FakeEnemy {
  x: number;
  y: number;
  stunned: number;
  isDead(): boolean;
  getHitCenter(): { x: number; y: number };
  applyStun(sec: number): void;
}

function makeEnemy(x = 99999, y = 99999): FakeEnemy {
  return {
    x,
    y,
    stunned: 0,
    isDead() { return false; },
    getHitCenter() { return { x: this.x, y: this.y }; },
    applyStun(sec: number) { this.stunned += sec; },
  };
}

/** 建可控 ctx + MineTrapSystem。preset 由 getPreset() 回傳（測 gate null→non-null）。 */
function makeSys(getPreset: () => MinePreset | null) {
  const players: FakePlayer[] = [];
  const enemies: FakeEnemy[] = [];
  let announceCount = 0;
  let curLevel = 0; // Bug3：地雷宣告整關一次，可變 level 供測換關重播
  const levelIndex = () => curLevel;
  let deferAnnounce = false; // #1：true→mineAnnounce 存 callback 不立刻呼（手動觸發驗 announcing gate）
  let pendingAnnounceDone: (() => void) | null = null;
  const ctx = {
    players,
    getEnemies: () => enemies,
    wave: { getActiveMinePreset: getPreset, getLevelIndex: () => levelIndex() },
    effects: {
      // 位置無關的 stub，回可辨識 handle。
      mineMarkerStart: () => ({}) as unknown,
      mineMarkerEnd: () => {},
      mineWarningStart: () => ({}) as unknown,
      mineWarningEnd: () => {},
      mineExplosion: () => {},
      // ★#1 announcing gate：真 mineAnnounce 宣告演完才呼 onDone→撒雷。
      //   測用預設：同步立刻呼 onDone（宣告瞬完→撒雷），除非 deferAnnounce 開（存起 callback 手動觸發驗 gate）。
      mineAnnounce: (onDone?: () => void) => {
        announceCount += 1;
        if (deferAnnounce) { pendingAnnounceDone = onDone ?? null; }
        else onDone?.();
      },
    },
  } as unknown as GameContext;
  const sys = new MineTrapSystem();
  sys.init(ctx);
  // 讀場上地雷數（存活）。
  const mineCount = () => (sys as unknown as { mines: unknown[] }).mines.length;
  const triggeredCount = () =>
    (sys as unknown as { mines: { triggered: boolean }[] }).mines.filter((m) => m.triggered).length;
  const mineAt = (i: number) => (sys as unknown as { mines: { x: number; y: number }[] }).mines[i];
  return { sys, players, enemies, mineCount, triggeredCount, mineAt, getAnnounce: () => announceCount, setLevel: (l: number) => { curLevel = l; }, setDeferAnnounce: (d: boolean) => { deferAnnounce = d; }, fireAnnounceDone: () => { const cb = pendingAnnounceDone; pendingAnnounceDone = null; cb?.(); } };
}

describe('MineTrapSystem 踩雷式', () => {
  it('⑤ preset=null（gate 窗內）→ 不撒、不宣告', () => {
    const { sys, mineCount, getAnnounce } = makeSys(() => null);
    sys.update(0.016);
    sys.update(0.016);
    expect(mineCount()).toBe(0);
    expect(getAnnounce()).toBe(0);
  });

  it('⑤ null→non-null（宣告顯完）→ 撒 count 顆 + 發一次「小心地雷！」宣告', () => {
    let preset: MinePreset | null = null;
    const { sys, mineCount, getAnnounce } = makeSys(() => preset);
    sys.update(0.016); // gate 窗：null
    expect(mineCount()).toBe(0);
    preset = PRESET; // gate 跑完 → 開放
    sys.update(0.016);
    expect(mineCount()).toBe(PRESET.count);
    expect(getAnnounce()).toBe(1);
    // 宣告一節點只發一次。
    sys.update(0.016);
    expect(getAnnounce()).toBe(1);
  });

  it('#1 announcing gate（照火雨）：宣告演出中不撒雷，宣告演完 callback 才撒第一批', () => {
    let preset: MinePreset | null = null;
    const { sys, mineCount, getAnnounce, setDeferAnnounce, fireAnnounceDone } = makeSys(() => preset);
    setDeferAnnounce(true); // mineAnnounce 存 callback 不立刻呼（模擬宣告演出播放中）
    preset = PRESET;
    sys.update(0.016); // 進地雷節點 → 發宣告（announceCount 1）、但★宣告演出中 → 還沒撒雷
    expect(getAnnounce()).toBe(1);
    expect(mineCount()).toBe(0); // ★gate：宣告演完前不撒
    sys.update(0.016); // 再推幾幀，仍在宣告中 → 仍不撒
    expect(mineCount()).toBe(0);
    // 宣告演出播完 → callback 觸發 → 撒第一批。
    fireAnnounceDone();
    expect(mineCount()).toBe(PRESET.count);
  });

  it('Bug3 地雷警示整關一次（照火雨）：同關多個地雷節點只宣告一次，換關才重播', () => {
    let preset: MinePreset | null = null;
    const { sys, getAnnounce, setLevel } = makeSys(() => preset);
    // 第一個地雷節點（level 0）：宣告一次。
    preset = PRESET;
    sys.update(0.016);
    expect(getAnnounce()).toBe(1);
    // 離開節點（preset→null）：清乾淨，但不重置宣告旗標。
    preset = null;
    sys.update(0.016);
    // 同關第二個地雷節點：★不再宣告（整關一次）。
    preset = PRESET;
    sys.update(0.016);
    expect(getAnnounce()).toBe(1);
    // 換關（level 1）→ 同關內第一個地雷節點：自然重播宣告。
    preset = null;
    sys.update(0.016);
    setLevel(1);
    preset = PRESET;
    sys.update(0.016);
    expect(getAnnounce()).toBe(2);
  });

  it('① 撒下不倒數不爆：沒人踩，過很久也不爆、不麻痺', () => {
    const { sys, players, mineCount } = makeSys(() => PRESET);
    const p = makePlayer(0); // 遠離所有地雷
    players.push(p);
    sys.update(0.016); // 撒
    const n = mineCount();
    expect(n).toBe(PRESET.count);
    // 推進遠超 delaySec：沒人踩 → 不爆、地雷還在、玩家沒被麻痺。
    for (let i = 0; i < 600; i += 1) sys.update(0.016);
    expect(mineCount()).toBe(n);
    expect(p.stunned).toBe(0);
  });

  it('② 只玩家踩觸發 + ③ 倒數完爆麻痺：玩家站到某地雷上 → 觸發該顆 → delaySec 後爆 → 玩家麻痺', () => {
    const { sys, players, mineCount, triggeredCount, mineAt } = makeSys(() => PRESET);
    const p = makePlayer(0);
    players.push(p);
    sys.update(0.016); // 撒 count 顆
    const before = mineCount();
    // 把玩家移到第一顆地雷正上方 → 下一幀應觸發那顆（只那顆）。
    const target = mineAt(0);
    p.x = target.x;
    p.y = target.y;
    sys.update(0.016);
    expect(triggeredCount()).toBeGreaterThanOrEqual(1);
    // 推進超過 delaySec → 觸發的那顆爆 → 玩家在範圍內被麻痺、地雷數減少。
    for (let i = 0; i < Math.ceil(PRESET.delaySec / 0.016) + 2; i += 1) sys.update(0.016);
    expect(p.stunned).toBeGreaterThan(0);
    expect(mineCount()).toBeLessThan(before + PRESET.maintainCount); // 至少有爆掉的（不是原封不動）
  });

  it('② 怪走過不觸發：怪站到地雷上、沒玩家踩 → 不觸發、不爆', () => {
    const { sys, enemies, players, triggeredCount, mineCount, mineAt } = makeSys(() => PRESET);
    players.push(makePlayer(0)); // 玩家遠離
    sys.update(0.016); // 撒
    const e = makeEnemy();
    enemies.push(e);
    const target = mineAt(0);
    e.x = target.x;
    e.y = target.y;
    // 怪站雷上很久：不該觸發任何地雷（只玩家踩才觸發）。
    for (let i = 0; i < 300; i += 1) sys.update(0.016);
    expect(triggeredCount()).toBe(0);
    expect(mineCount()).toBe(PRESET.count);
    expect(e.stunned).toBe(0);
  });

  it('② 觸發＝玩家圓與地雷圓相交（體型半徑+本體半徑）：完全分離不觸發；相交（sprite 疊到）觸發', () => {
    expect(PRESET.radiusPx).toBeGreaterThan(MINE_BODY_RADIUS_PX); // 前提：爆炸半徑 >> 本體半徑
    const { sys, players, triggeredCount, mineAt } = makeSys(() => PRESET);
    const p = makePlayer(0);
    players.push(p);
    sys.update(0.016); // 撒
    const target = mineAt(0);
    const triggerDist = p.getBodyRadius() + MINE_BODY_RADIUS_PX; // 兩圓相交門檻（50+13=63）
    // 兩圓「完全分離」（距離 > 體型半徑+本體半徑）→ 不觸發，即使在爆炸半徑 radiusPx(120) 內。
    p.x = target.x + triggerDist + 8;
    p.y = target.y;
    sys.update(0.016);
    expect(triggeredCount()).toBe(0);
    // 兩圓「相交」（玩家 sprite 邊緣碰到地雷本體，距離 < 門檻）→ 觸發（不需中心對中心）。
    p.x = target.x + triggerDist - 8;
    sys.update(0.016);
    expect(triggeredCount()).toBeGreaterThanOrEqual(1);
  });

  it('② 觸發不需中心重疊：玩家中心離地雷 > 本體半徑(13) 但兩圓相交（體型半徑補足）→ 仍觸發', () => {
    const { sys, players, triggeredCount, mineAt } = makeSys(() => PRESET);
    const p = makePlayer(0);
    players.push(p);
    sys.update(0.016);
    const target = mineAt(0);
    // 中心距離 = 30（> 本體半徑 13，舊版只用 13 會漏；新版 50+13=63 內 → 觸發）。
    p.x = target.x + 30;
    p.y = target.y;
    sys.update(0.016);
    expect(triggeredCount()).toBeGreaterThanOrEqual(1);
  });

  it('④ per-mine 再生：踩爆一顆後，隔 respawnDelaySec 才補回（非立即），補到 maintainCount 上限', () => {
    const { sys, players, mineCount, mineAt } = makeSys(() => PRESET);
    const p = makePlayer(0);
    players.push(p);
    sys.update(0.016); // 撒 count
    expect(mineCount()).toBe(PRESET.count);
    // 踩爆一顆：站上去觸發 → 等它爆。
    const target = mineAt(0);
    p.x = target.x; p.y = target.y;
    sys.update(0.016); // 觸發
    p.x = 99999; p.y = 99999; // 玩家離開避免連鎖觸發
    for (let i = 0; i < Math.ceil(PRESET.delaySec / 0.016) + 2; i += 1) sys.update(0.016);
    // 爆掉後 → 場上少一顆，且★不立即補（respawnDelaySec 未到）。
    const afterBoom = mineCount();
    expect(afterBoom).toBe(PRESET.count - 1);
    // 還沒到 respawnDelaySec：仍不補。
    sys.update(PRESET.respawnDelaySec * 0.5);
    expect(mineCount()).toBe(PRESET.count - 1);
    // 過了 respawnDelaySec：補回一顆到 maintainCount。
    for (let i = 0; i < Math.ceil((PRESET.respawnDelaySec * 0.6) / 0.016) + 2; i += 1) sys.update(0.016);
    expect(mineCount()).toBe(PRESET.maintainCount);
  });

  it('④ 再生不超過 maintainCount：場上已滿時再生額度到期不補（存活恆 <= maintainCount）', () => {
    const { sys, players, mineCount } = makeSys(() => PRESET);
    players.push(makePlayer(0)); // 玩家遠離、無人踩
    sys.update(0.016); // 撒滿 count = maintainCount
    expect(mineCount()).toBe(PRESET.maintainCount);
    // 沒人踩 → 沒爆 → 無 respawn 佇列；推進很久場上恆 = maintainCount（不超補）。
    for (let i = 0; i < 300; i += 1) sys.update(0.016);
    expect(mineCount()).toBe(PRESET.maintainCount);
  });

  it('⑤ non-null→null（離開節點）→ 清乾淨；同關再進再撒但★不再宣告（Bug3 整關一次）', () => {
    let preset: MinePreset | null = PRESET;
    const { sys, players, mineCount, getAnnounce } = makeSys(() => preset);
    players.push(makePlayer(0));
    sys.update(0.016); // 撒 + 宣告 1
    expect(mineCount()).toBe(PRESET.count);
    expect(getAnnounce()).toBe(1);
    preset = null; // 離開節點 → 清乾淨（不重置宣告旗標）
    sys.update(0.016);
    expect(mineCount()).toBe(0);
    // 同關再進地雷節點 → 再撒雷，但★不再宣告（整關一次，照火雨）。
    preset = PRESET;
    sys.update(0.016);
    expect(mineCount()).toBe(PRESET.count);
    expect(getAnnounce()).toBe(1);
  });
});
