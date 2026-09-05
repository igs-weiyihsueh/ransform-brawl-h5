// @vitest-environment jsdom
/**
 * Player hitlag 行為（用戶試玩新#3 攻擊缺阻力感，翼騎 65e1a9c）。
 * 命中敵人→玩家 startHitlag(0.1s)，hitlag 期間 move()/updateDash() 凍結位移(砍進肉卡住);
 * 計時到 or 攻擊結束(!attacking) 恢復;同幀多命中只頓一次(去重)。維度3 斷實際位移/計時。
 * ⚠️ jsdom + HEADLESS 共用 scene，每測 destroy。純視覺(anims.pause 動畫凍)不測(需 boot 低價值)。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Phaser from 'phaser';
import { Player } from '@/entities/Player';
import type { Vec2 } from '@/systems/hitDetection';

let game: Phaser.Game;
let scene: Phaser.Scene;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    class Boot extends Phaser.Scene {
      constructor() {
        super({ key: 'Boot' });
      }
      create(): void {
        scene = this;
        resolve();
      }
    }
    game = new Phaser.Game({
      type: Phaser.HEADLESS,
      width: 100,
      height: 100,
      scene: [Boot],
      audio: { noAudio: true },
      banner: false,
    });
  });
});
afterAll(() => game?.destroy(true));

function makePlayer(x = 500, y = 500): Player {
  return new Player(scene, x, y);
}
/** 讀玩家目前中心（getHitCenter 或 sprite）。 */
function pos(p: Player): Vec2 {
  return p.getHitCenter();
}
const MOVE: Vec2 = { x: 1, y: 0 }; // 往右滿速移動向量

describe('Player hitlag — 位移凍結（砍進肉卡住）', () => {
  it('hitlag 期間 move() 位移凍結（位置不變）', () => {
    const p = makePlayer();
    p.startHitlag(0.1);
    expect(p.isInHitlag()).toBe(true);
    const before = pos(p);
    p.move(MOVE, 0.1); // hitlag 中 → early-return 不位移
    const after = pos(p);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('hitlag 期間 updateDash() 衝刺不推進（不滑）', () => {
    const p = makePlayer();
    p.startDash({ x: 1, y: 0 }); // 開始衝刺
    p.startHitlag(0.1); // 命中 → hitlag
    const before = pos(p);
    const stillDashing = p.updateDash(0.05);
    const after = pos(p);
    expect(after.x).toBeCloseTo(before.x, 5); // 衝刺凍結不推進
    expect(stillDashing).toBe(true); // 仍算 dashing（只是不滑）
  });

  it('非 hitlag 時 move() 正常位移（對照：凍結是 hitlag 造成的）', () => {
    const p = makePlayer();
    const before = pos(p);
    p.move(MOVE, 0.1); // 沒 hitlag → 正常移動
    const after = pos(p);
    expect(after.x).toBeGreaterThan(before.x); // 有動
  });
});

describe('Player hitlag — 計時恢復 / 去重', () => {
  it('攻擊結束強制恢復：hitlag 未到期但 !attacking → tickHitlag 立即結束（防卡）', () => {
    const p = makePlayer(); // 全新玩家 attacking=false
    p.startHitlag(0.1); // 開 hitlag
    expect(p.isInHitlag()).toBe(true);
    p.tickHitlag(0.01); // 只走 0.01（未到 0.1），但 !attacking → 強制結束
    expect(p.isInHitlag()).toBe(false); // 立即恢復（不卡住）
    // 恢復後 move 正常。
    const before = pos(p);
    p.move(MOVE, 0.1);
    expect(pos(p).x).toBeGreaterThan(before.x);
  });

  it('計時恢復：攻擊中 tick 累計到 0.1s 後 isInHitlag=false、恢復可移動', () => {
    const p = makePlayer();
    p.tryStartAttack(0.05, 1.0); // attacking=true（不會被 !attacking 提前強制結束）
    p.startHitlag(0.1);
    expect(p.isInHitlag()).toBe(true);
    p.tickHitlag(0.05); // 0.05 < 0.1 → 仍 hitlag
    expect(p.isInHitlag()).toBe(true);
    p.tickHitlag(0.06); // 累計 0.11 >= 0.1 → 結束
    expect(p.isInHitlag()).toBe(false);
    const before = pos(p);
    p.move(MOVE, 0.1);
    expect(pos(p).x).toBeGreaterThan(before.x); // 恢復後可動
  });

  it('同幀多命中只頓一次（去重）：hitlagRemaining>0 再 startHitlag 不疊加/不重置延長', () => {
    const p = makePlayer();
    p.tryStartAttack(0.05, 1.0); // attacking=true
    p.startHitlag(0.1); // 第一次命中
    p.startHitlag(0.1); // 同幀再命中 → 去重（若疊加變 0.2、若重置延長）
    p.startHitlag(0.1);
    // 攻擊中 tick 0.11 > 單次 0.1 → 應結束；若疊加成 0.2/0.3 則此時仍在 hitlag。
    p.tickHitlag(0.11);
    expect(p.isInHitlag()).toBe(false); // 證只頓「一次 0.1」，沒被多命中延長
  });

  it('startHitlag(0) 或負值不觸發（0=不做）', () => {
    const p = makePlayer();
    p.startHitlag(0);
    expect(p.isInHitlag()).toBe(false);
    p.startHitlag(-0.5);
    expect(p.isInHitlag()).toBe(false);
  });
});
