import Phaser from 'phaser';
import { Enemy, type EnemyAttackEvent } from '@/entities/Enemy';
import type { Player } from '@/entities/Player';
import { circleIntersectsCircle } from '@/systems/hitDetection';
import { Projectile } from '@/systems/Projectile';

/**
 * EnemySpawner — 生怪 API + 敵人/射彈執行時容器。
 *
 * 對外契約（波次系統等消費者用）：
 *   spawner.spawn(type, x, y) → 生成一隻該類型敵人並接管其生命週期。
 * 消費者只呼叫這個 API 決定「何時在哪生什麼怪」，完全不碰 Enemy.ts / enemyConfig 內部。
 *
 * 內部負責：敵人 onAttack 接線（近戰對玩家判定 / 生成射彈）、每幀更新敵人與射彈、
 * 清除死亡敵人/失效射彈。update(dt) 由 EnemySystem 每幀呼叫。
 */
export class EnemySpawner {
  private readonly scene: Phaser.Scene;
  private readonly player: Player;
  private readonly worldBounds: Phaser.Geom.Rectangle;

  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];

  /** 敵人近戰判定圓的最近一次（供 debug 繪製）。 */
  private lastMeleeCircle: { center: { x: number; y: number }; radius: number } | null =
    null;
  private meleeCircleFlash = 0;

  constructor(scene: Phaser.Scene, player: Player, worldBounds: Phaser.Geom.Rectangle) {
    this.scene = scene;
    this.player = player;
    this.worldBounds = worldBounds;
  }

  /** 生怪 API：生成一隻指定類型的敵人於 (x,y)，回傳該敵人。 */
  spawn(type: string, x: number, y: number): Enemy {
    const e = new Enemy(this.scene, x, y, type);
    e.onAttack = (ev) => this.handleEnemyAttack(ev);
    this.enemies.push(e);
    return e;
  }

  /** 目前存活的敵人（唯讀）。 */
  getEnemies(): readonly Enemy[] {
    return this.enemies;
  }

  /** 每幀：更新敵人 AI、射彈；處理射彈命中玩家；清除死亡/失效。 */
  update(dt: number): void {
    if (this.meleeCircleFlash > 0) this.meleeCircleFlash -= dt;

    const playerPos = this.player.getPosition();
    for (const e of this.enemies) {
      e.update(playerPos, dt);
    }

    for (const p of this.projectiles) {
      const hit = p.update(this.player, dt, this.worldBounds);
      if (hit) {
        this.player.takeHit(p.damage, p.sourceLabel);
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.isDead());
    this.enemies = this.enemies.filter((e) => !e.isDead());
  }

  /** 敵人出手：近戰→對玩家做圓判定；射彈→生成可重用 Projectile。 */
  private handleEnemyAttack(ev: EnemyAttackEvent): void {
    if (ev.kind === 'melee' && ev.meleeCircle) {
      const hit = circleIntersectsCircle(
        { center: ev.meleeCircle.center, radius: ev.meleeCircle.radius },
        this.player.getHitCenter(),
        this.player.getHitRadius(),
      );
      if (hit) {
        this.player.takeHit(ev.damage, ev.sourceName);
      }
      this.lastMeleeCircle = ev.meleeCircle;
      this.meleeCircleFlash = 0.15;
    } else if (ev.kind === 'projectile' && ev.projectile) {
      this.projectiles.push(
        new Projectile(this.scene, {
          x: ev.projectile.x,
          y: ev.projectile.y,
          dir: ev.projectile.dir,
          speedUnits: ev.projectile.speedUnits,
          radiusUnits: ev.projectile.radiusUnits,
          damage: ev.damage,
          knockback: ev.knockback,
          sourceLabel: ev.sourceName,
        }),
      );
    }
  }

  /** 給 debug 用：最近敵人近戰判定圓（閃現中才回傳）。 */
  getDebugMeleeCircle(): { center: { x: number; y: number }; radius: number } | null {
    return this.meleeCircleFlash > 0 ? this.lastMeleeCircle : null;
  }
}
