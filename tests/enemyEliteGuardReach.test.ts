// @vitest-environment jsdom
/**
 * Enemy 菁英打雕像整合測試（用戶第十輪#2 治本）。
 * 菁英 immovable 環繞槽 minLayer=2 → 半徑 200px＝attackRange(200px) 邊界。攻擊 shape 半徑 225px 涵蓋雕像。
 * 舊 gate `dist<=attackPx && canReach` 在 dist 剛好/略過 200px 時誤殺 → 菁英卡外圈空轉不揮。
 * 治本後：菁英在槽位（200px）就能進 charge→attack，發出打雕像的 melee 攻擊事件（meleeCircle 涵蓋雕像）。
 * 對照組：小怪打雕像（近距）不回歸；菁英 shape 搆不到（極遠）不亂揮。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Phaser from 'phaser';
import { Enemy, type EnemyAttackEvent } from '@/entities/Enemy';
import type { Vec2 } from '@/systems/hitDetection';

let game: Phaser.Game;
let scene: Phaser.Scene;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    class Boot extends Phaser.Scene {
      constructor() { super({ key: 'Boot' }); }
      create(): void { scene = this; resolve(); }
    }
    game = new Phaser.Game({
      type: Phaser.HEADLESS, width: 100, height: 100, scene: [Boot],
      audio: { noAudio: true }, banner: false,
    });
  });
});
afterAll(() => game?.destroy(true));

/** 假雕像：固定中心 + hitRadius（守護目標覆蓋介面）。 */
function makeStatue(center: Vec2, hitRadius: number) {
  return {
    getPosition: () => center,
    getHitCenter: () => center,
    getHitRadius: () => hitRadius,
  };
}

/** 驅動 enemy update N 幀（固定 dt），收集攻擊事件；到出手即停。 */
function driveUntilAttack(e: Enemy, aim: Vec2 | null, frames = 400, dt = 1 / 60): EnemyAttackEvent[] {
  const events: EnemyAttackEvent[] = [];
  e.onAttack = (ev) => events.push(ev);
  for (let i = 0; i < frames && events.length === 0; i++) {
    e.update(aim, dt);
  }
  return events;
}

describe('菁英打雕像（第十輪#2 治本）', () => {
  const statueCenter: Vec2 = { x: 500, y: 500 };
  const statueR = 38; // 對齊實際雕像 dispW/2

  it('菁英在環繞槽半徑(200px)處 → 進 charge→attack，發出打雕像的 melee 事件（不卡外圈）', () => {
    // 菁英擺在雕像右方 200px（＝layer2 槽半徑＝attackRange 邊界，舊版會卡）。
    const e = new Enemy(scene, statueCenter.x + 200, statueCenter.y, 'Enemy_Elite');
    e.setGuardTarget(makeStatue(statueCenter, statueR));
    const events = driveUntilAttack(e, statueCenter);
    expect(events.length).toBeGreaterThan(0);
    const ev = events[0];
    expect(ev.kind).toBe('melee');
    expect(ev.sourceName).toBe('Enemy_Elite');
    // 攻擊圓涵蓋雕像（圓心到雕像中心 <= 圓半徑 + 雕像半徑）＝真的打得到。
    const mc = ev.meleeCircle!;
    const d = Math.hypot(mc.center.x - statueCenter.x, mc.center.y - statueCenter.y);
    expect(d).toBeLessThanOrEqual(mc.radius + statueR);
    e.forceDestroy();
  });

  it('菁英被推到略過 attackRange(210px)但 shape 仍涵蓋 → 仍能攻擊（不再被粗 gate 誤殺）', () => {
    const e = new Enemy(scene, statueCenter.x + 210, statueCenter.y, 'Enemy_Elite');
    e.setGuardTarget(makeStatue(statueCenter, statueR));
    const events = driveUntilAttack(e, statueCenter);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].kind).toBe('melee');
    e.forceDestroy();
  });

  it('對照：小怪(Rush)近距打雕像仍正常攻擊（不回歸）', () => {
    const e = new Enemy(scene, statueCenter.x + 80, statueCenter.y, 'Enemy_Rush');
    e.setGuardTarget(makeStatue(statueCenter, statueR));
    const events = driveUntilAttack(e, statueCenter);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].kind).toBe('melee');
    e.forceDestroy();
  });

  it('對照：菁英極遠(1000px)攻擊 shape 搆不到 → 不亂揮（逼近中）', () => {
    const e = new Enemy(scene, statueCenter.x + 1000, statueCenter.y, 'Enemy_Elite');
    e.setGuardTarget(makeStatue(statueCenter, statueR));
    // 只跑少量幀（不足以移動到範圍內）→ 不應出手。
    const events = driveUntilAttack(e, statueCenter, 30);
    expect(events.length).toBe(0);
    e.forceDestroy();
  });
});
