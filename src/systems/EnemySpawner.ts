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

  /** 擊殺回呼（由 GameScene 設定，例如給寶盒能量）。帶被擊殺敵人的角色 key。 */
  onEnemyKilled: ((enemyKey: string) => void) | null = null;

  /** 生怪 API：生成一隻指定類型的敵人於 (x,y)，回傳該敵人。 */
  spawn(type: string, x: number, y: number): Enemy {
    const e = new Enemy(this.scene, x, y, type);
    e.onAttack = (ev) => this.handleEnemyAttack(ev);
    e.onKilled = (key) => this.onEnemyKilled?.(key);
    if (this.guardTarget) e.setGuardTarget(this.guardTarget); // 守護波中新生怪也打雕像
    this.enemies.push(e);
    return e;
  }

  /** 清除全部場上敵人（守護波結束 ClearAllActiveEnemies 用）。 */
  clearAllEnemies(): void {
    for (const e of this.enemies) e.forceDestroy();
    this.enemies = [];
    this.projectiles = [];
  }

  /** 目前存活的敵人（唯讀）。 */
  getEnemies(): readonly Enemy[] {
    return this.enemies;
  }

  /** 每幀：更新敵人 AI、射彈；處理射彈命中目標（玩家或守護雕像）；清除死亡/失效。 */
  update(dt: number): void {
    if (this.meleeCircleFlash > 0) this.meleeCircleFlash -= dt;

    const playerPos = this.player.getPosition();
    for (const e of this.enemies) {
      e.update(playerPos, dt);
    }

    // 守護波：射彈打雕像；否則打玩家。
    const target = this.guardTarget ?? this.player;
    for (const p of this.projectiles) {
      const hit = p.update(target, dt, this.worldBounds);
      if (hit) {
        this.applyAttackDamage(p.damage, p.sourceLabel);
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.isDead());
    this.enemies = this.enemies.filter((e) => !e.isDead());
  }

  /** 守護波目標介面：可判定命中(Hittable) + 提供位置(AI aim) + 受傷。 */
  private guardTarget:
    | (import('@/systems/hitDetection').Hittable & {
        getPosition(): import('@/systems/hitDetection').Vec2;
        takeDamage(dmg: number): void;
      })
    | null = null;

  /** 設定/清除守護目標（守護波開始設雕像、結束清）。同時把場上敵人的 AI 目標覆蓋一起切。 */
  setGuardTarget(
    target:
      | (import('@/systems/hitDetection').Hittable & {
          getPosition(): import('@/systems/hitDetection').Vec2;
          takeDamage(dmg: number): void;
        })
      | null,
  ): void {
    this.guardTarget = target;
    for (const e of this.enemies) e.setGuardTarget(target);
  }

  /** 對當前攻擊目標套傷害：守護波→雕像 takeDamage；否則→玩家 takeHit。 */
  private applyAttackDamage(dmg: number, sourceName: string): void {
    if (this.guardTarget) {
      this.guardTarget.takeDamage(dmg);
    } else {
      this.player.takeHit(dmg, sourceName);
    }
  }

  /** 敵人出手：近戰→對當前目標(玩家/雕像)做圓判定；射彈→生成可重用 Projectile。 */
  private handleEnemyAttack(ev: EnemyAttackEvent): void {
    if (ev.kind === 'melee' && ev.meleeCircle) {
      const target = this.guardTarget ?? this.player;
      const hit = circleIntersectsCircle(
        { center: ev.meleeCircle.center, radius: ev.meleeCircle.radius },
        target.getHitCenter(),
        target.getHitRadius(),
      );
      if (hit) {
        this.applyAttackDamage(ev.damage, ev.sourceName);
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
