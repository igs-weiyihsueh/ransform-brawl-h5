import Phaser from 'phaser';
import {
  PLAYER_CONFIG,
  PLAYER_HIT_RADIUS,
  PLAYER_IFRAME_DURATION,
  SPRITE_SCALE,
} from '@/config/combatConfig';
import { PPU } from '@/config/gameConfig';
import { CharacterAnimator } from '@/systems/CharacterAnimator';
import type { Hittable, Vec2 } from '@/systems/hitDetection';

/** 玩家可用的角色美術 key（debug 預覽用 T 鍵循環切換）。 */
export const PLAYER_CHARACTERS = ['Human', 'SunWukong'] as const;

/**
 * Player — 玩家實體（Human 逐幀動畫）。
 *
 * 封裝移動、面向、攻擊冷卻/前搖計時，並依狀態機驅動動畫：
 * idle/move 循環、attack 播一次（配合 hitDelay/cooldown）、damaged 受擊、death 死亡。
 * 實作 Hittable，讓敵人攻擊/射彈能以幾何判定命中玩家。
 * 命中「自己的攻擊」判定不在此（交給 hitDetection + GameScene）。
 */
export class Player implements Hittable {
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

  /** 無敵幀剩餘秒數（>0 表示免疫且閃爍）。 */
  private iFrameRemaining = 0;
  /** debug：最近被誰打到。 */
  private lastHitBy = '';

  private readonly hitRadiusPx: number;

  constructor(scene: Phaser.Scene, x: number, y: number, charKey: string = PLAYER_CHARACTERS[0]) {
    this.scene = scene;
    this.charKey = charKey;
    this.anim = new CharacterAnimator(scene, charKey, x, y);
    this.anim.setScale(SPRITE_SCALE);
    this.anim.setFacing(this.facing);
    this.hitRadiusPx = PLAYER_HIT_RADIUS * PPU;
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

  // --- Hittable（供敵人攻擊/射彈判定玩家） ---
  getHitCenter(): Vec2 {
    return { x: this.anim.sprite.x, y: this.anim.sprite.y };
  }

  getHitRadius(): number {
    return this.hitRadiusPx;
  }

  /** 目前是否處於無敵幀（iFrame 內免疫再次受擊）。 */
  isInvincible(): boolean {
    return this.iFrameRemaining > 0;
  }

  getLastHitBy(): string {
    return this.lastHitBy;
  }

  /**
   * 玩家被敵人攻擊命中。
   * 這階段：只做受擊反饋（damaged 動畫 + 0.5s iFrame 閃爍），不扣血、不死亡。
   * iFrame 內呼叫會被忽略。damage 先收下備用（魂力系統之後才實際處理）。
   * @returns 是否實際受擊（false = 被 iFrame 擋掉）。
   */
  takeHit(_damage: number, sourceName: string): boolean {
    if (this.iFrameRemaining > 0) return false;
    this.lastHitBy = sourceName;
    this.iFrameRemaining = PLAYER_IFRAME_DURATION;
    this.damagedRemaining = 0.25;
    this.anim.play('damaged', { force: true });
    return true;
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
    // iFrame 倒數 + 閃爍（每 ~60ms 切換半透明）。
    if (this.iFrameRemaining > 0) {
      this.iFrameRemaining = Math.max(0, this.iFrameRemaining - dt);
      const blink = Math.floor(this.iFrameRemaining / 0.06) % 2 === 0;
      this.anim.sprite.setAlpha(blink ? 0.4 : 1);
      if (this.iFrameRemaining === 0) {
        this.anim.sprite.setAlpha(1);
      }
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
