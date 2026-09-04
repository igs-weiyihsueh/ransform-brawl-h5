import Phaser from 'phaser';
import { getPerCharScale } from '@/config/animationConfig';
import {
  ENEMY_RUSH_CONFIG,
  SPRITE_SCALE,
} from '@/config/combatConfig';
import { PPU } from '@/config/gameConfig';
import { CharacterAnimator, FRAME_SIZE } from '@/systems/CharacterAnimator';
import type { Hittable, Vec2 } from '@/systems/hitDetection';

/** 敵人可用的角色美術 key（debug 預覽用循環選擇）。 */
export const ENEMY_CHARACTERS = ['Enemy_Rush', 'Enemy_Ranged', 'Enemy_Elite'] as const;

/**
 * Enemy — 敵人實體（Enemy_Rush，逐幀動畫）。
 *
 * 實作 Hittable 供命中判定查詢。AI：追玩家、進 attackRange 停；
 * 動畫：移動 move / 停下 idle / 受擊 damaged / 死亡 death 播完消失。
 */
export class Enemy implements Hittable {
  private readonly anim: CharacterAnimator;

  private hp: number;
  private readonly maxHp: number;
  private readonly radiusPx: number;

  private knockbackVel: Vec2 = { x: 0, y: 0 };
  private damagedRemaining = 0;
  private dying = false;
  private dead = false;

  constructor(scene: Phaser.Scene, x: number, y: number, charKey: string = ENEMY_CHARACTERS[0]) {
    this.anim = new CharacterAnimator(scene, charKey, x, y);
    this.anim.setScale(SPRITE_SCALE);
    this.hp = ENEMY_RUSH_CONFIG.hp;
    this.maxHp = ENEMY_RUSH_CONFIG.hp;
    // 碰撞半徑用視覺高度的一半估算（畫布 256 × 顯示 scale × 該角色補償 ÷ 2），
    // 讓大隻角色（如 Enemy_Elite）的判定範圍跟著視覺一起變大。
    this.radiusPx = (FRAME_SIZE * SPRITE_SCALE * getPerCharScale(charKey)) / 2;
  }

  isDead(): boolean {
    return this.dead;
  }

  getHitCenter(): Vec2 {
    return { x: this.anim.sprite.x, y: this.anim.sprite.y };
  }

  getHitRadius(): number {
    return this.radiusPx;
  }

  /** 每幀更新：擊退殘速、追擊/停止、動畫狀態。 */
  update(playerPos: Vec2, dt: number): void {
    if (this.dead || this.dying) return;

    // 擊退殘速（衰減）。
    this.anim.sprite.x += this.knockbackVel.x * dt;
    this.anim.sprite.y += this.knockbackVel.y * dt;
    const decay = Math.pow(0.001, dt);
    this.knockbackVel.x *= decay;
    this.knockbackVel.y *= decay;

    if (this.damagedRemaining > 0) {
      this.damagedRemaining = Math.max(0, this.damagedRemaining - dt);
    }

    // 追擊。
    const dx = playerPos.x - this.anim.sprite.x;
    const dy = playerPos.y - this.anim.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const rangePx = ENEMY_RUSH_CONFIG.attackRange * PPU;

    let moving = false;
    if (dist > rangePx && dist > 0.0001) {
      const speedPx = ENEMY_RUSH_CONFIG.moveSpeed * PPU;
      this.anim.sprite.x += (dx / dist) * speedPx * dt;
      this.anim.sprite.y += (dy / dist) * speedPx * dt;
      moving = true;
    }

    // 面向玩家（水平）。
    if (dx > 0) this.anim.setFacing(1);
    else if (dx < 0) this.anim.setFacing(-1);

    // 受擊硬直期間播 damaged，其餘依移動播 move/idle。
    if (this.damagedRemaining > 0) {
      this.anim.play('damaged');
    } else {
      this.anim.play(moving ? 'move' : 'idle');
    }
  }

  /** 受擊：扣血、播 damaged、擊退。HP 歸 0 播 death 後消失。 */
  takeHit(damage: number, knockback: number, fromPos: Vec2): void {
    if (this.dead || this.dying) return;
    this.hp -= damage;

    // 擊退方向：遠離攻擊來源。
    const dx = this.anim.sprite.x - fromPos.x;
    const dy = this.anim.sprite.y - fromPos.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const kbPx = knockback * PPU;
    this.knockbackVel.x = (dx / len) * kbPx;
    this.knockbackVel.y = (dy / len) * kbPx;

    if (this.hp <= 0) {
      this.die();
    } else {
      this.damagedRemaining = 0.2;
      this.anim.play('damaged', { force: true });
    }
  }

  private die(): void {
    this.dying = true;
    this.anim.play('death', {
      force: true,
      onComplete: () => {
        this.dead = true;
        this.anim.destroy();
      },
    });
  }

  getHp(): number {
    return this.hp;
  }

  getMaxHp(): number {
    return this.maxHp;
  }
}
