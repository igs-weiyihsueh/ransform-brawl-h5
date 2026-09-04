import Phaser from 'phaser';
import { ENEMY_RUSH_CONFIG, GLOBAL_CHARACTER_SCALE } from '@/config/combatConfig';
import { PPU } from '@/config/gameConfig';
import type { Hittable, Vec2 } from '@/systems/hitDetection';

/**
 * Enemy — 敵人實體（Enemy_Rush：骷髏衝鋒兵，近戰追擊）。
 *
 * 實作 Hittable，讓命中判定系統能查詢它的中心與碰撞半徑。
 * 追擊/停止的 AI 邏輯在 update()，由 GameScene 每幀餵入玩家位置。
 */
export class Enemy implements Hittable {
  readonly sprite: Phaser.GameObjects.Rectangle;

  private hp: number;
  private readonly maxHp: number;
  private readonly radiusPx: number;

  /** 被擊退後殘餘的位移速度（像素/秒），逐幀衰減。 */
  private knockbackVel: Vec2 = { x: 0, y: 0 };

  /** 受擊閃白殘餘秒數。 */
  private flashRemaining = 0;

  private dead = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const w = ENEMY_RUSH_CONFIG.bodySize.width * GLOBAL_CHARACTER_SCALE * PPU;
    const h = ENEMY_RUSH_CONFIG.bodySize.height * GLOBAL_CHARACTER_SCALE * PPU;
    this.sprite = scene.add.rectangle(x, y, w, h, 0xe57373);
    this.sprite.setStrokeStyle(2, 0x000000);
    this.hp = ENEMY_RUSH_CONFIG.hp;
    this.maxHp = ENEMY_RUSH_CONFIG.hp;
    // 碰撞半徑用色塊寬高取較大半邊，讓矩形攻擊框好命中。
    this.radiusPx = Math.max(w, h) / 2;
  }

  isDead(): boolean {
    return this.dead;
  }

  getHitCenter(): Vec2 {
    return { x: this.sprite.x, y: this.sprite.y };
  }

  getHitRadius(): number {
    return this.radiusPx;
  }

  /**
   * 每幀更新：朝玩家追擊，進入 attackRange 內停下；套用擊退殘速與受擊閃白。
   */
  update(playerPos: Vec2, dt: number): void {
    if (this.dead) return;

    // 擊退殘速（先套用，衰減）。
    this.sprite.x += this.knockbackVel.x * dt;
    this.sprite.y += this.knockbackVel.y * dt;
    const decay = Math.pow(0.001, dt); // 每秒衰減到 0.1%，快速歸零
    this.knockbackVel.x *= decay;
    this.knockbackVel.y *= decay;

    // 追擊：朝玩家移動，直到進入 attackRange。
    const dx = playerPos.x - this.sprite.x;
    const dy = playerPos.y - this.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const rangePx = ENEMY_RUSH_CONFIG.attackRange * PPU;

    if (dist > rangePx && dist > 0.0001) {
      const speedPx = ENEMY_RUSH_CONFIG.moveSpeed * PPU;
      this.sprite.x += (dx / dist) * speedPx * dt;
      this.sprite.y += (dy / dist) * speedPx * dt;
    }

    // 受擊閃白衰減。
    if (this.flashRemaining > 0) {
      this.flashRemaining = Math.max(0, this.flashRemaining - dt);
      if (this.flashRemaining === 0) {
        this.sprite.setFillStyle(0xe57373);
      }
    }
  }

  /**
   * 受擊：扣血、閃白、擊退。HP 歸 0 死亡消失。
   * @param damage 傷害。
   * @param knockback 擊退力道（像素/秒等效）。
   * @param fromPos 攻擊來源位置（決定擊退方向）。
   */
  takeHit(damage: number, knockback: number, fromPos: Vec2): void {
    if (this.dead) return;
    this.hp -= damage;

    // 受擊閃白。
    this.flashRemaining = 0.1;
    this.sprite.setFillStyle(0xffffff);

    // 擊退：往遠離攻擊來源方向推。knockback(unit) → 像素/秒等效速度。
    const dx = this.sprite.x - fromPos.x;
    const dy = this.sprite.y - fromPos.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const kbPx = knockback * PPU;
    this.knockbackVel.x = (dx / len) * kbPx;
    this.knockbackVel.y = (dy / len) * kbPx;

    if (this.hp <= 0) {
      this.die();
    }
  }

  private die(): void {
    this.dead = true;
    this.sprite.destroy();
  }

  /** 給 debug UI 用。 */
  getHp(): number {
    return this.hp;
  }

  getMaxHp(): number {
    return this.maxHp;
  }
}
