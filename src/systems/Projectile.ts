import Phaser from 'phaser';
import { PPU } from '@/config/gameConfig';
import { circleIntersectsCircle, type Hittable, type Vec2 } from '@/systems/hitDetection';
import { trackTurn, isBulletExpired, normalize, type BulletMovementType, type BulletLifetime } from '@/systems/bulletMath';

/**
 * Projectile — 可重用射彈（技能三層的 Bullet 層；怪物 AI 移植第 1 塊升級）。
 *
 * 生成時朝方向以固定速度飛行；每幀對目標（Hittable）做圓對圓判定，命中回呼 onHit。
 * ★壽命三態（距離為主 offset-無關 / 時間 / 命中數）取代舊「飛出畫面 bounds」（block-offset 座標系更省心）。
 * ★命中沿用 circleIntersectsCircle（不重寫傷害/碰撞，判定/結算回既有契約，守 a655c53d）。
 * ★MovementType：straight（直線，對齊現況）/ tracking（追蹤，Boss 彈幕用）。
 * 之後玩家技能/其他敵人遠程都共用。
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
  /** 壽命（秒），超過自動失效。★向後相容舊呼叫端；新走 lifetime。 */
  lifetime?: number;
  /** ★三層壽命（距離為主/時間/命中數）；提供則優先於舊 lifetime(秒)。 */
  life?: BulletLifetime;
  /** ★運動型別（預設 straight）。 */
  movementType?: BulletMovementType;
  /** tracking 參數（movementType='tracking' 時用）。 */
  trackingRangeUnits?: number;
  rotationSpeedDegPerSec?: number;
}

export class Projectile {
  private readonly gfx: Phaser.GameObjects.Arc;
  private dirX: number;
  private dirY: number;
  private readonly speedPx: number;
  private readonly radiusPx: number;
  readonly damage: number;
  readonly knockback: number;
  readonly sourceLabel: string;
  /** 壽命三態（新）：距離為主 offset-無關。 */
  private readonly life: BulletLifetime;
  private traveledUnits = 0;
  private elapsedSec = 0;
  private hitCount = 0;
  private readonly movementType: BulletMovementType;
  private readonly trackingRangeUnits: number;
  private readonly rotationSpeedDegPerSec: number;
  private dead = false;

  constructor(scene: Phaser.Scene, opts: ProjectileOptions) {
    const nd = normalize(opts.dir);
    this.dirX = nd.x;
    this.dirY = nd.y;
    this.speedPx = opts.speedUnits * PPU;
    this.radiusPx = opts.radiusUnits * PPU;
    this.damage = opts.damage;
    this.knockback = opts.knockback;
    this.sourceLabel = opts.sourceLabel ?? 'projectile';
    // 壽命：新 life 優先；否則相容舊 lifetime(秒)；都無→預設飛行距離 12 unit + 命中 1。
    this.life = opts.life ?? { timeSec: opts.lifetime ?? 4, maxHits: 1 };
    this.movementType = opts.movementType ?? 'straight';
    this.trackingRangeUnits = opts.trackingRangeUnits ?? 0;
    this.rotationSpeedDegPerSec = opts.rotationSpeedDegPerSec ?? 0;

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
   * 每幀更新：移動（直線/追蹤）、壽命三態、對 target 做命中判定。
   * @param target 命中目標（Hittable）。
   * @param dt 幀時間（秒）。
   * @param _bounds 保留參數（相容舊簽名；壽命改走飛行距離，不再靠畫面 bounds）。
   * @returns 命中的目標（未命中回 null）。命中或失效後 isDead()=true。
   */
  update<T extends Hittable>(target: T, dt: number, _bounds?: Phaser.Geom.Rectangle): T | null {
    if (this.dead) return null;

    // 追蹤：每幀朝目標轉向（受 trackingRange/rotationSpeed 限制）；直線則方向不變。
    if (this.movementType === 'tracking' && this.rotationSpeedDegPerSec > 0) {
      const nd = trackTurn(
        { x: this.dirX, y: this.dirY },
        this.getCenter(),
        target.getHitCenter(),
        this.rotationSpeedDegPerSec,
        this.trackingRangeUnits,
        dt,
      );
      this.dirX = nd.x;
      this.dirY = nd.y;
    }

    const stepPx = this.speedPx * dt;
    this.gfx.x += this.dirX * stepPx;
    this.gfx.y += this.dirY * stepPx;
    this.traveledUnits += stepPx / PPU;
    this.elapsedSec += dt;

    // 命中判定（沿用既有圓對圓；不重寫傷害/碰撞）。
    let hitTarget: T | null = null;
    const hit = circleIntersectsCircle(
      { center: this.getCenter(), radius: this.radiusPx },
      target.getHitCenter(),
      target.getHitRadius(),
    );
    if (hit) {
      this.hitCount += 1;
      hitTarget = target;
    }

    // 壽命三態（距離為主/時間/命中數，任一達到即過期）。
    if (isBulletExpired(this.traveledUnits, this.elapsedSec, this.hitCount, this.life)) {
      this.destroy();
    }
    return hitTarget;
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.gfx.destroy();
  }
}
