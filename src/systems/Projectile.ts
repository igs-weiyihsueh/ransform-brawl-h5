import Phaser from 'phaser';
import { PPU } from '@/config/gameConfig';
import { circleIntersectsCircle, type Hittable, type Vec2 } from '@/systems/hitDetection';

/**
 * Projectile — 可重用射彈。
 *
 * 生成時朝目標方向以固定速度直線飛行；每幀對指定目標（Hittable）做圓對圓判定，
 * 命中則回呼 onHit 並失效；飛出畫面或超過壽命也失效。
 * 之後其他遠程攻擊（玩家技能、其他敵人）都可共用。
 */
export interface ProjectileOptions {
  /** 起始世界像素座標。 */
  x: number;
  y: number;
  /** 飛行方向（會被正規化）。 */
  dir: Vec2;
  /** 速度（unit/s，內部 ×PPU）。 */
  speedUnits: number;
  /** 射彈碰撞半徑（unit，內部 ×PPU）。 */
  radiusUnits: number;
  /** 傷害與擊退（傳給命中回呼）。 */
  damage: number;
  knockback: number;
  /** 來源名稱（debug 顯示玩家被誰打）。 */
  sourceLabel?: string;
  /** 壽命（秒），超過自動失效。 */
  lifetime?: number;
}

export class Projectile {
  private readonly gfx: Phaser.GameObjects.Arc;
  private readonly vx: number;
  private readonly vy: number;
  private readonly radiusPx: number;
  readonly damage: number;
  readonly knockback: number;
  readonly sourceLabel: string;
  private life: number;
  private dead = false;

  constructor(scene: Phaser.Scene, opts: ProjectileOptions) {
    const len = Math.hypot(opts.dir.x, opts.dir.y) || 1;
    const speedPx = opts.speedUnits * PPU;
    this.vx = (opts.dir.x / len) * speedPx;
    this.vy = (opts.dir.y / len) * speedPx;
    this.radiusPx = opts.radiusUnits * PPU;
    this.damage = opts.damage;
    this.knockback = opts.knockback;
    this.sourceLabel = opts.sourceLabel ?? 'projectile';
    this.life = opts.lifetime ?? 4;

    this.gfx = scene.add.circle(opts.x, opts.y, Math.max(6, this.radiusPx), 0xffd54f);
    this.gfx.setStrokeStyle(2, 0xff6f00);
  }

  isDead(): boolean {
    return this.dead;
  }

  getCenter(): Vec2 {
    return { x: this.gfx.x, y: this.gfx.y };
  }

  /**
   * 每幀更新：移動、壽命、對 target 做命中判定。
   * @returns 命中的目標（未命中回 null）。命中或失效後 isDead()=true。
   */
  update<T extends Hittable>(target: T, dt: number, bounds: Phaser.Geom.Rectangle): T | null {
    if (this.dead) return null;

    this.gfx.x += this.vx * dt;
    this.gfx.y += this.vy * dt;

    this.life -= dt;
    if (
      this.life <= 0 ||
      !Phaser.Geom.Rectangle.Contains(bounds, this.gfx.x, this.gfx.y)
    ) {
      this.destroy();
      return null;
    }

    const hit = circleIntersectsCircle(
      { center: this.getCenter(), radius: this.radiusPx },
      target.getHitCenter(),
      target.getHitRadius(),
    );
    if (hit) {
      this.destroy();
      return target;
    }
    return null;
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.gfx.destroy();
  }
}
