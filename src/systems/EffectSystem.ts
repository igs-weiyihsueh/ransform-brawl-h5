import Phaser from 'phaser';
import { VFX_EFFECTS, VFX_FRAME_PAD, type VFXEffectDef } from '@/config/vfxConfig';
import { ENERGY_FLY, flyAlpha, flyPosition, flyScale } from '@/systems/energyFlyMath';
import {
  CHEST_REWARD_FX,
  chestRewardIsTicket,
  chestRewardLabel,
} from '@/systems/chestRewardDisplay';
import {
  COMBO_REWARD_FX,
  comboRewardFontSize,
  comboRewardLabel,
} from '@/systems/comboRewardDisplay';
import type { ChestRewardKind } from '@/config/chestConfig';

const BASE_PATH = 'assets/images/vfx';

/** 能量飛光 depth（飛在角色上層；角色 depth 為 0 量級、頭上 UI 900）。 */
const ENERGY_FLY_DEPTH = 950;

/** 特效單張幀的 texture key，例如 "vfx/attack_03/03"。 */
function frameKey(effectKey: string, index: number): string {
  return `vfx/${effectKey}/${String(index).padStart(VFX_FRAME_PAD, '0')}`;
}

/** 特效 animation 的 key，例如 "vfx__attack_03"。 */
function animKey(effectKey: string): string {
  return `vfx__${effectKey}`;
}

/**
 * EffectSystem — 可重用的一次性攻擊特效（VFX）系統。
 *
 * 依 vfxConfig 資料驅動：preload 幀圖、register 動畫，之後任意攻擊呼叫
 *   effects.play(effectKey, x, y, facing, scale?)
 * 就會在該世界座標播一次該特效（依 facing flipX、指定 depth 在角色上層、播完自動銷毀）。
 *
 * 架構分層：純特效播放邏輯放這（systems/），數值在 config/vfxConfig，
 * 場景只在 create() 建一個 EffectSystem、在需要時呼叫 play()。
 */
export class EffectSystem {
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** preload 指定特效（或全部）的幀圖。放在場景 preload() 呼叫。 */
  static preload(scene: Phaser.Scene, effectKey?: string): void {
    const keys = effectKey ? [effectKey] : Object.keys(VFX_EFFECTS);
    for (const key of keys) {
      const def = VFX_EFFECTS[key];
      if (!def) throw new Error(`Unknown VFX effect: ${key}`);
      for (let i = 0; i < def.frames; i++) {
        const idx = def.startIndex + i;
        const padded = String(idx).padStart(VFX_FRAME_PAD, '0');
        scene.load.image(frameKey(key, idx), `${BASE_PATH}/${key}/frame_${padded}.png`);
      }
    }
  }

  /** 依設定建立特效動畫（全域唯一，重複跳過）。放在場景 create()。 */
  static register(scene: Phaser.Scene, effectKey?: string): void {
    const keys = effectKey ? [effectKey] : Object.keys(VFX_EFFECTS);
    for (const key of keys) {
      const def: VFXEffectDef | undefined = VFX_EFFECTS[key];
      if (!def) throw new Error(`Unknown VFX effect: ${key}`);
      const aKey = animKey(key);
      if (scene.anims.exists(aKey)) continue;
      const frames: Phaser.Types.Animations.AnimationFrame[] = [];
      for (let i = 0; i < def.frames; i++) {
        frames.push({ key: frameKey(key, def.startIndex + i) });
      }
      scene.anims.create({
        key: aKey,
        frames,
        frameRate: def.fps,
        repeat: 0, // 一次性
      });
    }
  }

  /**
   * 在世界座標播放一次特效。
   * @param effectKey 特效 key（對應 VFX_EFFECTS / vfx/<key>/）。
   * @param x,y 世界像素座標（通常為攻擊判定中心）。
   * @param facing 面向：+1 面右、-1 面左（與角色面向一致）。
   * @param scaleOverride 覆蓋 config 的 scale（可選）。
   */
  play(effectKey: string, x: number, y: number, facing: number, scaleOverride?: number): void {
    const def = VFX_EFFECTS[effectKey];
    if (!def) {
      console.warn(`[EffectSystem] unknown effect: ${effectKey}`);
      return;
    }
    const spr = this.scene.add.sprite(x, y, frameKey(effectKey, def.startIndex));
    spr.setOrigin(0.5, 0.5);
    spr.setDepth(def.depth);
    spr.setScale(scaleOverride ?? def.scale);
    // VFX 幀圖預設朝向為「面左」，故面右時才鏡像，讓特效方向跟角色面向一致
    // （面右→朝右、面左→朝左，與攻擊判定 OBB 的 offsetX 方向對齊）。
    spr.setFlipX(facing > 0);
    spr.play(animKey(effectKey));
    // 播完自動銷毀。
    spr.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => spr.destroy());
  }

  /**
   * 能量飛寶盒表演（第4項）：一道識別色光點從起點飛到終點（lerp ~0.7s）+ 縮放脈動 + 尾段淡出。
   * ⚠️ 純視覺疊加：不涉及 chest 數值（addCharge 已在擊殺結算即時加值、與此解耦）。
   * @param fromX,fromY 起點（敵人死亡位置，世界座標）
   * @param toX,toY 終點（該 player 寶盒 UI 位置，螢幕座標；面板 scrollFactor 0）
   * @param color 光點顏色（該 player 識別色 PLAYER_COLORS）
   */
  flyEnergy(fromX: number, fromY: number, toX: number, toY: number, color: number): void {
    const dot = this.scene.add.graphics();
    dot.fillStyle(color, 1);
    dot.fillCircle(0, 0, ENERGY_FLY.radiusPx);
    dot.setDepth(ENERGY_FLY_DEPTH); // 飛在角色上層
    dot.setScrollFactor(0); // 終點是螢幕座標(面板)，光點也走螢幕空間
    dot.x = fromX;
    dot.y = fromY;

    const state = { t: 0 };
    this.scene.tweens.add({
      targets: state,
      t: 1,
      duration: ENERGY_FLY.durationSec * 1000,
      ease: 'Sine.easeIn',
      onUpdate: () => {
        const p = flyPosition(fromX, fromY, toX, toY, state.t);
        dot.x = p.x;
        dot.y = p.y;
        dot.setScale(flyScale(state.t));
        dot.setAlpha(flyAlpha(state.t));
      },
      onComplete: () => dot.destroy(),
    });
  }

  /**
   * 開箱報獎表演（第5項，純視覺）：在寶盒位置發光/彈跳 + 報獎文字上飄淡出。
   * ⚠️ 純視覺疊加：chest 數值(addTickets/buff)已即時套用、與此解耦。
   * @param x,y 寶盒 UI 位置（getChestAnchor，螢幕座標）
   * @param kind 獎勵種類；tickets 彩票張數
   * @param color 該玩家識別色（效果類文字點綴用）
   */
  chestReward(
    x: number,
    y: number,
    kind: ChestRewardKind,
    tickets: number,
    color: number,
  ): void {
    // 1) 寶盒發光/彈跳：識別色光環從小脈動放大再淡出。
    const ring = this.scene.add.graphics();
    ring.lineStyle(4, color, 0.9);
    ring.strokeCircle(0, 0, 30);
    ring.setDepth(ENERGY_FLY_DEPTH);
    ring.setScrollFactor(0);
    ring.x = x;
    ring.y = y;
    ring.setScale(0.4);
    this.scene.tweens.add({
      targets: ring,
      scale: CHEST_REWARD_FX.pulseScale,
      alpha: 0,
      duration: CHEST_REWARD_FX.pulseSec * 1000,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    // 2) 報獎文字上飄淡出（彩票金色 / 效果類該玩家識別色）。
    const label = chestRewardLabel(kind, tickets);
    if (!label) return;
    const textColor = chestRewardIsTicket(kind)
      ? '#ffd54f'
      : `#${color.toString(16).padStart(6, '0')}`;
    const txt = this.scene.add.text(x, y, label, {
      fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
      fontSize: '34px',
      color: textColor,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 5,
    });
    txt.setOrigin(0.5, 1);
    txt.setDepth(ENERGY_FLY_DEPTH + 1);
    txt.setScrollFactor(0);
    this.scene.tweens.add({
      targets: txt,
      y: y - CHEST_REWARD_FX.risePx,
      alpha: { from: 1, to: 0 },
      duration: CHEST_REWARD_FX.durationSec * 1000,
      ease: 'Sine.easeOut',
      onComplete: () => txt.destroy(),
    });
  }

  /**
   * COMBO 結算報獎表演（第3項，純視覺）：玩家頭上顯示「COMBO xN +M」放大彈跳 + 上飄淡出。
   * isMax(滿檔) 更華麗（更大字 + 識別色爆發光環）。世界座標（跟隨玩家，非螢幕空間）。
   * ⚠️ 純視覺疊加：combo 數值(addTickets)已即時結算、與此解耦。
   * @param x,y 玩家世界座標；報獎顯示在其上方
   * @param count COMBO 數；tickets 結算彩票數；isMax 是否滿檔；color 該玩家識別色
   */
  comboReward(
    x: number,
    y: number,
    count: number,
    tickets: number,
    isMax: boolean,
    color: number,
  ): void {
    const topY = y - COMBO_REWARD_FX.offsetYPx;

    // 滿檔：識別色爆發光環（世界座標）。
    if (isMax) {
      const burst = this.scene.add.graphics();
      burst.lineStyle(5, color, 1);
      burst.strokeCircle(0, 0, 40);
      burst.setDepth(ENERGY_FLY_DEPTH);
      burst.x = x;
      burst.y = topY;
      burst.setScale(0.3);
      this.scene.tweens.add({
        targets: burst,
        scale: 2.4,
        alpha: 0,
        duration: 500,
        ease: 'Cubic.easeOut',
        onComplete: () => burst.destroy(),
      });
    }

    // 報獎文字：放大彈跳 → 上飄淡出。滿檔用識別色，一般用金色。
    const label = comboRewardLabel(count, tickets, isMax);
    const textColor = isMax ? `#${color.toString(16).padStart(6, '0')}` : '#ffd54f';
    const txt = this.scene.add.text(x, topY, label, {
      fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
      fontSize: `${comboRewardFontSize(isMax)}px`,
      color: textColor,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    });
    txt.setOrigin(0.5, 1);
    txt.setDepth(ENERGY_FLY_DEPTH + 1);
    txt.setScale(0.5);
    // 起手放大彈跳。
    this.scene.tweens.add({
      targets: txt,
      scale: COMBO_REWARD_FX.popScale,
      duration: COMBO_REWARD_FX.popSec * 1000,
      ease: 'Back.easeOut',
    });
    // 上飄 + 淡出（整段時長）。
    this.scene.tweens.add({
      targets: txt,
      y: topY - COMBO_REWARD_FX.risePx,
      alpha: { from: 1, to: 0 },
      duration: COMBO_REWARD_FX.durationSec * 1000,
      ease: 'Sine.easeOut',
      onComplete: () => txt.destroy(),
    });
  }
}
