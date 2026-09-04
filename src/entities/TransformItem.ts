import Phaser from 'phaser';
import { PPU } from '@/config/gameConfig';
import type { Vec2 } from '@/systems/hitDetection';

/** 撿取半徑（unit）。距離判定，非物理碰撞。 */
export const ITEM_PICKUP_RADIUS = 0.8;

/**
 * TransformItem — 變身道具（場上可撿取的實體）。
 *
 * 用簡單視覺佔位（金色星形圈），距離判定撿取（每幀由 TransformSystem 檢查玩家距離）。
 * 精緻 VFX（法陣/彈道落下）之後補；核心是「場上有道具→走過去撿」。
 */
export class TransformItem {
  private readonly container: Phaser.GameObjects.Container;
  private readonly pickupRadiusPx: number;
  private picked = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const ring = scene.add.circle(0, 0, 22, 0xffe64d, 0.25);
    ring.setStrokeStyle(3, 0xffe64d);
    const core = scene.add.star(0, 0, 5, 8, 18, 0xffe64d);
    this.container = scene.add.container(x, y, [ring, core]);
    this.container.setDepth(20);
    this.pickupRadiusPx = ITEM_PICKUP_RADIUS * PPU;

    // 輕微脈動，讓道具顯眼（純視覺）。
    scene.tweens.add({
      targets: this.container,
      scale: { from: 0.9, to: 1.15 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  getPosition(): Vec2 {
    return { x: this.container.x, y: this.container.y };
  }

  isPicked(): boolean {
    return this.picked;
  }

  /** 玩家是否在撿取半徑內。 */
  isInPickupRange(playerPos: Vec2): boolean {
    const dx = playerPos.x - this.container.x;
    const dy = playerPos.y - this.container.y;
    return dx * dx + dy * dy <= this.pickupRadiusPx * this.pickupRadiusPx;
  }

  /** 標記已撿並銷毀視覺。 */
  pickUp(): void {
    if (this.picked) return;
    this.picked = true;
    this.container.destroy();
  }

  destroy(): void {
    if (!this.picked) this.container.destroy();
    this.picked = true;
  }
}
