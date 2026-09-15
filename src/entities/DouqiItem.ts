import Phaser from 'phaser';
import type { DouqiItemSkill } from '@/config/douqiItemConfig';
import { DOUQI_ITEM_CONFIG } from '@/config/douqiItemConfig';
import { lifespanPhase, blinkVisible } from '@/systems/douqiItemMath';

/**
 * DouqiItem — 鬥氣單一場上道具（階段1，物件自管 graphics，仿 gap-ball 自管風格）。
 *
 * 掉地靜置（不吸附）、lifespan 到 blinkBefore 開始閃爍、逾時消失。護盾圈可畫（shieldHp）但★階段1 不接破盾判定（階段1.5 接）。
 * 階段1 圖示＝色塊佔位（識別色圓 + skill 字母 + 護盾圈），素材到階段2 換精緻圖示。
 */
export class DouqiItem {
  readonly skill: DouqiItemSkill;
  readonly color: number;
  readonly x: number;
  readonly y: number;
  /** 護盾剩餘（階段1 恆 shieldHp、不扣；階段1.5 接破盾）。 */
  shieldHp: number;
  private elapsedMs = 0;
  private alive = true;
  private readonly cfg = DOUQI_ITEM_CONFIG;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, skill: DouqiItemSkill, color: number, x: number, y: number, labelText: string) {
    this.skill = skill;
    this.color = color;
    this.x = x;
    this.y = y;
    this.shieldHp = this.cfg.shieldHp;
    this.gfx = scene.add.graphics().setDepth(55); // 世界層（略低於招式 telegraph60、在地上）
    this.label = scene.add
      .text(x, y, labelText, { fontFamily: 'Arial, sans-serif', fontSize: '16px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5, 0.5)
      .setDepth(56);
    this.draw(true);
  }

  /** 每幀（DouqiItemSystem 呼）：推進 lifespan、閃爍、逾時→標記移除。回 false＝已逾時該回收。 */
  update(dtMs: number): boolean {
    if (!this.alive) return false;
    this.elapsedMs += dtMs;
    const phase = lifespanPhase(this.elapsedMs, this.cfg.lifespanMs, this.cfg.blinkBeforeMs);
    if (phase === 'expired') {
      this.alive = false;
      return false;
    }
    const visible = phase === 'blinking' ? blinkVisible(this.elapsedMs, this.cfg.blinkPeriodMs) : true;
    this.setVisible(visible);
    return true;
  }

  /** 佔位圖示：識別色填充圓 + 護盾圈（依剩餘盾量 strokeCircle）。素材到階段2 換。 */
  private draw(_first = false): void {
    const g = this.gfx;
    g.clear();
    const r = this.cfg.displayRadiusPx;
    // 道具本體（識別色實心圓 + 白邊）。
    g.fillStyle(this.color, 0.95).fillCircle(this.x, this.y, r);
    g.lineStyle(2, 0xffffff, 0.9).strokeCircle(this.x, this.y, r);
    // 護盾圈（階段1 純視覺提示有盾；破盾階段1.5 接。剩餘盾量→外圈虛線段數）。
    if (this.shieldHp > 0) {
      g.lineStyle(2, 0xbfe6ff, 0.7).strokeCircle(this.x, this.y, r + 6);
    }
  }

  private setVisible(v: boolean): void {
    this.gfx.setVisible(v);
    this.label.setVisible(v);
  }

  isAlive(): boolean {
    return this.alive;
  }
  getHitCenter(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }
  getPickupRadiusPx(): number {
    return this.cfg.pickupRadiusPx;
  }

  destroy(): void {
    this.alive = false;
    this.gfx.destroy();
    this.label.destroy();
  }
}
