import Phaser from 'phaser';
import {
  PLAYER_CONFIG,
  SPRITE_SCALE,
} from '@/config/combatConfig';
import { PPU } from '@/config/gameConfig';
import { CharacterAnimator } from '@/systems/CharacterAnimator';
import type { Vec2 } from '@/systems/hitDetection';

/** 玩家可用的角色美術 key（debug 預覽用 T 鍵循環切換）。 */
export const PLAYER_CHARACTERS = ['Human', 'SunWukong'] as const;

/**
 * Player — 玩家實體（Human 逐幀動畫）。
 *
 * 封裝移動、面向、攻擊冷卻/前搖計時，並依狀態機驅動動畫：
 * idle/move 循環、attack 播一次（配合 hitDelay/cooldown）、damaged 受擊、death 死亡。
 * 命中判定不在此（交給 hitDetection + GameScene），這裡提供位置/面向/時序。
 */
export class Player {
  private anim: CharacterAnimator;
  private charKey: string;

  /** 面向：+1 面右、-1 面左。 */
  private facing = 1;

  private cooldownRemaining = 0;
  private hitDelayRemaining = 0;
  private pendingHit = false;

  /** 是否正在播 attack（播完前不切回 idle/move）。 */
  private attacking = false;
  /** 受擊硬直剩餘秒數（播 damaged，期間不覆蓋成 move/idle）。 */
  private damagedRemaining = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, charKey: string = PLAYER_CHARACTERS[0]) {
    this.scene = scene;
    this.charKey = charKey;
    this.anim = new CharacterAnimator(scene, charKey, x, y);
    this.anim.setScale(SPRITE_SCALE);
    this.anim.setFacing(this.facing);
  }

  private readonly scene: Phaser.Scene;

  /**
   * debug：切換玩家角色皮膚（Human↔SunWukong）。保留位置與面向，重建 animator。
   */
  switchCharacter(charKey: string): void {
    if (charKey === this.charKey) return;
    const { x, y } = this.anim.sprite;
    this.charKey = charKey;
    this.anim.destroy();
    this.anim = new CharacterAnimator(this.scene, charKey, x, y);
    this.anim.setScale(SPRITE_SCALE);
    this.anim.setFacing(this.facing);
    // 重建後狀態旗標歸零，避免卡在舊 attack。
    this.attacking = false;
    this.damagedRemaining = 0;
  }

  getCharacterKey(): string {
    return this.charKey;
  }

  getPosition(): Vec2 {
    return { x: this.anim.sprite.x, y: this.anim.sprite.y };
  }

  getFacing(): number {
    return this.facing;
  }

  isOnCooldown(): boolean {
    return this.cooldownRemaining > 0;
  }

  /** 依移動向量更新位置、面向與 idle/move 動畫。 */
  move(moveVec: Vec2, dt: number): void {
    const speedPx = PLAYER_CONFIG.moveSpeed * PPU;
    this.anim.sprite.x += moveVec.x * speedPx * dt;
    this.anim.sprite.y += moveVec.y * speedPx * dt;

    if (moveVec.x > 0) this.setFacing(1);
    else if (moveVec.x < 0) this.setFacing(-1);

    // attack / damaged 期間不覆蓋動畫。
    if (this.attacking || this.damagedRemaining > 0) return;

    const moving = moveVec.x !== 0 || moveVec.y !== 0;
    this.anim.play(moving ? 'move' : 'idle');
  }

  private setFacing(dir: number): void {
    if (dir === this.facing) return;
    this.facing = dir;
    this.anim.setFacing(dir);
  }

  /**
   * 嘗試發動攻擊：非冷卻中則開始 hitDelay 前搖、進入冷卻、播 attack 一次。
   */
  tryStartAttack(hitDelay: number, cooldown: number): boolean {
    if (this.cooldownRemaining > 0) return false;
    this.cooldownRemaining = cooldown;
    this.hitDelayRemaining = hitDelay;
    this.pendingHit = true;
    this.attacking = true;
    this.anim.play('attack', {
      force: true,
      onComplete: () => {
        this.attacking = false;
      },
    });
    return true;
  }

  /** 更新計時器。回傳 true 表示本幀 hitDelay 到期、該做命中判定。 */
  updateTimers(dt: number): boolean {
    if (this.cooldownRemaining > 0) {
      this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    }
    if (this.damagedRemaining > 0) {
      this.damagedRemaining = Math.max(0, this.damagedRemaining - dt);
    }
    if (this.pendingHit) {
      this.hitDelayRemaining -= dt;
      if (this.hitDelayRemaining <= 0) {
        this.pendingHit = false;
        return true;
      }
    }
    return false;
  }
}
