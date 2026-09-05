// @vitest-environment jsdom
/**
 * Enemy.resolvePenetration 多人防穿透測試（backlog 21976cd3）。
 * separation/pushOutOfPlayer 純向量在 enemySeparation.test.ts 測；此檔測 Enemy 整合層：
 *   resolvePenetration(players[]) 對【所有 player】逐一頂開、死亡不頂。
 * ⚠️ 需 Phaser scene（Enemy 建 CharacterAnimator）→ jsdom + HEADLESS 共用 scene，每測 forceDestroy。
 * ⚠️ 菁英 immovable(像牆,用戶 #4 推翻 21976cd3)→ 測「菁英自己不動、反把玩家推到菁英外」;
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Phaser from 'phaser';
import { Enemy, ENEMY_CHARACTERS } from '@/entities/Enemy';
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

function makeEnemy(x: number, y: number, charKey = ENEMY_CHARACTERS[0]): Enemy {
  return new Enemy(scene, x, y, charKey);
}
/** player 描述：{ pos, hitRadius }。 */
function player(pos: Vec2, hitRadius = 60): { pos: Vec2; hitRadius: number } {
  return { pos, hitRadius };
}

describe('Enemy.resolvePenetration — 多人防穿透', () => {
  it('單一 player 穿透 → 敵人被頂到 minDist 邊緣', () => {
    const e = makeEnemy(10, 0);
    const r = e.getBodyRadius();
    const p = player({ x: 0, y: 0 }, 60);
    e.resolvePenetration([p]);
    const c = e.getHitCenter();
    const dist = Math.hypot(c.x - 0, c.y - 0);
    expect(dist).toBeCloseTo(60 + r); // minDist = hitRadius + bodyRadius
    e.forceDestroy();
  });

  it('🔴 多人：2 個 player 都在敵人附近 → resolvePenetration 對【所有 player】頂開（不只 P1）', () => {
    // 敵人在原點，P1 在左、P2 在右，兩者都在 minDist 內。
    const e = makeEnemy(0, 0);
    const r = e.getBodyRadius();
    const p1 = player({ x: -10, y: 0 }, 60); // 左
    const p2 = player({ x: 10, y: 0 }, 60); // 右
    e.resolvePenetration([p1, p2]);
    const c = e.getHitCenter();
    // 逐一頂開（sequential）：最後對 p2 頂 → 距 p2 >= minDist。至少驗「不再穿透 p2」。
    const distP2 = Math.hypot(c.x - p2.pos.x, c.y - p2.pos.y);
    expect(distP2).toBeCloseTo(60 + r); // 被 p2 頂到邊緣（證有處理到第 2 個 player，非只 P1）
    e.forceDestroy();
  });

  it('多人但只有一個 player 穿透 → 只被那個頂、另一個(遠)不影響', () => {
    const e = makeEnemy(0, 0);
    const r = e.getBodyRadius();
    const near = player({ x: 5, y: 0 }, 60); // 近，穿透
    const far = player({ x: 100000, y: 0 }, 60); // 極遠，不穿透
    e.resolvePenetration([near, far]);
    const c = e.getHitCenter();
    const distNear = Math.hypot(c.x - near.pos.x, c.y - near.pos.y);
    expect(distNear).toBeCloseTo(60 + r); // 被近的頂開
    expect(Number.isNaN(c.x)).toBe(false);
    e.forceDestroy();
  });

  it('未穿透（player 都在 minDist 外）→ 敵人不動', () => {
    const e = makeEnemy(500, 500);
    const before = e.getHitCenter();
    e.resolvePenetration([player({ x: 0, y: 0 }, 60)]);
    const after = e.getHitCenter();
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    e.forceDestroy();
  });

  it('菁英 immovable：自己不動（像牆）、反把玩家推到菁英外 minDist 邊緣（用戶 #4，推翻 21976cd3）', () => {
    // 菁英在原點，玩家穿進菁英體內（距 10 < minDist）。
    const elite = makeEnemy(0, 0, 'Enemy_Elite');
    const r = elite.getBodyRadius();
    const eliteBefore = elite.getHitCenter();
    let pushedTo: Vec2 | null = null;
    const p = {
      pos: { x: 10, y: 0 } as Vec2,
      hitRadius: 60,
      pushOut: (x: number, y: number) => {
        pushedTo = { x, y };
      },
    };
    elite.resolvePenetration([p]);
    // ① 菁英自己不動（immovable，像牆）。
    const eliteAfter = elite.getHitCenter();
    expect(eliteAfter.x).toBeCloseTo(eliteBefore.x);
    expect(eliteAfter.y).toBeCloseTo(eliteBefore.y);
    // ② 反把【玩家】推到菁英外 minDist 邊緣（玩家頂不動菁英、被擋在外、不穿進）。
    expect(pushedTo).not.toBeNull();
    const pushed = pushedTo as unknown as Vec2;
    const distPlayerToElite = Math.hypot(pushed.x - eliteAfter.x, pushed.y - eliteAfter.y);
    expect(distPlayerToElite).toBeCloseTo(60 + r); // 玩家被推到 minDist 邊緣
    expect(pushed.x).toBeCloseTo(60 + r); // 沿 +x 推出（原本在 +x 側）
    elite.forceDestroy();
  });

  it('菁英 immovable 但玩家未穿透（已在 minDist 外）→ 菁英不動、玩家也不被推（pushOut 不呼叫）', () => {
    const elite = makeEnemy(0, 0, 'Enemy_Elite');
    let pushed = false;
    const p = {
      pos: { x: 100000, y: 0 } as Vec2, // 極遠，不穿透
      hitRadius: 60,
      pushOut: () => {
        pushed = true;
      },
    };
    const before = elite.getHitCenter();
    elite.resolvePenetration([p]);
    const after = elite.getHitCenter();
    expect(after.x).toBeCloseTo(before.x); // 菁英不動
    expect(pushed).toBe(false); // 沒穿透 → 不推玩家
    elite.forceDestroy();
  });

  it('一般敵人(Rush)照舊被頂開（非 immovable）：與菁英分支相反', () => {
    const rush = makeEnemy(10, 0, 'Enemy_Rush');
    const r = rush.getBodyRadius();
    rush.resolvePenetration([player({ x: 0, y: 0 }, 60)]);
    const c = rush.getHitCenter();
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(60 + r); // 一般敵人自己被頂到邊緣
    rush.forceDestroy();
  });

  it('死亡敵人不頂（forceDestroy 後 resolvePenetration 為 no-op）', () => {
    const e = makeEnemy(10, 0);
    e.forceDestroy(); // 死亡
    const before = e.getHitCenter();
    e.resolvePenetration([player({ x: 0, y: 0 }, 60)]);
    const after = e.getHitCenter();
    // 死亡 → 早退不改位置。
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});
