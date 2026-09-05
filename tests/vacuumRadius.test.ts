// @vitest-environment jsdom
/**
 * 真空帶對齊搜索圈整合鎖（用戶試玩新#1，翼騎 e2ab771）。
 * 推怪真空半徑 = 視覺搜索圈 FOOT_GLOW.radiusPx(50)，與受擊半徑 getHitRadius(40) 分開:
 * 眼見的搜索圈 = 實際推怪真空帶。菁英與一般敵人同基準(getVacuumRadius)。
 * 維度3 斷實際半徑值 / 敵人被推到的近邊位置，非 call-count。
 * pushOutOfPlayer 純函式邏輯/簽章沒動(既有 enemySeparation 測試照過)，這裡加整合期望。
 * ⚠️ jsdom + HEADLESS：Player getVacuumRadius/getHitRadius 是 entity 方法。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Phaser from 'phaser';
import { Player } from '@/entities/Player';
import { pushOutOfPlayer } from '@/systems/enemySeparation';
import { FOOT_GLOW } from '@/config/playerConfig';
import { PLAYER_HIT_RADIUS } from '@/config/combatConfig';
import { PPU } from '@/config/gameConfig';
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

describe('真空帶對齊搜索圈（getVacuumRadius）— 受擊/真空分開', () => {
  it('getVacuumRadius() = FOOT_GLOW.radiusPx(50)、getHitRadius() 仍 = PLAYER_HIT_RADIUS×PPU(40)、兩者不同', () => {
    const p = new Player(scene, 0, 0);
    expect(p.getVacuumRadius()).toBe(FOOT_GLOW.radiusPx);
    expect(p.getVacuumRadius()).toBe(50);
    expect(p.getHitRadius()).toBe(PLAYER_HIT_RADIUS * PPU);
    expect(p.getHitRadius()).toBe(40);
    // 分開：真空(50) ≠ 受擊(40)。
    expect(p.getVacuumRadius()).not.toBe(p.getHitRadius());
  });
});

describe('真空帶對齊搜索圈 — 敵人被推到近邊 = 視覺圈半徑(50)', () => {
  it('用 getVacuumRadius 推怪：敵人近邊(中心距玩家 - body) = 50 = FOOT_GLOW.radiusPx（眼見即實際）', () => {
    const p = new Player(scene, 0, 0);
    const vac = p.getVacuumRadius(); // 50
    const enemyBody = 30; // 任意敵人 body 半徑
    const minDist = vac + enemyBody; // 真空基準：真空半徑 + 敵人 body
    // 敵人穿進玩家(距 20 < minDist)，用實際 pushOutOfPlayer 推。
    const enemyPos: Vec2 = { x: 20, y: 0 };
    const player: Vec2 = { x: 0, y: 0 };
    const fixed = pushOutOfPlayer(enemyPos, player, minDist);
    const centerDist = Math.hypot(fixed.x - player.x, fixed.y - player.y);
    expect(centerDist).toBeCloseTo(minDist); // 中心距 = 真空半徑 + body
    // 近邊（敵人身體最靠玩家那側）= 中心距 - body = 真空半徑 = 50 = 視覺搜索圈。
    expect(centerDist - enemyBody).toBeCloseTo(vac);
    expect(centerDist - enemyBody).toBeCloseTo(FOOT_GLOW.radiusPx); // 眼見(50)=實際近邊
    expect(centerDist - enemyBody).toBeCloseTo(50);
  });

  it('對照：若用受擊半徑(40)推，近邊只到 40 ≠ 視覺圈 50（證真空該用 50 才對齊）', () => {
    const p = new Player(scene, 0, 0);
    const enemyBody = 30;
    const player: Vec2 = { x: 0, y: 0 };
    // 用受擊半徑(40)當基準 → 近邊 40（跟視覺圈 50 不合，用戶抱怨的情況）。
    const fixedHit = pushOutOfPlayer({ x: 20, y: 0 }, player, p.getHitRadius() + enemyBody);
    const nearHit = Math.hypot(fixedHit.x, fixedHit.y) - enemyBody;
    expect(nearHit).toBeCloseTo(40);
    expect(nearHit).not.toBeCloseTo(FOOT_GLOW.radiusPx); // 40 ≠ 50 → 這正是修前不一致
  });
});

describe('真空帶對齊搜索圈 — 菁英與一般敵人同基準', () => {
  it('菁英與一般敵人推怪用同一 getVacuumRadius(50)，不是兩套值', () => {
    const p = new Player(scene, 0, 0);
    const vac = p.getVacuumRadius();
    // 兩種敵人 body 不同,但真空基準相同 → 近邊都 = vac(50)。
    const player: Vec2 = { x: 0, y: 0 };
    const normalBody = 30;
    const eliteBody = 45;
    const normalFixed = pushOutOfPlayer({ x: 10, y: 0 }, player, vac + normalBody);
    const eliteFixed = pushOutOfPlayer({ x: 10, y: 0 }, player, vac + eliteBody);
    const normalNear = Math.hypot(normalFixed.x, normalFixed.y) - normalBody;
    const eliteNear = Math.hypot(eliteFixed.x, eliteFixed.y) - eliteBody;
    expect(normalNear).toBeCloseTo(vac); // 一般敵人近邊 = 50
    expect(eliteNear).toBeCloseTo(vac); // 菁英近邊 = 50（同基準）
    expect(normalNear).toBeCloseTo(eliteNear); // 同一真空基準
  });
});
