// @vitest-environment jsdom
/**
 * Enemy.resolvePenetration 多人防穿透測試（backlog 21976cd3）。
 * separation/pushOutOfPlayer 純向量在 enemySeparation.test.ts 測；此檔測 Enemy 整合層：
 *   resolvePenetration(players[]) 對【所有 player】逐一頂開、死亡不頂。
 * ⚠️ 需 Phaser scene（Enemy 建 CharacterAnimator）→ jsdom + HEADLESS 共用 scene，每測 forceDestroy。
 * ⚠️ 菁英【沒】豁免（H5 刻意手感一致）→ 測「所有敵人含菁英都被頂」，不測菁英豁免（現況沒做）。
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

  it('菁英敵人也被頂（H5 無菁英豁免，體感一致）', () => {
    const elite = makeEnemy(10, 0, 'Enemy_Elite');
    const r = elite.getBodyRadius();
    elite.resolvePenetration([player({ x: 0, y: 0 }, 60)]);
    const c = elite.getHitCenter();
    expect(Math.hypot(c.x, c.y)).toBeCloseTo(60 + r); // 菁英同樣被頂到邊緣
    elite.forceDestroy();
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
