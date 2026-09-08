import Phaser from 'phaser';
import { PPU } from '@/config/gameConfig';
import type { Vec2 } from '@/systems/hitDetection';

/** 撿取半徑（unit）。距離判定，非物理碰撞。 */
export const ITEM_PICKUP_RADIUS = 0.8;

/** 七輪#9 乙：初始道具進場後撿取免疫秒（給玩家看箭頭走過去的時間，箭頭 3s showDuration 內不被秒撿）。 */
export const INITIAL_ITEM_PICKUP_IMMUNITY_SEC = 1.5;

/** 道具來源（與 itemGuideMath.ItemSource 對齊）。'heroDrop'=階段2 怪掉英雄變身道具（帶 heroKey）。 */
export type ItemSourceKind = 'initial' | 'kill' | 'random' | 'heroDrop';

/**
 * TransformItem — 變身道具（場上可撿取的實體）。
 *
 * 用簡單視覺佔位（金色星形圈），距離判定撿取（每幀由 TransformSystem 檢查玩家距離）。
 * 精緻 VFX（法陣/彈道落下）之後補；核心是「場上有道具→走過去撿」。
 */
export class TransformItem {
  private readonly scene: Phaser.Scene;
  private readonly container: Phaser.GameObjects.Container;
  private readonly pickupRadiusPx: number;
  private picked = false;
  /** 用戶 #7：專屬道具 owner（playerId）；undefined=無主（自由撿）。 */
  private owner: number | undefined = undefined;
  /** owner 玩家色邊框（明顯，標記道具屬於誰）。 */
  private ownerBorder: Phaser.GameObjects.Graphics | null = null;
  /** 唯一 id（排隊制/佇列追蹤用）。 */
  readonly id: number;
  /** 七輪#9 乙：道具來源（'initial' 引導去撿 → 箭頭跳過距離 gate + 進場短暫免撿取）。 */
  readonly source: ItemSourceKind;
  /** 階段2：英雄變身道具帶的英雄 key（source='heroDrop' 時有值；撿了換成此英雄）。非英雄道具=undefined。 */
  readonly heroKey: string | undefined;
  /** 七輪#9 乙：撿取免疫剩餘秒（初始道具進場後短暫不可撿，給玩家看箭頭走過去的時間）；每幀由 TransformSystem 扣。 */
  private pickupImmunitySec = 0;

  /** 十六輪②：spawn 彈跳物理（對齊 Unity TransformItem，PPU=100）。bouncing 期間不可撿、落地歸零停(無二段彈)。 */
  private bouncing = false;
  private vx = 0;
  private vy = 0;
  private groundY = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, id = 0, source: ItemSourceKind = 'random', heroKey?: string) {
    this.scene = scene;
    this.id = id;
    this.source = source;
    this.heroKey = heroKey;
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

  /** 用戶 #7：設為某玩家的專屬道具，加 owner 玩家色邊框（不透明明顯，標記屬於誰）。 */
  setOwner(playerId: number, color: number): void {
    this.owner = playerId;
    if (!this.ownerBorder) {
      this.ownerBorder = this.scene.add.graphics();
      this.container.add(this.ownerBorder);
    }
    this.ownerBorder.clear();
    this.ownerBorder.lineStyle(4, color, 1); // owner 玩家色、不透明
    this.ownerBorder.strokeRect(-28, -28, 56, 56); // 方框邊框標記
  }

  getOwner(): number | undefined {
    return this.owner;
  }

  getPosition(): Vec2 {
    return { x: this.container.x, y: this.container.y };
  }

  isPicked(): boolean {
    return this.picked;
  }

  /** 玩家是否在撿取半徑內（撿取免疫中一律 false，七輪#9 乙：初始道具進場短暫不可撿）。 */
  isInPickupRange(playerPos: Vec2): boolean {
    if (this.pickupImmunitySec > 0) return false;
    if (this.bouncing) return false; // 十六輪②：彈跳落地前不可撿（對齊 Unity landed 後才可撿）
    const dx = playerPos.x - this.container.x;
    const dy = playerPos.y - this.container.y;
    return dx * dx + dy * dy <= this.pickupRadiusPx * this.pickupRadiusPx;
  }

  /** 設定撿取免疫秒數（七輪#9 乙：初始道具進場後短暫不可撿）。 */
  setPickupImmunity(sec: number): void {
    this.pickupImmunitySec = Math.max(0, sec);
  }

  /** 每幀扣減撿取免疫（由 TransformSystem update 呼叫）。 */
  tickImmunity(dt: number): void {
    if (this.pickupImmunitySec > 0) this.pickupImmunitySec = Math.max(0, this.pickupImmunitySec - dt);
  }

  /**
   * 十六輪②：spawn 彈跳（對齊 Unity TransformItem，PPU=100）。從當前 y 為地面，水平往 dirX 側飛、垂直上拋，
   * 每幀重力落下，落地(vy>0 且 y>=groundY)歸零停(無二段彈)。彈跳中不可撿。
   * @param dirX 水平方向 ±1（配合落點左右：往右 +1 / 往左 -1）。
   */
  launch(dirX: number): void {
    this.groundY = this.container.y;
    this.vx = (dirX >= 0 ? 1 : -1) * 400; // itemLaunchSpeedX 4 units ×PPU
    this.vy = -300; // itemLaunchSpeedY 3 units ×PPU（往上，H5 上為負）
    this.bouncing = true;
  }

  /** 十六輪②：每幀推進彈跳物理（TransformSystem update 呼叫）；落地一次即停(無二段彈)。 */
  tickBounce(dt: number): void {
    if (!this.bouncing) return;
    this.vy += 800 * dt; // gravity 8 units/s² ×PPU
    this.container.x += this.vx * dt;
    this.container.y += this.vy * dt;
    if (this.vy > 0 && this.container.y >= this.groundY) {
      this.container.y = this.groundY; // 落地歸零停
      this.vx = 0;
      this.vy = 0;
      this.bouncing = false;
    }
  }

  /** 十六輪②：是否彈跳中（TransformSystem 判定期間不可撿）。 */
  isBouncing(): boolean {
    return this.bouncing;
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
