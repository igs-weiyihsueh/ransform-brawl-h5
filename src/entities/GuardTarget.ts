import Phaser from 'phaser';
import { UI_ICONS } from '@/config/uiConfig';
import type { Hittable, Vec2 } from '@/systems/hitDetection';

/** 守護波雕像貼圖 key。 */
const STATUE_KEY = UI_ICONS.statue.key;

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

    // 雕像本體：優先用 Unity 原圖 statue.png（148×292 直式），等比縮到視覺高度 ~150px（不變形）；
    // 未載到則退回原方塊佔位（不壞）。origin 中心對齊 container，配合上方 label/下方血條位置。
    let body: Phaser.GameObjects.GameObject;
    if (scene.textures.exists(STATUE_KEY)) {
      const img = scene.add.image(0, 0, STATUE_KEY).setOrigin(0.5, 0.5);
      const src = scene.textures.get(STATUE_KEY).getSourceImage() as {
        width: number;
        height: number;
      };
      const targetH = 150;
      const ratio = src.width && src.height ? src.width / src.height : 0.5;
      img.setDisplaySize(targetH * ratio, targetH); // 等比：高 150、寬按 148:292 比例(~76)
      body = img;
    } else {
      const rect = scene.add.rectangle(0, 0, 90, 120, 0x9c8f6a);
      rect.setStrokeStyle(3, 0xffffff);
      body = rect;
    }
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
