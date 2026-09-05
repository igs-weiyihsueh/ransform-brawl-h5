// @vitest-environment jsdom
/**
 * Enemy 擊退曲線 + microFreeze 行為（hitFeel 第1步，翼騎 b0c3e5e）。
 * 擊退重做成 Unity 快進快出（knockbackDuration 0.18s 內線性推進總距離=knockbackDistancePx×hitStun）;
 * microFreeze 被打那隻 update early-return 0.06s。維度3 斷實際位移/計時,非 call-count。
 * ⚠️ jsdom + HEADLESS 共用 scene，每測 forceDestroy。純視覺(白閃/punch/火花/死亡粒子)不測。
 * ⚠️ update 的 playerPos 放到 detectRange(Rush 30unit=3000px) 外 → chase 判定 idle 不移動，
 *    隔離出「只有擊退位移」可量;takeHit 的 fromPos(擊退方向源)與 update playerPos 是不同參數。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Phaser from 'phaser';
import { Enemy } from '@/entities/Enemy';
import { HIT_FEEL, knockbackDistancePx } from '@/config/hitFeelConfig';
import { ENEMY_AI } from '@/config/enemyConfig';
import { PPU } from '@/config/gameConfig';
import type { Vec2 } from '@/systems/hitDetection';

let game: Phaser.Game;
let scene: Phaser.Scene;
const FAR: Vec2 = { x: 1_000_000, y: 0 }; // update playerPos：遠超 detectRange → 不 chase

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

function makeEnemy(x: number, y: number, charKey = 'Enemy_Rush'): Enemy {
  return new Enemy(scene, x, y, charKey);
}
/** 跑過 microFreeze(0.06s)：連跑到 freeze 清掉為止（此時位置還沒被擊退推,因 freeze 期間早退）。 */
function clearMicroFreeze(e: Enemy): void {
  // microFreeze 0.06s；用一步 dt=0.07 跑完（>0 早退一次即歸零）。
  e.update(FAR, 0.07);
}

describe('Enemy 擊退曲線（hitFeel 快進快出）', () => {
  it('一般敵人擊退：總位移 = knockbackDistancePx(force,PPU)×hitStun，0.18s 內走完', () => {
    const e = makeEnemy(500, 500, 'Enemy_Rush');
    const hitStun = ENEMY_AI.Enemy_Rush.hitStun; // 0.8
    const force = 4; // 4×0.15=0.6<1.5 → 比例區
    // 打它：來源在左(0,500) → 往右(+x)擊退。damage 小(1)保留 hp>0(Rush hp3)→會 microFreeze。
    e.takeHit(1, force, { x: 0, y: 500 });
    clearMicroFreeze(e); // 先跑掉 0.06s 頓幀（頓幀期間不位移）
    const start = e.getHitCenter();
    // 跑滿 knockbackDuration(0.18s)：分多步推進。
    for (let i = 0; i < 6; i += 1) e.update(FAR, 0.03); // 6×0.03=0.18s
    const end = e.getHitCenter();
    const moved = Math.hypot(end.x - start.x, end.y - start.y);
    const expected = knockbackDistancePx(force, PPU) * hitStun; // 0.6×100×0.8 = 48
    expect(moved).toBeCloseTo(expected, 0); // 累計走完總距離
    // 方向：往 +x（遠離來源）。
    expect(end.x).toBeGreaterThan(start.x);
    e.forceDestroy();
  });

  it('擊退 0.18s 後停：再跑幀不再位移（快進快出、有時長上限）', () => {
    const e = makeEnemy(500, 500, 'Enemy_Rush');
    e.takeHit(1, 4, { x: 0, y: 500 });
    clearMicroFreeze(e);
    for (let i = 0; i < 8; i += 1) e.update(FAR, 0.03); // 0.24s > 0.18s 已走完
    const afterDone = e.getHitCenter();
    for (let i = 0; i < 5; i += 1) e.update(FAR, 0.03); // 再跑
    const later = e.getHitCenter();
    expect(later.x).toBeCloseTo(afterDone.x, 3); // 擊退已停、不再推進
    expect(later.y).toBeCloseTo(afterDone.y, 3);
    e.forceDestroy();
  });

  it('菁英 immovable 不被擊退（hitStun0.05 且 immovable 分支跳過擊退）→ 位移 0', () => {
    const elite = makeEnemy(500, 500, 'Enemy_Elite');
    const start = elite.getHitCenter();
    elite.takeHit(1, 100, { x: 0, y: 500 }); // 大力打
    clearMicroFreeze(elite);
    for (let i = 0; i < 8; i += 1) elite.update(FAR, 0.03);
    const end = elite.getHitCenter();
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeCloseTo(0, 3); // 菁英不退
    elite.forceDestroy();
  });
});

describe('Enemy microFreeze（局部頓幀 early-return）', () => {
  it('被打後 microFreeze 期間位置不動（freezeRemaining>0 → update 早退不位移）', () => {
    const e = makeEnemy(500, 500, 'Enemy_Rush');
    e.takeHit(1, 4, { x: 0, y: 500 }); // hp>0 → freeze 0.06s
    const start = e.getHitCenter();
    // 在頓幀時長內跑幀（dt 0.02 < 0.06）→ 早退,位置不動(擊退也沒推進)。
    e.update(FAR, 0.02);
    const mid = e.getHitCenter();
    expect(mid.x).toBeCloseTo(start.x, 5);
    expect(mid.y).toBeCloseTo(start.y, 5);
    e.forceDestroy();
  });

  it('microFreeze 計時到後恢復（頓幀過 → 擊退開始推進位移）', () => {
    const e = makeEnemy(500, 500, 'Enemy_Rush');
    e.takeHit(1, 4, { x: 0, y: 500 });
    const start = e.getHitCenter();
    clearMicroFreeze(e); // 跑過 0.06s 頓幀
    e.update(FAR, 0.03); // 頓幀已過 → 擊退推進
    const after = e.getHitCenter();
    expect(after.x).toBeGreaterThan(start.x); // 恢復後開始被擊退
    e.forceDestroy();
  });

  it('per-enemy：只凍被打那隻，另一隻同幀照跑不受影響', () => {
    const hit = makeEnemy(500, 500, 'Enemy_Rush');
    const other = makeEnemy(600, 500, 'Enemy_Rush');
    hit.takeHit(1, 4, { x: 0, y: 500 }); // 只打 hit → 只有 hit 凍
    const hitStart = hit.getHitCenter();
    const otherStart = other.getHitCenter();
    // 同一幀(dt 0.02<freeze)：hit 早退不動;other 沒被打,freezeRemaining=0 → 照跑狀態機。
    // other 的 update playerPos 放【偵測內、攻擊外】(Rush attack2unit=200px, detect30unit=3000px)
    // → chase 移動（證它沒被凍）。放 x=1100(距 500px：>200 不進 charge、<3000 會追)。
    hit.update(FAR, 0.02);
    other.update({ x: 1100, y: 500 }, 0.02); // dist 500px：chase 移動
    expect(hit.getHitCenter().x).toBeCloseTo(hitStart.x, 5); // 被打的凍住不動
    const otherMoved =
      Math.abs(other.getHitCenter().x - otherStart.x) + Math.abs(other.getHitCenter().y - otherStart.y);
    expect(otherMoved).toBeGreaterThan(0); // 沒被打的照動（per-enemy 凍結）
    hit.forceDestroy();
    other.forceDestroy();
  });
});
