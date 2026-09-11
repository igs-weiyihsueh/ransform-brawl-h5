import Phaser from 'phaser';
import { Projectile } from '@/systems/Projectile';
import { spreadDirections } from '@/systems/bulletMath';
import type { BulletShooterDef } from '@/config/enemySkillSchema';
import type { Vec2 } from '@/systems/hitDetection';

/** 子彈視覺參數（貼圖/染色/scale）；由呼叫端（EnemySpawner 讀 EffectSystem）注入，schema 不含 Phaser。 */
export interface BulletVisual {
  textureKey?: string;
  tint?: number;
  visualScale?: number;
}

/**
 * BulletShooter — 技能三層「中層」：一次發射依 def 生 N 顆 Bullet（Projectile），可扇形展開 + 間隔齊發。
 * 怪物 AI 移植第 1 塊（鬥破規格第 7 節）。
 *
 * ★三契約：
 *  1) offset-aware：origin（發射點）由呼叫端傳世界座標（敵人已在 offset 座標系），本層不碰常數。
 *  2) 命中不在此：只生 Projectile（命中沿用 Projectile 內既有 circleIntersectsCircle）。
 *  3) 生命週期/所有權：生出的 Projectile 交呼叫端（EnemySpawner）registry 管 update+清場；本 shooter 只負責「產出子彈」。
 *
 * 用法：
 *  - intervalSec=0（一般怪單招）：fire() 立即回全部子彈。
 *  - intervalSec>0（Boss 連射）：fire() 回第一批、其餘排隊，呼叫端每幀 tick(dt) 收後續批。
 */
export class BulletShooter {
  private readonly scene: Phaser.Scene;
  private readonly def: BulletShooterDef;
  /** 排隊待發（intervalSec>0 時）：每項＝一顆子彈的方向 + 距發射還剩秒數。 */
  private pending: { dir: Vec2; delaySec: number; origin: Vec2 }[] = [];

  constructor(scene: Phaser.Scene, def: BulletShooterDef) {
    this.scene = scene;
    this.def = def;
  }

  /**
   * 發射：依 bulletsPerShot + spreadDeg 算方向，第 0 顆立即生、其餘按 intervalSec 排隊（interval=0 全立即）。
   * @param origin 發射點（世界 px；敵人 body 中心）。
   * @param aimDir 瞄準方向（朝目標；不需正規化）。
   * @param sourceLabel debug 來源名。
   * @returns 立即生成的 Projectile（interval=0 時＝全部）。
   */
  fire(origin: Vec2, aimDir: Vec2, sourceLabel: string, visual?: BulletVisual): Projectile[] {
    const dirs = spreadDirections(aimDir, this.def.bulletsPerShot, this.def.spreadDeg);
    const immediate: Projectile[] = [];
    dirs.forEach((dir, i) => {
      const delay = this.def.intervalSec * i;
      if (delay <= 0) {
        immediate.push(this.makeBullet(origin, dir, sourceLabel, visual));
      } else {
        this.pending.push({ dir, delaySec: delay, origin });
      }
    });
    this.pendingLabel = sourceLabel;
    this.pendingVisual = visual;
    return immediate;
  }

  private pendingLabel = 'projectile';
  private pendingVisual: BulletVisual | undefined;

  /**
   * 每幀推進排隊子彈（intervalSec>0）；回本幀到期該生的 Projectile（呼叫端 push 進 registry）。
   * interval=0 時 pending 恆空、回 []。
   */
  tick(dt: number): Projectile[] {
    if (this.pending.length === 0) return [];
    const due: Projectile[] = [];
    for (const p of this.pending) p.delaySec -= dt;
    const ready = this.pending.filter((p) => p.delaySec <= 0);
    for (const p of ready) due.push(this.makeBullet(p.origin, p.dir, this.pendingLabel, this.pendingVisual));
    this.pending = this.pending.filter((p) => p.delaySec > 0);
    return due;
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }

  private makeBullet(origin: Vec2, dir: Vec2, sourceLabel: string, visual?: BulletVisual): Projectile {
    const b = this.def.bullet;
    return new Projectile(this.scene, {
      x: origin.x,
      y: origin.y,
      dir,
      speedUnits: b.speedUnits,
      radiusUnits: b.radiusUnits,
      damage: b.damage,
      knockback: b.knockback,
      sourceLabel,
      life: b.lifetime,
      movementType: b.movementType,
      trackingRangeUnits: b.trackingRangeUnits,
      rotationSpeedDegPerSec: b.rotationSpeedDegPerSec,
      textureKey: visual?.textureKey,
      tint: visual?.tint,
      visualScale: visual?.visualScale,
    });
  }
}
