import Phaser from 'phaser';
import { GLOBAL_CHARACTER_SCALE, PLAYER_CONFIG } from '@/config/combatConfig';
import { PPU } from '@/config/gameConfig';
import type { Vec2 } from '@/systems/hitDetection';

/**
 * Player — 玩家實體（佔位色塊）。
 *
 * 封裝玩家的視覺、移動、面向、攻擊冷卻/前搖計時。
 * 命中判定本身不在這裡（交給 hitDetection + GameScene 主迴圈），
 * 這裡只提供位置、面向、攻擊時序狀態。
 */
export class Player {
  readonly sprite: Phaser.GameObjects.Rectangle;

  /** 面向：+1 面右、-1 面左。 */
  private facing = 1;

  /** 攻擊冷卻剩餘秒數。 */
  private cooldownRemaining = 0;

  /** 攻擊前搖：>0 表示正在等 hitDelay，倒數到 0 觸發命中判定。 */
  private hitDelayRemaining = 0;
  private pendingHit = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const w = PLAYER_CONFIG.bodySize.width * GLOBAL_CHARACTER_SCALE * PPU;
    const h = PLAYER_CONFIG.bodySize.height * GLOBAL_CHARACTER_SCALE * PPU;
    this.sprite = scene.add.rectangle(x, y, w, h, 0x4fc3f7);
    this.sprite.setStrokeStyle(2, 0xffffff);
  }

  getPosition(): Vec2 {
    return { x: this.sprite.x, y: this.sprite.y };
  }

  getFacing(): number {
    return this.facing;
  }

  isOnCooldown(): boolean {
    return this.cooldownRemaining > 0;
  }

  /**
   * 依移動向量更新位置與面向。
   * @param move 已正規化的移動向量。
   * @param dt 幀時間（秒）。
   */
  move(move: Vec2, dt: number): void {
    const speedPx = PLAYER_CONFIG.moveSpeed * PPU;
    this.sprite.x += move.x * speedPx * dt;
    this.sprite.y += move.y * speedPx * dt;

    // 面向依水平移動翻轉；純垂直移動時維持原面向。
    if (move.x > 0) this.setFacing(1);
    else if (move.x < 0) this.setFacing(-1);
  }

  private setFacing(dir: number): void {
    if (dir === this.facing) return;
    this.facing = dir;
    // 用一個小三角形般的視覺提示：這裡簡單用縮放翻轉表示面向。
    this.sprite.scaleX = dir >= 0 ? 1 : -1;
  }

  /**
   * 嘗試發動攻擊。若不在冷卻中，開始 hitDelay 前搖並進入冷卻。
   * @returns 是否成功發動（用來播特效等）。
   */
  tryStartAttack(hitDelay: number, cooldown: number): boolean {
    if (this.cooldownRemaining > 0) return false;
    this.cooldownRemaining = cooldown;
    this.hitDelayRemaining = hitDelay;
    this.pendingHit = true;
    return true;
  }

  /**
   * 更新計時器。回傳 true 表示「本幀 hitDelay 到期，該做命中判定」。
   */
  updateTimers(dt: number): boolean {
    if (this.cooldownRemaining > 0) {
      this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
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
