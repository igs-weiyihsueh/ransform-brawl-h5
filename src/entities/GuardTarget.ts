import Phaser from 'phaser';
import { UI_ICONS } from '@/config/uiConfig';
import { GUARD_STATUE_UI_DEFAULTS, type GuardStatueUi } from '@/config/guardConfig';
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
  private readonly scene: Phaser.Scene;
  /** 第十四輪：聚焦呼吸燈脈動 tween（對齊 Unity StartFocusPulse）；stopFocusPulse 停並還原。 */
  private focusPulseTween: Phaser.Tweens.Tween | null = null;
  private hp: number;
  private readonly maxHp: number;
  /** 碰撞/命中半徑（像素）：換雕像圖後對齊新圖尺寸（非舊方塊 90×120）。constructor 依實際 body 設定。 */
  private radiusPx = 60;
  private defeated = false;
  /** 血條寬（像素）：#4 可由 guard preset 開放調整；refreshBar 依此縮放 barFill。 */
  private readonly barWidthPx: number;

  /**
   * @param ui 雕像/血條 UI（第十輪#1#4，resolveGuardStatueUi 解析值）；省略＝打包預設（行為不變 + #1 血條放大）。
   */
  constructor(scene: Phaser.Scene, x: number, y: number, maxHp: number, ui?: GuardStatueUi) {
    this.scene = scene;
    this.maxHp = maxHp;
    this.hp = maxHp;

    // 第十輪#1#4：雕像大小/血條 UI 讀 config（省略→打包預設；0-nullish 已在 resolveGuardStatueUi 處理）。
    const cfg: GuardStatueUi = ui ?? { ...GUARD_STATUE_UI_DEFAULTS };
    this.barWidthPx = cfg.barWidthPx;

    // 雕像本體：優先用 Unity 原圖 statue.png（148×292 直式），等比縮到視覺高度 statueHeightPx（不變形）；
    // 未載到則退回原方塊佔位（不壞）。origin 中心對齊 container，配合上方 label/下方血條位置。
    let body: Phaser.GameObjects.GameObject;
    if (scene.textures.exists(STATUE_KEY)) {
      const img = scene.add.image(0, 0, STATUE_KEY).setOrigin(0.5, 0.5);
      const src = scene.textures.get(STATUE_KEY).getSourceImage() as {
        width: number;
        height: number;
      };
      const targetH = cfg.statueHeightPx; // 第十輪#4：雕像高可由 preset 調整（原 hardcode 150）
      const ratio = src.width && src.height ? src.width / src.height : 0.5;
      const dispW = targetH * ratio;
      img.setDisplaySize(dispW, targetH); // 等比：高 targetH、寬按 148:292 比例
      body = img;
      // 命中/碰撞半徑對齊新雕像圖尺寸（非舊方塊）：取顯示寬的一半當身體圓半徑
      // （直式雕像的立足/身體足跡；命中判定與防穿透共用此圓）。雕像調大→hitRadius 大→菁英/怪更好打（與 #2 協調）。
      this.radiusPx = dispW / 2;
    } else {
      const rect = scene.add.rectangle(0, 0, 90, 120, 0x9c8f6a);
      rect.setStrokeStyle(3, 0xffffff);
      body = rect;
      this.radiusPx = 60; // 方塊 fallback 用舊半徑
    }
    const label = scene.add
      .text(0, cfg.labelOffsetYPx, '守護目標', {
        fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
        fontSize: '20px',
        color: '#ffe64d',
      })
      .setOrigin(0.5);
    // #1 血條放大 + #4 位置/尺寸可調（bg 比 fill 略高 2px 當外框，維持原視覺比例）。
    this.barBg = scene.add
      .rectangle(0, cfg.barOffsetYPx, cfg.barWidthPx, cfg.barHeightPx, 0x333333)
      .setOrigin(0.5);
    this.barFill = scene.add
      .rectangle(-cfg.barWidthPx / 2, cfg.barOffsetYPx, cfg.barWidthPx, Math.max(1, cfg.barHeightPx - 2), 0x66bb6a)
      .setOrigin(0, 0.5);

    this.container = scene.add.container(x, y, [body, label, this.barBg, this.barFill]);
    this.container.setDepth(15);
    this.refreshBar();
  }

  getPosition(): Vec2 {
    return { x: this.container.x, y: this.container.y };
  }

  /** 設定 container depth（用戶 #4 聚焦：暫時提到壓暗遮罩之上＝雕像不被壓暗；結束還原）。 */
  setDepth(d: number): void {
    this.container.setDepth(d);
  }

  /** 顯示/隱藏（用戶 #4：開場玩家就定位後才顯雕像；reveal 時淡入放大）。 */
  setVisible(v: boolean): void {
    this.container.setVisible(v);
  }

  /**
   * 第十四輪：聚焦呼吸燈脈動（對齊 Unity StartFocusPulse）——雕像+血條（整個 container）alpha 呼吸 1↔0.55，
   * yoyo repeat（tween 走 scene 時間線，不受聚焦定格 dt=0 影響，照播）。beginFocus 呼叫。
   */
  startFocusPulse(): void {
    if (this.focusPulseTween) return; // 已在脈動
    this.container.setAlpha(1);
    this.focusPulseTween = this.scene.tweens.add({
      targets: this.container,
      alpha: 0.55,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** 第十四輪：停聚焦呼吸燈 + 還原 alpha=1（endFocus/結束呼叫，務必還原不殘留半透明）。 */
  stopFocusPulse(): void {
    if (this.focusPulseTween) {
      this.focusPulseTween.stop();
      this.focusPulseTween = null;
    }
    this.container.setAlpha(1);
  }

  /** 顯現動畫（用戶 #4：玩家就定位 → 雕像淡入 + 從小放大到定位）。 */
  reveal(scene: Phaser.Scene): void {
    this.container.setVisible(true);
    this.container.setAlpha(0).setScale(0.6);
    scene.tweens.add({
      targets: this.container,
      alpha: 1,
      scale: 1,
      duration: 400,
      ease: 'Back.easeOut',
    });
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
    this.barFill.width = this.barWidthPx * this.getHpRatio();
    this.barFill.fillColor = this.hp > this.maxHp * 0.3 ? 0x66bb6a : 0xef5350;
  }

  destroy(): void {
    this.focusPulseTween?.stop(); // 第十四輪：清脈動 tween，避免 destroy 後 orphan tween
    this.focusPulseTween = null;
    this.container.destroy();
  }
}
