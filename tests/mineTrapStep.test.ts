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
import type { MinePreset } from '@/config/mineConfig';
import type { GameContext } from '@/systems/GameContext';

const PRESET: MinePreset = {
  count: 6,
  maintainCount: 6,
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
  isWaiting(): boolean;
  getFootPosition(): { x: number; y: number };
  applyStun(sec: number): void;
}

function makePlayer(id: number, x = 99999, y = 99999): FakePlayer {
  return {
    playerId: id,
    waiting: false,
    x,
    y,
    stunned: 0,
    isWaiting() { return this.waiting; },
    getFootPosition() { return { x: this.x, y: this.y }; },
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
  const ctx = {
    players,
    getEnemies: () => enemies,
    wave: { getActiveMinePreset: getPreset },
    effects: {
      // 位置無關的 stub，回可辨識 handle。
      mineMarkerStart: () => ({}) as unknown,
      mineMarkerEnd: () => {},
      mineWarningStart: () => ({}) as unknown,
      mineWarningEnd: () => {},
      mineExplosion: () => {},
      mineAnnounce: () => { announceCount += 1; },
    },
  } as unknown as GameContext;
  const sys = new MineTrapSystem();
  sys.init(ctx);
  // 讀場上地雷數（存活）。
  const mineCount = () => (sys as unknown as { mines: unknown[] }).mines.length;
  const triggeredCount = () =>
    (sys as unknown as { mines: { triggered: boolean }[] }).mines.filter((m) => m.triggered).length;
  const mineAt = (i: number) => (sys as unknown as { mines: { x: number; y: number }[] }).mines[i];
  return { sys, players, enemies, mineCount, triggeredCount, mineAt, getAnnounce: () => announceCount };
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

  it('④ 維持數量補撒：踩爆幾顆後，場上補回到 maintainCount', () => {
    const { sys, players, mineCount, mineAt } = makeSys(() => PRESET);
    const p = makePlayer(0);
    players.push(p);
    sys.update(0.016); // 撒 count
    expect(mineCount()).toBe(PRESET.count);
    // 踩爆一顆：站上去觸發 → 等它爆。
    const target = mineAt(0);
    p.x = target.x; p.y = target.y;
    sys.update(0.016); // 觸發
    p.x = 99999; p.y = 99999; // 玩家離開避免連鎖觸發補撒的雷
    for (let i = 0; i < Math.ceil(PRESET.delaySec / 0.016) + 2; i += 1) sys.update(0.016);
    // 爆掉後補撒 → 場上維持 maintainCount。
    expect(mineCount()).toBe(PRESET.maintainCount);
  });

  it('⑤ non-null→null（離開節點）→ 清乾淨、旗標重置（再進可再撒+再宣告）', () => {
    let preset: MinePreset | null = PRESET;
    const { sys, players, mineCount, getAnnounce } = makeSys(() => preset);
    players.push(makePlayer(0));
    sys.update(0.016); // 撒 + 宣告 1
    expect(mineCount()).toBe(PRESET.count);
    expect(getAnnounce()).toBe(1);
    preset = null; // 離開節點
    sys.update(0.016);
    expect(mineCount()).toBe(0);
    // 再進地雷節點 → 再撒 + 再宣告。
    preset = PRESET;
    sys.update(0.016);
    expect(mineCount()).toBe(PRESET.count);
    expect(getAnnounce()).toBe(2);
  });
});
