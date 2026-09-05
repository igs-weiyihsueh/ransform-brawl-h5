// @vitest-environment jsdom
/**
 * Enemy.pushOutOfObstacle 雕像防穿透測試（#8，翼騎 c07b3ed）。
 * 守護雕像 immovable：敵人被頂到雕像外緣(minDist=障礙半徑+敵人 body 半徑)、不穿進雕像體內。
 * pushOutOfPlayer 純向量在 enemySeparation.test 測；此檔測 Enemy 整合層(需 Phaser scene)。
 * ⚠️ jsdom + HEADLESS 共用 scene，每測 forceDestroy。維度3 斷敵人實際被推到的座標，非 call-count。
 * ⚠️ 雕像 hitRadius 對齊新圖(dispW/2)是 GuardTarget 建構時依載入紋理算的值(需 boot 才驗實際 38)，
 *    這裡以任意 radiusPx 驗防穿透【幾何契約】(推到 minDist 外緣),不綁特定圖尺寸。
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

describe('Enemy.pushOutOfObstacle — 雕像 immovable 防穿透', () => {
  it('敵人穿進雕像 → 被頂到雕像外緣 minDist(障礙半徑+敵人body半徑)', () => {
    const e = makeEnemy(20, 0); // 靠近原點雕像
    const r = e.getBodyRadius();
    const statueCenter: Vec2 = { x: 0, y: 0 };
    const statueR = 60;
    e.pushOutOfObstacle(statueCenter, statueR);
    const c = e.getHitCenter();
    const dist = Math.hypot(c.x - statueCenter.x, c.y - statueCenter.y);
    expect(dist).toBeCloseTo(statueR + r); // 推到外緣：障礙半徑 + 敵人 body 半徑
    e.forceDestroy();
  });

  it('雕像半徑越大 → 敵人被推越遠（外緣隨障礙半徑外擴）', () => {
    const e1 = makeEnemy(10, 0);
    const r1 = e1.getBodyRadius();
    e1.pushOutOfObstacle({ x: 0, y: 0 }, 40);
    const d1 = Math.hypot(e1.getHitCenter().x, e1.getHitCenter().y);
    e1.forceDestroy();
    const e2 = makeEnemy(10, 0);
    const r2 = e2.getBodyRadius();
    e2.pushOutOfObstacle({ x: 0, y: 0 }, 120);
    const d2 = Math.hypot(e2.getHitCenter().x, e2.getHitCenter().y);
    e2.forceDestroy();
    expect(d1).toBeCloseTo(40 + r1);
    expect(d2).toBeCloseTo(120 + r2);
    expect(d2).toBeGreaterThan(d1); // 障礙越大推越遠
  });

  it('敵人已在雕像外(未穿透) → 位置不變(不誤推)', () => {
    const e = makeEnemy(1000, 0); // 遠離原點雕像
    const before = e.getHitCenter();
    e.pushOutOfObstacle({ x: 0, y: 0 }, 60);
    const after = e.getHitCenter();
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    e.forceDestroy();
  });

  it('沿實際方向頂出(斜向)：3-4-5 → 推到外緣單位方向×minDist', () => {
    // 敵人在雕像的 (30,40) 方向、距 50；minDist = 60 + r。
    const e = makeEnemy(30, 40);
    const r = e.getBodyRadius();
    e.pushOutOfObstacle({ x: 0, y: 0 }, 60);
    const c = e.getHitCenter();
    const minDist = 60 + r;
    // 單位方向 (0.6,0.8) × minDist。
    expect(c.x).toBeCloseTo(0.6 * minDist);
    expect(c.y).toBeCloseTo(0.8 * minDist);
    e.forceDestroy();
  });

  it('死亡敵人不頂(forceDestroy 後 no-op)', () => {
    const e = makeEnemy(20, 0);
    e.forceDestroy();
    const before = e.getHitCenter();
    e.pushOutOfObstacle({ x: 0, y: 0 }, 60);
    const after = e.getHitCenter();
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('菁英敵人同樣被雕像頂出(雕像 immovable 對所有敵人一致)', () => {
    const elite = makeEnemy(20, 0, 'Enemy_Elite');
    const r = elite.getBodyRadius();
    elite.pushOutOfObstacle({ x: 0, y: 0 }, 60);
    const dist = Math.hypot(elite.getHitCenter().x, elite.getHitCenter().y);
    expect(dist).toBeCloseTo(60 + r); // 菁英碰雕像也被頂(雕像才是牆)
    elite.forceDestroy();
  });
});
