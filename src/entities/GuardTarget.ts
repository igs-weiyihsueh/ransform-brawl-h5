import Phaser from 'phaser';
import type { Hittable, Vec2 } from '@/systems/hitDetection';

/**
 * GuardTarget — 守護波要保護的雕像（新 entity）。
 *
 * HP 被敵人攻擊扣（TakeDamage，currentHP=max(0,hp-dmg)）；HP=0 不銷毀（仍實體），
 * 只翻 isDefeated 失敗旗標。實作 Hittable 讓敵人攻擊判定能命中它。
 * 血條先簡單（debug 用矩形），之後開界騎做正式守護 UI。
 */
export class GuardTarget implements Hittable {
  private readonly container: Phaser.GameObjects.Container;
  private readonly barBg: Phaser.GameObjects.Rectangle;
  private readonly barFill: Phaser.GameObjects.Rectangle;
  private hp: number;
  private readonly maxHp: number;
  private readonly radiusPx = 60;
  private defeated = false;

  constructor(scene: Phaser.Scene, x: number, y: number, maxHp: number) {
    this.maxHp = maxHp;
    this.hp = maxHp;

    const body = scene.add.rectangle(0, 0, 90, 120, 0x9c8f6a);
    body.setStrokeStyle(3, 0xffffff);
    const label = scene.add
      .text(0, -80, '守護目標', {
        fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
        fontSize: '20px',
        color: '#ffe64d',
      })
      .setOrigin(0.5);
    this.barBg = scene.add.rectangle(0, 90, 100, 12, 0x333333).setOrigin(0.5);
    this.barFill = scene.add.rectangle(-50, 90, 100, 10, 0x66bb6a).setOrigin(0, 0.5);

    this.container = scene.add.container(x, y, [body, label, this.barBg, this.barFill]);
    this.container.setDepth(15);
    this.refreshBar();
  }

  getPosition(): Vec2 {
    return { x: this.container.x, y: this.container.y };
  }

  // Hittable（敵人攻擊判定命中它）
  getHitCenter(): Vec2 {
    return this.getPosition();
  }

  getHitRadius(): number {
    return this.radiusPx;
  }

  isDefeated(): boolean {
    return this.defeated;
  }

  getHp(): number {
    return this.hp;
  }

  getMaxHp(): number {
    return this.maxHp;
  }

  /** HP 比例 0..1。 */
  getHpRatio(): number {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }

  /** 被敵人攻擊：扣 HP（不低於 0）；歸 0 翻敗旗標（不銷毀）。 */
  takeDamage(dmg: number): void {
    if (this.defeated) return;
    this.hp = Math.max(0, this.hp - dmg);
    this.refreshBar();
    if (this.hp <= 0) this.defeated = true;
  }

  private refreshBar(): void {
    this.barFill.width = 100 * this.getHpRatio();
    this.barFill.fillColor = this.hp > this.maxHp * 0.3 ? 0x66bb6a : 0xef5350;
  }

  destroy(): void {
    this.container.destroy();
  }
}
