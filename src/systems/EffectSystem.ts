import Phaser from 'phaser';
import { VFX_EFFECTS, VFX_FRAME_PAD, type VFXEffectDef } from '@/config/vfxConfig';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import { UI_ICONS, UI_LAYOUT_ASSET, PANEL_DEPTH } from '@/config/uiConfig';
import { validateUiLayout, isVisible, type ScreenElement } from '@/config/uiLayoutSchema';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';
import { WAVE_MESSAGE_FX } from '@/systems/waveMessage';
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

/**
 * 敵人攻擊特效（用戶 #7，特效 agent 產的單張 PNG，非幀動畫）：以 tween 播 scale/alpha/rotation。
 * key = Phaser texture key；path 相對 public/。preload 於 EffectSystem.preload 一併載入。
 */
const ENEMY_ATTACK_VFX = {
  slash: { key: 'vfx-enemy-slash', path: `${BASE_PATH}/fx_enemy_slash.png` },
  /** 七輪：衝鋒兵扇形揮砍（左頂點往右張 76°，白刃+橘紅能量+3 道弧形刃光）。 */
  fan: { key: 'vfx-enemy-fan', path: `${BASE_PATH}/fx_enemy_fan.png` },
  impact: { key: 'vfx-enemy-impact', path: `${BASE_PATH}/fx_enemy_impact.png` },
  charge: { key: 'vfx-enemy-charge', path: `${BASE_PATH}/fx_enemy_charge.png` },
  /** 集氣升級版（用戶 #4：中心聚能核 + 5 道環繞氣流臂，靠 rotation 呈現漩渦感）。正視漩渦，保留備用。 */
  charge2: { key: 'vfx-enemy-charge2', path: `${BASE_PATH}/fx_enemy_charge2.png` },
  /** 三輪#3：俯視腳底充能法陣盤（特效 agent 畫，徑向紅金+同心圓+白熱核+放射刻度+氣流臂+符文，專為貼地壓扁旋轉）。 */
  chargeDisk: { key: 'vfx-enemy-charge-disk', path: `${BASE_PATH}/fx_enemy_charge_disk.png` },
  /** 圓形範圍攻擊預告圈（用戶 #3：地面紅色 AOE 警示圈）。 */
  aoeRing: { key: 'vfx-enemy-aoe-ring', path: `${BASE_PATH}/fx_enemy_aoe_ring.png` },
  /** 圓形範圍攻擊爆發（用戶 #3：白熱核+放射+衝擊波）。 */
  aoeBurst: { key: 'vfx-enemy-aoe-burst', path: `${BASE_PATH}/fx_enemy_aoe_burst.png` },
  /** 守護開場聚焦放射漸層（用戶 #4，中心透明→外圈壓黑；異靈畫，alpha 客觀確認）。 */
  spotlight: { key: 'vfx-spotlight-radial', path: `${BASE_PATH}/spotlight_radial.png` },
  /** 三輪#11 火雨重製：從天墜落的火球（帶火焰拖尾）。素材到位前用 aoeBurst 佔位。 */
  fireballFall: { key: 'vfx-fireball-falling', path: `${BASE_PATH}/fireball_falling.png` },
  /** 三輪#11 火雨重製：落地火焰爆發。素材到位前用 aoeBurst 佔位。 */
  fireballImpact: { key: 'vfx-fireball-impact', path: `${BASE_PATH}/fireball_impact.png` },
  /** 七輪：玩家衝刺拖尾（160×80, 頭亮尾淡, 白青可染玩家色）。 */
  playerDash: { key: 'vfx-player-dash', path: `${BASE_PATH}/fx_player_dash.png` },
  /** 九輪#3：玩家衝刺前方防護罩（128×128, 朝右凸弧形力場罩, 可染玩家色）。 */
  playerDashShield: { key: 'vfx-player-dash-shield', path: `${BASE_PATH}/fx_player_dash_shield.png` },
  /** 十五輪：守護聚焦壓暗遮罩（1920×1080 徑向 vignette，中心透明圓露雕像、邊緣黑 alpha 0.85 柔邊）。 */
  guardFocusVignette: { key: 'vfx-guard-focus-vignette', path: `${BASE_PATH}/fx_guard_focus_vignette.png` },
  /** 十五輪：守護聚焦暖白柔光暈（1024×1024，中心 alpha 0.57→邊緣 0，疊雕像後增強聚光）。 */
  guardFocusGlow: { key: 'vfx-guard-focus-glow', path: `${BASE_PATH}/fx_guard_focus_glow.png` },
} as const;

/** 敵人攻擊特效 depth（畫在角色上層，跟命中火花同層級）。 */
const ATTACK_VFX_DEPTH = 950;


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
  /** 用戶 #5/#8：螢幕訊息位置快取（waveMessage/eventMessage/fireRainMessage），null=尚未讀。 */
  private cachedScreenEl: Partial<Record<'waveMessage' | 'eventMessage' | 'fireRainMessage', ScreenElement>> = {};

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
    // 用戶 #7：敵人攻擊單張 PNG 特效（斬光/命中/蓄力）。只在載全部（無指定 key）時一併載入。
    if (!effectKey) {
      for (const v of Object.values(ENEMY_ATTACK_VFX)) {
        if (!scene.textures.exists(v.key)) scene.load.image(v.key, v.path);
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
  /** 取某特效的預設 scale（十三輪#1(A)：呼叫端要在其上再乘讓位係數用）。未知 key → 1。 */
  getEffectScale(effectKey: string): number {
    return VFX_EFFECTS[effectKey]?.scale ?? 1;
  }

  play(effectKey: string, x: number, y: number, facing: number, scaleOverride?: number, rotationRad?: number, alphaOverride?: number): void {
    const def = VFX_EFFECTS[effectKey];
    if (!def) {
      console.warn(`[EffectSystem] unknown effect: ${effectKey}`);
      return;
    }
    const spr = this.scene.add.sprite(x, y, frameKey(effectKey, def.startIndex));
    spr.setOrigin(0.5, 0.5);
    spr.setDepth(def.depth);
    spr.setScale(scaleOverride ?? def.scale);
    if (alphaOverride !== undefined) spr.setAlpha(alphaOverride); // 十三輪#1(A)：斬光降 alpha 讓位，別蓋過角色揮擊。
    if (rotationRad !== undefined) {
      // 十一輪#2 auto-aim：有 aim → 斬光 rotate 朝 aim 角度（素材預設朝左，+π 對齊：面左=0 基準 → rotationRad 為「玩家→aim」角，加 PI 讓朝左素材轉到 aim 方向）。
      spr.setRotation(rotationRad + Math.PI);
    } else {
      // 無 aim（相容）：VFX 幀圖預設朝左，面右時鏡像，讓特效方向跟角色面向一致。
      spr.setFlipX(facing > 0);
    }
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
    // ★報獎浮到底部面板(PANEL_DEPTH=1000)之上，否則被面板遮住看不到（用戶回報主因）。
    const depth = PANEL_DEPTH + 10; // 1010
    // 1) 寶盒發光/彈跳：識別色光環從小脈動放大再淡出。
    const ring = this.scene.add.graphics();
    ring.lineStyle(4, color, 0.9);
    ring.strokeCircle(0, 0, 30);
    ring.setDepth(depth);
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
    const isTicket = chestRewardIsTicket(kind);
    const textColor = isTicket ? '#ffd54f' : `#${color.toString(16).padStart(6, '0')}`;

    // 2a) 彩票類：彩票 icon + 「+N」數字並排（icon 在數字左側），一起往上飄淡出。
    const rewardObjs: Phaser.GameObjects.GameObject[] = [];
    const iconPx = CHEST_REWARD_FX.ticketIconPx;
    let icon: Phaser.GameObjects.Image | null = null;
    if (isTicket && this.scene.textures.exists(UI_ICONS.ticket.key)) {
      icon = this.scene.add.image(x, y, UI_ICONS.ticket.key).setScrollFactor(0).setDepth(depth);
      icon.setDisplaySize(iconPx, iconPx);
      icon.setOrigin(0.5, 1);
      rewardObjs.push(icon);
    }

    const txt = this.scene.add.text(x, y, label, {
      fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
      fontSize: '40px',
      color: textColor,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    });
    txt.setOrigin(0.5, 1);
    txt.setDepth(depth);
    txt.setScrollFactor(0);
    rewardObjs.push(txt);

    // 彩票 icon + 數字並排置中：icon 在左、數字在右。
    if (icon) {
      const gap = 8;
      const totalW = iconPx + gap + txt.width;
      icon.x = x - totalW / 2 + iconPx / 2;
      txt.x = x + totalW / 2 - txt.width / 2;
    }

    this.scene.tweens.add({
      targets: rewardObjs,
      y: y - CHEST_REWARD_FX.risePx,
      alpha: { from: 1, to: 0 },
      duration: CHEST_REWARD_FX.durationSec * 1000,
      ease: 'Sine.easeOut',
      onComplete: () => rewardObjs.forEach((o) => o.destroy()),
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

  /**
   * 用戶 #5/#8：螢幕訊息定位 = layout.screen.{kind}（螢幕座標 1920×1080）；lazy 讀 scene 快取 + schema 驗證，
   * 無 screen/該訊息（舊資料/未載/不合法）→ fallback 內建預設（不炸）。三種訊息共用。
   * @param kind waveMessage(波次) / eventMessage(限時事件/守護波) / fireRainMessage(天降火雨)。
   * @param fallback 該訊息的內建預設位置。
   */
  private screenElement(
    kind: 'waveMessage' | 'eventMessage' | 'fireRainMessage',
    fallback: ScreenElement,
  ): ScreenElement {
    const cached = this.cachedScreenEl[kind];
    if (cached) return cached;
    let el = fallback;
    const override = loadOverride(EDITOR_STORE_KEYS.uiLayout); // 匯入機制：override 優先
    const raw = override ?? (this.scene.cache.json.get(UI_LAYOUT_ASSET.key) as unknown);
    if (raw !== undefined && raw !== null) {
      const result = validateUiLayout(raw);
      if (result.ok && result.data.screen?.[kind]) {
        el = result.data.screen[kind] as ScreenElement;
      }
    }
    this.cachedScreenEl[kind] = el;
    return el;
  }

  /** 用戶 #5：波次訊息定位（見 screenElement）。fallback = 中央略高 GAME_HEIGHT*0.42、滿寬置中。 */
  private screenWaveMessage(): ScreenElement {
    return this.screenElement('waveMessage', {
      x: 0,
      y: GAME_HEIGHT * 0.42 - 50,
      width: GAME_WIDTH,
      height: 100,
      align: 'center',
    });
  }

  /**
   * 波次過場提示（#9/#5，純視覺）：讀 layout.screen.waveMessage 定位（螢幕座標 1920×1080 基準），
   * 淡入放大 → 停留 → 淡出。無 screen（舊資料）→ fallback 內建預設位置。align 給文字對齊。
   * @param text 過場文字（空字串不顯示）。
   */
  waveMessage(text: string): void {
    if (!text) return;
    // 用戶 #5：讀 layout.screen.waveMessage 的 {x,y,width,height,align}；無則 fallback 內建預設。
    const el = this.screenWaveMessage();
    if (!isVisible(el)) return; // 用戶 #6：勾掉 waveMessage → 不顯
    const barY = el.y + el.height / 2; // 元素中心 Y
    const align = el.align ?? 'center';
    // 文字 X 依 align：center=元素中心、left=左緣、right=右緣。
    const textX =
      align === 'left' ? el.x : align === 'right' ? el.x + el.width : el.x + el.width / 2;
    const originX = align === 'left' ? 0 : align === 'right' ? 1 : 0.5;
    // 半透明背景條（橫幅，鋪滿螢幕寬、以元素中心 Y 為中線），讓文字醒目。
    const bar = this.scene.add.graphics();
    bar.fillStyle(0x000000, 0.5);
    bar.fillRect(0, barY - el.height / 2, GAME_WIDTH, el.height);
    bar.setScrollFactor(0).setDepth(ENERGY_FLY_DEPTH + 5);
    const txt = this.scene.add.text(textX, barY, text, {
      fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
      fontSize: `${WAVE_MESSAGE_FX.fontSize}px`,
      color: '#ffffff',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    });
    txt.setOrigin(originX, 0.5).setScrollFactor(0).setDepth(ENERGY_FLY_DEPTH + 6).setScale(0.6).setAlpha(0);

    const total = WAVE_MESSAGE_FX.durationSec * 1000;
    const fadeIn = total * 0.2;
    const hold = total * WAVE_MESSAGE_FX.holdRatio;
    const fadeOut = total - fadeIn - hold;
    // 淡入 + 放大。
    this.scene.tweens.add({
      targets: [txt],
      alpha: 1,
      scale: 1,
      duration: fadeIn,
      ease: 'Back.easeOut',
    });
    this.scene.tweens.add({ targets: [bar], alpha: { from: 0, to: 1 }, duration: fadeIn });
    // 停留後淡出（文字+背景一起），完成銷毀。
    this.scene.tweens.add({
      targets: [txt, bar],
      alpha: 0,
      delay: fadeIn + hold,
      duration: fadeOut,
      ease: 'Sine.easeIn',
      onComplete: () => {
        txt.destroy();
        bar.destroy();
      },
    });
  }

  /**
   * 獎勵節點報獎演出（用戶 #3，對照 Unity RewardFanfare + RewardFlowUI）：
   *  1. 「恭喜獲獎！」+ 燈號圖 banner 從下方浮現到定位。
   *  2. 停 3s。
   *  3. banner 退出。
   *  4. 一道光從 banner 燈號圖飛到 JP 燈錨點（取不到起點 → 用進度條該獎勵節點 marker）。
   *  5. 光到達 → onArrive()（呼叫端點亮 JP 下一顆燈）。
   * 純視覺；點燈的數值變更由 onArrive 內的 JpSystem.addRewardLight 負責（與此解耦）。
   * @param markerX,markerY 進度條該獎勵節點 marker 螢幕座標（飛光起點保底，banner 燈號圖取不到時用）。
   * @param jpX,jpY 飛光終點＝該組下一顆 JP 燈的螢幕座標（HUD 提供；取不到時呼叫端給保底）。
   * @param onArrive 光到達 JP 燈時的 callback（點燈）。取不到位置時仍會呼叫（不漏獎）。
   */
  rewardFanfare(
    markerX: number,
    markerY: number,
    jpX: number,
    jpY: number,
    onArrive: () => void,
  ): void {
    const cx = GAME_WIDTH * 0.5;
    const bannerY = GAME_HEIGHT * 0.62;
    const hasLamp = this.scene.textures.exists(UI_ICONS.lamp.key);
    const depth = ENERGY_FLY_DEPTH + 8;

    // banner 容器：底板 + 燈號圖 + 「恭喜獲獎！」。
    const bar = this.scene.add.graphics().setScrollFactor(0).setDepth(depth);
    bar.fillStyle(0x1a1030, 0.82);
    bar.fillRoundedRect(cx - 240, bannerY - 60, 480, 120, 16);
    bar.lineStyle(3, 0xffd24d, 0.9);
    bar.strokeRoundedRect(cx - 240, bannerY - 60, 480, 120, 16);
    const lampIcon = hasLamp
      ? this.scene.add.image(cx - 150, bannerY, UI_ICONS.lamp.key).setScrollFactor(0).setDepth(depth + 1)
      : null;
    lampIcon?.setDisplaySize(72, 72);
    const txt = this.scene.add
      .text(cx + 30, bannerY, '恭喜獲獎！', {
        fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
        fontSize: '44px',
        color: '#ffe64d',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(depth + 1);

    const group: Phaser.GameObjects.GameObject[] = [bar, txt];
    if (lampIcon) group.push(lampIcon);
    // 初始在下方外、淡入上浮到定位。
    const riseFrom = 140;
    for (const o of group) {
      const s = o as unknown as { y: number; alpha: number };
      s.y += riseFrom;
      s.alpha = 0;
    }
    this.scene.tweens.add({
      targets: group,
      y: `-=${riseFrom}`,
      alpha: 1,
      duration: 350,
      ease: 'Back.easeOut',
    });

    // 停 3s → banner 退出（往下 + 淡出）→ 飛光。
    this.scene.time.delayedCall(350 + 3000, () => {
      // 飛光起點：banner 燈號圖螢幕位置（取不到 → 進度條該獎勵節點 marker）。
      const lampX = lampIcon ? cx - 150 : markerX;
      const lampY = lampIcon ? bannerY : markerY;
      this.scene.tweens.add({
        targets: group,
        y: `+=${riseFrom}`,
        alpha: 0,
        duration: 300,
        ease: 'Sine.easeIn',
        onComplete: () => group.forEach((o) => o.destroy()),
      });
      // 飛光 → 該組下一顆 JP 燈（HUD 提供的真燈座標）。
      this.flyRewardLight(lampX, lampY, jpX, jpY, onArrive);
    });
  }

  /**
   * 獎勵飛光（用戶 #3）：一道金光從起點飛到 JP 燈（~0.7s），到達 → onArrive() + 該燈點亮脈動。
   * @param fromX,fromY 起點（banner 燈號圖 or 進度條 marker）。
   * @param toX,toY 終點（該組下一顆 JP 燈螢幕座標）。
   * @param onArrive 到達 callback（點燈）。
   */
  private flyRewardLight(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    onArrive: () => void,
  ): void {
    const dot = this.scene.add.graphics().setScrollFactor(0).setDepth(ENERGY_FLY_DEPTH + 9);
    dot.fillStyle(0xffe64d, 1);
    dot.fillCircle(0, 0, 12);
    dot.x = fromX;
    dot.y = fromY;
    this.scene.tweens.add({
      targets: dot,
      x: toX,
      y: toY,
      scale: { from: 1, to: 1.4 },
      duration: 700,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        dot.destroy();
        // 到達才點燈（Unity LightNext）+ JP 燈點亮脈動（金色爆閃）。
        onArrive();
        const flash = this.scene.add.graphics().setScrollFactor(0).setDepth(ENERGY_FLY_DEPTH + 9);
        flash.fillStyle(0xffe64d, 0.9);
        flash.fillCircle(0, 0, 20);
        flash.x = toX;
        flash.y = toY;
        this.scene.tweens.add({
          targets: flash,
          scale: { from: 0.6, to: 2.2 },
          alpha: { from: 0.9, to: 0 },
          duration: 400,
          ease: 'Quad.easeOut',
          onComplete: () => flash.destroy(),
        });
      },
    });
  }

  /**
   * 「限時事件」宣告大字（用戶 #4 守護波開場，對照 Unity TimedEventTextUI）：從右側滑進、顯滿 durationSec、滑出。
   * 玩家照走不等（非阻塞）。純視覺。
   * @param durationSec 顯示時長（Unity ≈3s）。
   */
  timedEventText(durationSec = 3, text = '限時事件'): void {
    if (text === '') return; // 第十四輪：空字串=用戶清空文字 → 不顯
    // 用戶 #8：讀 layout.screen.eventMessage 定位；無則 fallback 內建(GAME_HEIGHT*0.3 滿寬置中、高 92)。
    const el = this.screenElement('eventMessage', {
      x: 0,
      y: GAME_HEIGHT * 0.3 - 46,
      width: GAME_WIDTH,
      height: 92,
      align: 'center',
    });
    if (!isVisible(el)) return; // 用戶 #6：勾掉 eventMessage → 不顯
    const cy = el.y + el.height / 2;
    const align = el.align ?? 'center';
    const cx = align === 'left' ? el.x : align === 'right' ? el.x + el.width : el.x + el.width / 2;
    const originX = align === 'left' ? 0 : align === 'right' ? 1 : 0.5;
    const bar = this.scene.add.graphics().setScrollFactor(0).setDepth(ENERGY_FLY_DEPTH + 6);
    bar.fillStyle(0x8a1a1a, 0.72);
    bar.fillRect(0, cy - el.height / 2, GAME_WIDTH, el.height);
    bar.lineStyle(3, 0xffd24d, 0.9);
    bar.strokeRect(0, cy - el.height / 2, GAME_WIDTH, el.height);
    const txt = this.scene.add
      .text(cx, cy, text, {
        fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
        fontSize: '52px',
        color: '#ffe64d',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 7,
      })
      .setOrigin(originX, 0.5)
      .setScrollFactor(0)
      .setDepth(ENERGY_FLY_DEPTH + 7);
    const group: Phaser.GameObjects.GameObject[] = [bar, txt];
    // 從右滑進。
    for (const o of group) (o as unknown as { x: number }).x += GAME_WIDTH;
    this.scene.tweens.add({ targets: group, x: `-=${GAME_WIDTH}`, duration: 400, ease: 'Back.easeOut' });
    // 顯滿後滑出（往左）+ 淡出。
    this.scene.time.delayedCall(400 + durationSec * 1000, () => {
      this.scene.tweens.add({
        targets: group,
        x: `-=${GAME_WIDTH}`,
        alpha: 0,
        duration: 350,
        ease: 'Sine.easeIn',
        onComplete: () => group.forEach((o) => o.destroy()),
      });
    });
  }

  /**
   * 守護開場聚焦壓暗 + spotlight（用戶 #4，對照 Unity GuardIntroFocusUI）：
   * 全螢幕壓暗遮罩 + 雕像位置亮圈（放射漸層感：中心透出、外圈壓暗）。回傳 handle，呼叫端 .fadeOut() 收掉。
   * 用同心圓環由內亮到外暗近似放射漸層（無漸層貼圖時的 graphics 後備）。
   * @param x,y 雕像螢幕座標（spotlight 中心）。
   * @param radiusPx spotlight 亮圈半徑。
   */
  /**
   * 守護開場聚焦壓暗 + spotlight（用戶 #4，對照 Unity GuardIntroFocusUI / SpotlightRadial）：
   * 用放射漸層貼圖（spotlight_radial.png：中心 alpha=0 透出雕像 → 外圈近黑壓暗）鋪滿螢幕、中心對準雕像。
   * 比程式畫的壓暗穩（整張貼圖 alpha 明確）。回傳 handle，呼叫端 .fadeOut() 收掉。
   * @param x,y 雕像螢幕座標（spotlight 透明中心對準此）。
   * @param radiusPx 亮圈金環半徑（點綴）。
   */
  guardSpotlight(x: number, y: number, radiusPx = 200): { fadeOut: () => void } {
    const depth = ENERGY_FLY_DEPTH + 10; // 960：壓暗蓋住場上角色/敵人/背景（雕像由呼叫端提到此之上）
    const objs: Phaser.GameObjects.GameObject[] = [];
    const vigKey = ENEMY_ATTACK_VFX.guardFocusVignette.key;
    const glowKey = ENEMY_ATTACK_VFX.guardFocusGlow.key;
    if (this.scene.textures.exists(vigKey)) {
      // 十五輪：徑向壓暗遮罩（中心透明圓露雕像、邊緣黑 0.85 柔邊）——中心對雕像，撐滿螢幕含四角。
      const vig = this.scene.add.image(x, y, vigKey).setScrollFactor(0).setDepth(depth).setAlpha(0);
      // vignette 素材 1920×1080；放大到對角線覆蓋，確保雕像不在正中時四角也全黑不漏。
      const cover = Math.hypot(GAME_WIDTH, GAME_HEIGHT) / Math.min(GAME_WIDTH, GAME_HEIGHT) * GAME_WIDTH;
      vig.setDisplaySize(Math.max(GAME_WIDTH, cover) * 1.4, Math.max(GAME_HEIGHT, cover) * 1.4);
      this.scene.tweens.add({ targets: vig, alpha: 1, duration: 350, ease: 'Sine.easeOut' });
      objs.push(vig);
    } else {
      // 後備：貼圖沒載到 → 全螢幕 Rectangle 壓暗（不漏聚焦）。
      const dim = this.scene.add
        .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.85)
        .setScrollFactor(0)
        .setDepth(depth)
        .setAlpha(0);
      this.scene.tweens.add({ targets: dim, alpha: 1, duration: 350, ease: 'Sine.easeOut' });
      objs.push(dim);
    }
    // 十五輪：暖白柔光暈疊雕像後（scale 到略大於雕像聚焦半徑，增強戲劇聚光感）；在 vignette 之上、雕像之下。
    if (this.scene.textures.exists(glowKey)) {
      const glow = this.scene.add.image(x, y, glowKey).setScrollFactor(0).setDepth(depth + 1).setAlpha(0);
      glow.setDisplaySize(radiusPx * 3.2, radiusPx * 3.2); // 光暈略大於透明中心圈，暖光溢出邊緣
      glow.setBlendMode(Phaser.BlendModes.ADD); // 加色混合 → 暖光疊亮
      this.scene.tweens.add({ targets: glow, alpha: 0.9, duration: 400, ease: 'Sine.easeOut' });
      objs.push(glow);
    }
    return {
      fadeOut: () => {
        this.scene.tweens.add({
          targets: objs,
          alpha: 0,
          duration: 350,
          ease: 'Sine.easeIn',
          onComplete: () => objs.forEach((o) => o.destroy()),
        });
      },
    };
  }

  /**
   * 「協力合作，守護雕像」守護宣告大字（七輪#5，對照 Unity GuardTextUI）：聚焦壓黑時從左滑進、
   * 停留（由呼叫端 fadeOut 收掉，對齊解聚焦時機）。非阻塞、純視覺。回傳 handle，呼叫端 .fadeOut() 滑出。
   * depth 提到 spotlight(ENERGY_FLY_DEPTH+10) 之上 → 壓黑聚焦時字清楚可見。
   */
  guardText(text = '協力合作，守護雕像'): { fadeOut: () => void } {
    if (text === '') return { fadeOut: () => {} }; // 第十四輪：空字串=清空文字→不顯（回無操作 handle）
    const el = this.screenElement('eventMessage', {
      x: 0,
      y: GAME_HEIGHT * 0.42 - 46,
      width: GAME_WIDTH,
      height: 92,
      align: 'center',
    });
    const depth = ENERGY_FLY_DEPTH + 14; // spotlight(+10)/雕像(+12ish) 之上，聚焦時字最上層
    if (!isVisible(el)) return { fadeOut: () => {} }; // eventMessage 勾掉→不顯（但仍回無操作 handle）
    const cy = el.y + el.height / 2;
    const cx = GAME_WIDTH / 2;
    const txt = this.scene.add
      .text(cx, cy, text, {
        fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
        fontSize: '56px',
        color: '#ffe64d',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 8,
        align: 'center',
      })
      .setOrigin(0.5, 0.5)
      .setScrollFactor(0)
      .setDepth(depth);
    // 從左滑進。
    txt.x -= GAME_WIDTH;
    this.scene.tweens.add({ targets: txt, x: cx, duration: 400, ease: 'Back.easeOut' });
    return {
      fadeOut: () => {
        this.scene.tweens.add({
          targets: txt,
          x: cx + GAME_WIDTH,
          alpha: 0,
          duration: 350,
          ease: 'Sine.easeIn',
          onComplete: () => txt.destroy(),
        });
      },
    };
  }

  /**
   * 火雨預警紅圈（#10）：落點地上紅色半透明圓（直徑=radius×2），停留 warningTime。
   * @returns Graphics（呼叫端在火柱落下時 destroy）。
   */
  fireWarningRing(x: number, y: number, radiusPx: number): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    g.fillStyle(0xff3300, 0.25);
    g.fillCircle(0, 0, radiusPx);
    g.lineStyle(3, 0xff5522, 0.9);
    g.strokeCircle(0, 0, radiusPx);
    g.x = x;
    g.y = y;
    g.setDepth(-5); // 在地上、角色之下（角色 PLAY_DEPTH=10）
    // 預警脈動（呼吸）提示即將落下。
    this.scene.tweens.add({
      targets: g,
      alpha: { from: 0.6, to: 1 },
      duration: 250,
      yoyo: true,
      repeat: -1,
    });
    return g;
  }

  /**
   * 火柱落下閃光（#10 → 三輪#11 升級落地火焰爆發）：落點火焰爆發 + 快速淡出。
   * 有 fireballImpact 素材用貼圖（火焰感）；否則退回橘紅 graphics 圓閃（佔位）。純視覺，傷害在 FireRainSystem。
   */
  fireStrikeFlash(x: number, y: number, radiusPx: number): void {
    const impactKey = ENEMY_ATTACK_VFX.fireballImpact.key;
    const fallbackBurst = ENEMY_ATTACK_VFX.aoeBurst.key;
    const key = this.scene.textures.exists(impactKey)
      ? impactKey
      : this.scene.textures.exists(fallbackBurst)
        ? fallbackBurst
        : null;
    if (key) {
      // 貼圖爆發：落點火焰爆發，爆開放大+淡出+隨機旋轉（正式用 fireballImpact、佔位 aoeBurst 染橘紅）。
      const spr = this.scene.add.image(x, y, key);
      spr.setOrigin(0.5, 0.5).setDepth(ENERGY_FLY_DEPTH);
      spr.setDisplaySize(radiusPx * 1.6, radiusPx * 1.6).setAlpha(1);
      spr.setAngle(Math.random() * 360); // 隨機旋轉(每次爆發不同向)
      if (key === fallbackBurst) spr.setTint(0xff7722); // 佔位：白熱 burst 染火焰橘紅(真素材不染)
      this.scene.tweens.add({
        targets: spr,
        displayWidth: radiusPx * 2.4,
        displayHeight: radiusPx * 2.4,
        alpha: 0,
        duration: 400,
        ease: 'Cubic.easeOut', // scale 炸開 + 後半淡出
        onComplete: () => spr.destroy(),
      });
      return;
    }
    // 後備：純 graphics 橘紅圓閃。
    const g = this.scene.add.graphics();
    g.fillStyle(0xffaa22, 0.85);
    g.fillCircle(0, 0, radiusPx);
    g.x = x;
    g.y = y;
    g.setDepth(ENERGY_FLY_DEPTH);
    g.setScale(0.5);
    this.scene.tweens.add({
      targets: g,
      scale: 1.15,
      alpha: 0,
      duration: 350,
      ease: 'Cubic.easeOut',
      onComplete: () => g.destroy(),
    });
  }

  /**
   * 三輪#11 火雨重製：一顆火球從落點正上方（高處/畫面外）墜落到落點。
   * 墜落結束時機對齊 FireRainSystem 的 resolveStrike（傷害那刻）→ 視覺與傷害同步（用戶核心：傷害在落地爆炸那刻）。
   * 有 fireballFall 素材用貼圖（帶火焰拖尾）；否則退回 aoeBurst 染橘紅佔位。純視覺。
   * @param x,y 落點（世界座標，火球墜落終點）。
   * @param fallMs 墜落時長（= warning 剩餘秒 ×1000，讓落地=傷害那刻）。
   * @param onLand 落地回呼（可選；FireRainSystem 已自行在 resolveStrike 播爆炸，這裡通常不用）。
   * @returns 火球 sprite（呼叫端可持有；落地 tween 完成自動 destroy）；無任何素材則回 null。
   */
  fireballFall(
    x: number,
    y: number,
    fallMs: number,
    onLand?: () => void,
  ): Phaser.GameObjects.Image | null {
    const fallKey = ENEMY_ATTACK_VFX.fireballFall.key;
    const fallbackBurst = ENEMY_ATTACK_VFX.aoeBurst.key;
    const key = this.scene.textures.exists(fallKey)
      ? fallKey
      : this.scene.textures.exists(fallbackBurst)
        ? fallbackBurst
        : null;
    if (!key) {
      if (onLand) this.scene.time.delayedCall(Math.max(50, fallMs), onLand);
      return null;
    }
    const startY = y - 640; // 從落點上方 640px（畫面外/高處）墜下
    const spr = this.scene.add.image(x, startY, key);
    spr.setOrigin(0.5, 0.5).setDepth(ENERGY_FLY_DEPTH - 1); // 火球在角色上層、爆炸之下
    const isReal = key === fallKey;
    // 六輪#8順帶：真火球尺寸依素材原始長寬比推導(不寫死)，特效 agent 換 96×160 長拖尾版自動跟隨(舊 96×128 也對)。
    // 目標寬 60px，高 = 60 × (原高/原寬)；拖尾越長高越大，一眼是天降火球。
    if (isReal) {
      const src = this.scene.textures.get(fallKey).getSourceImage() as { width: number; height: number };
      const ratio = src?.width && src?.height ? src.height / src.width : 128 / 96;
      const w = 72; // 六輪#8順帶：略放大(60→72)讓強化長拖尾在遊戲一眼看得到(96×160 版拖尾佔 70% 高)。
      spr.setDisplaySize(w, w * ratio);
    } else {
      spr.setDisplaySize(54, 72).setTint(0xff5522); // 佔位染火焰紅
    }
    spr.setAlpha(1);
    // 墜落：y 從高到落點，加速下墜（Quad.easeIn 越落越快）。
    this.scene.tweens.add({
      targets: spr,
      y,
      duration: Math.max(80, fallMs),
      ease: 'Quad.easeIn',
      onComplete: () => {
        spr.destroy();
        if (onLand) onLand();
      },
    });
    // 真火球：輕微左右抖動 angle（±6°）增墜落動感（拖尾方向大致朝上不亂轉）。
    if (isReal) {
      spr.setAngle(-6);
      this.scene.tweens.add({
        targets: spr,
        angle: 6,
        duration: 140,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }
    return spr;
  }

  // ---- hitFeel 打擊手感（搬自 Unity EnemyConfig，純視覺疊在 Enemy.takeHit/die） ----

  /**
   * 受擊白閃：sprite 瞬間染色（tint）→ hitFlashDuration 後清除。
   * @param sprite 被打的角色 sprite（Enemy 的 anim.sprite）。
   */
  hitFlash(
    sprite: Phaser.GameObjects.Sprite,
    color: number,
    durationSec: number,
  ): void {
    if (!sprite || !sprite.active) return;
    sprite.setTintFill(color); // 全白剪影閃（比 setTint 更明顯的「白閃」）
    this.scene.time.delayedCall(durationSec * 1000, () => {
      if (sprite && sprite.active) sprite.clearTint();
    });
  }

  /**
   * punch 彈跳：受擊瞬間 scale 彈一下（快彈快回），以 sprite 現有 scale 為基準。
   * @param amount 彈跳量（Unity punchScale 0.35 → 放大到 base×1.35 再回彈）。
   */
  punchScale(sprite: Phaser.GameObjects.Sprite, amount: number): void {
    if (!sprite || !sprite.active) return;
    const baseX = sprite.scaleX;
    const baseY = sprite.scaleY;
    // 先歸位再彈（避免連打疊加爆縮放）。
    sprite.setScale(baseX, baseY);
    this.scene.tweens.add({
      targets: sprite,
      scaleX: baseX * (1 + amount),
      scaleY: baseY * (1 + amount),
      duration: 60,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (sprite && sprite.active) sprite.setScale(baseX, baseY);
      },
    });
  }

  /**
   * 命中火花：從命中點朝「遠離攻擊來源」方向噴數點小火花（白黃），快速外飛淡出。
   * @param x,y 命中點（被打者位置）。
   * @param dirX,dirY 噴發方向（遠離攻擊源，未正規化亦可）。
   */
  hitSpark(x: number, y: number, dirX: number, dirY: number, color: number): void {
    const len = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / len;
    const ny = dirY / len;
    const count = 5;
    for (let i = 0; i < count; i += 1) {
      const spread = (i - (count - 1) / 2) * 0.4; // 扇形散開
      const ax = nx * Math.cos(spread) - ny * Math.sin(spread);
      const ay = nx * Math.sin(spread) + ny * Math.cos(spread);
      const g = this.scene.add.graphics();
      g.fillStyle(color, 1);
      g.fillCircle(0, 0, Phaser.Math.Between(3, 5));
      g.x = x;
      g.y = y;
      g.setDepth(ENERGY_FLY_DEPTH);
      const dist = Phaser.Math.Between(28, 52);
      this.scene.tweens.add({
        targets: g,
        x: x + ax * dist,
        y: y + ay * dist,
        alpha: 0,
        scale: 0.3,
        duration: Phaser.Math.Between(160, 240),
        ease: 'Cubic.easeOut',
        onComplete: () => g.destroy(),
      });
    }
  }

  /**
   * 敵人揮擊斬光（用戶 #7）：近戰出手當下播。快速放大 + 尾段淡出，rotation 對準攻擊方向。
   * 純視覺疊加（結算後 hook，不改數值）。
   * @param x,y 生成位置（敵人與玩家之間、偏敵人手前，世界座標）。
   * @param angleRad 攻擊朝向弧度（敵人朝玩家 aim 的 atan2）；圖預設開口朝左彎月，直接用此角度轉。
   * @param scale 依敵人體型微調（0.8~1.2，預設 1）。
   */
  enemySlash(x: number, y: number, angleRad: number, scale = 1): void {
    if (!this.scene.textures.exists(ENEMY_ATTACK_VFX.slash.key)) return;
    const spr = this.scene.add.image(x, y, ENEMY_ATTACK_VFX.slash.key);
    spr.setOrigin(0.5, 0.5).setDepth(ATTACK_VFX_DEPTH).setRotation(angleRad);
    spr.setScale(0.7 * scale).setAlpha(1);
    // ~0.18s：scale 0.7→1.15 快速放大（速度感）；後段 alpha→0 淡出。
    this.scene.tweens.add({
      targets: spr,
      scale: 1.15 * scale,
      duration: 180,
      ease: 'Cubic.easeOut',
    });
    this.scene.tweens.add({
      targets: spr,
      alpha: 0,
      delay: 108, // 後 40% 才淡出（180×0.6）
      duration: 72,
      ease: 'Sine.easeIn',
      onComplete: () => spr.destroy(),
    });
  }

  /**
   * 七輪：衝鋒兵扇形揮砍（fx_enemy_fan，128×128，頂點在左緣、往右張 76°）。
   * origin(0,0.5)＝頂點在左中＝以敵人出手點為樞紐；setRotation(angleRad) 讓扇形往攻擊方向張開。
   * scale 依攻擊範圍（呼應「特效隨範圍」）；0.8→1.1 快速張開、時長 0.2s、後 40% 淡出。純視覺。
   * @param x,y 出手點（敵人手前/body 中心，世界座標）＝扇形頂點。
   * @param angleRad 攻擊方向（敵人→玩家），扇形往此方向張。
   * @param scale 依攻擊範圍縮放（呼叫端 = attackRange 相關）。
   */
  enemyFan(x: number, y: number, angleRad: number, scale = 1): void {
    if (!this.scene.textures.exists(ENEMY_ATTACK_VFX.fan.key)) return;
    const spr = this.scene.add.image(x, y, ENEMY_ATTACK_VFX.fan.key);
    // 頂點在圖左緣中央 → origin(0,0.5) 讓頂點=出手點，rotate 繞頂點張向攻擊方向。
    spr.setOrigin(0, 0.5).setDepth(ATTACK_VFX_DEPTH).setRotation(angleRad);
    spr.setScale(0.8 * scale).setAlpha(1);
    // ~0.2s：scale 0.8→1.1 快速張開（揮砍展開感）。
    this.scene.tweens.add({
      targets: spr,
      scale: 1.1 * scale,
      duration: 200,
      ease: 'Cubic.easeOut',
    });
    // 後 40% 淡出（200×0.6=120 後淡出 80ms）。
    this.scene.tweens.add({
      targets: spr,
      alpha: 0,
      delay: 120,
      duration: 80,
      ease: 'Sine.easeIn',
      onComplete: () => spr.destroy(),
    });
  }

  /**
   * 十一輪#3：玩家衝刺前方防護罩（fx_player_dash_shield 128×128，朝右凸弧形力場罩）。
   * 改為 handle 式：起手 spawn 一個持續 sprite（不自動銷毀），衝刺期間每幀 updatePlayerDashShield 跟本體+朝向，
   * 衝刺結束 endPlayerDashShield 淡出銷毀。修好舊 bug（一次性、停起始點、220ms 早淡）：現在跟角色本體移動、
   * 持續整個衝刺、更明顯（alpha 1.0 飽和、基礎 scale 1.25、輕微脈動）。
   * @param x,y 玩家位置（世界座標）。
   * @param angleRad 衝刺方向（罩朝此方向凸出）。
   * @param color 玩家識別色（setTint 染色）；省略=不染。
   * @returns 特效 handle（傳回給 update/end）；素材未載入回 null。
   */
  playerDash(x: number, y: number, angleRad: number, color?: number): Phaser.GameObjects.Image | null {
    const shieldKey = ENEMY_ATTACK_VFX.playerDashShield.key;
    if (!this.scene.textures.exists(shieldKey)) return null;
    const { sx, sy } = this.dashShieldPos(x, y, angleRad);
    const spr = this.scene.add.image(sx, sy, shieldKey);
    // origin(0.5,0.5) 罩中心；素材弧朝右(0 度)→ rotate angleRad 對齊衝刺方向。
    spr.setOrigin(0.5, 0.5).setDepth(ATTACK_VFX_DEPTH).setRotation(angleRad);
    if (color !== undefined) spr.setTint(color); // 染玩家識別色（飽和）
    // 加明顯：基礎 scale 1.25、alpha 快淡入到 1.0（實）；輕微脈動 1.25↔1.35 循環（衝刺期間持續，非 220ms 就淡）。
    spr.setScale(1.25).setAlpha(0);
    this.scene.tweens.add({ targets: spr, alpha: 1.0, duration: 50, ease: 'Quad.easeOut' });
    this.scene.tweens.add({
      targets: spr,
      scale: 1.35,
      duration: 160,
      yoyo: true,
      repeat: -1, // 衝刺期間持續脈動；endPlayerDashShield 會停 tween + 淡出銷毀。
      ease: 'Sine.easeInOut',
    });
    return spr;
  }

  /** 罩貼角色前方偏移點（沿衝刺方向偏移半身位）。 */
  private dashShieldPos(x: number, y: number, angleRad: number): { sx: number; sy: number } {
    const FORWARD_OFFSET_PX = 34;
    return { sx: x + Math.cos(angleRad) * FORWARD_OFFSET_PX, sy: y + Math.sin(angleRad) * FORWARD_OFFSET_PX };
  }

  /** 十一輪#3：衝刺期間每幀更新防護罩跟本體+朝向（PlayerControlSystem updateDash 呼叫）。handle=null 忽略。 */
  updatePlayerDashShield(handle: Phaser.GameObjects.Image | null, x: number, y: number, angleRad: number): void {
    if (!handle || !handle.active) return;
    const { sx, sy } = this.dashShieldPos(x, y, angleRad);
    handle.setPosition(sx, sy).setRotation(angleRad);
  }

  /** 十一輪#3：衝刺結束淡出銷毀防護罩（停脈動 tween→短淡出）。handle=null 忽略。 */
  endPlayerDashShield(handle: Phaser.GameObjects.Image | null): void {
    if (!handle) return;
    this.scene.tweens.killTweensOf(handle);
    if (!handle.active) { handle.destroy(); return; }
    this.scene.tweens.add({
      targets: handle,
      alpha: 0,
      scale: 1.5,
      duration: 140,
      ease: 'Quad.easeOut',
      onComplete: () => handle.destroy(),
    });
  }

  /**
   * 敵人命中爆閃（用戶 #7）：攻擊命中玩家瞬間播。隨機旋轉、爆開放大、淡出。
   * 純視覺疊加（受擊結算後 hook）。
   * @param x,y 玩家受擊點/身體中心（世界座標）。
   * @param scale 微調（0.9~1.3，預設 1.1）。
   */
  enemyImpact(x: number, y: number, scale = 1.1): void {
    if (!this.scene.textures.exists(ENEMY_ATTACK_VFX.impact.key)) return;
    const spr = this.scene.add.image(x, y, ENEMY_ATTACK_VFX.impact.key);
    spr.setOrigin(0.5, 0.5).setDepth(ATTACK_VFX_DEPTH + 1); // 命中閃在斬光之上
    spr.setRotation(Phaser.Math.FloatBetween(0, Math.PI * 2)); // 隨機旋轉，不需對方向
    spr.setScale(0.6 * scale).setAlpha(1);
    // ~0.15s：scale 0.6→1.2 爆開 + alpha 1→0 淡出。
    this.scene.tweens.add({
      targets: spr,
      scale: 1.2 * scale,
      alpha: 0,
      duration: 150,
      ease: 'Quad.easeOut',
      onComplete: () => spr.destroy(),
    });
  }

  /**
   * 敵人集氣（用戶 #4 升級版 charge2）：中心聚能核 + 5 道環繞氣流臂，**靠持續 rotation 呈現漩渦/環繞感**。
   * 出手前蓄力期播；出手時呼叫回傳物件的 destroy 收掉（接 slash/burst）。純視覺疊加。
   * @param x,y 生成位置（貼敵人身上/腳下，世界座標）。
   * @param durationMs 蓄力時長（對應 chargeTime；預設 500）。
   * @returns 集氣特效 sprite（呼叫端出手時 .destroy()）；貼圖沒載則回 null。
   */
  /**
   * 敵人集氣（用戶 #4 charge2 + 三輪#3 改腳底貼地圓盤）：charge2 螺旋氣流盤，
   * **平貼地面、放角色腳底、壓扁成俯視橢圓圓盤（像地面充能法陣）**，靠持續 rotation 呈現盤旋氣流。
   * 出手前蓄力期播；出手時呼叫回傳物件的 destroy 收掉（接 slash/burst）。純視覺疊加。
   * @param x 腳底 x（世界座標）。
   * @param y 腳底 y（世界座標，呼叫端已加腳底 offset）。
   * @param durationMs 蓄力時長（對應 chargeTime；預設 500）。
   * @param diskPx 圓盤直徑（px，預設 96）；壓扁後高=此×0.5 呈俯視透視。
   * @returns 集氣特效 sprite（呼叫端出手時 .destroy()）；貼圖沒載則回 null。
   */
  enemyCharge(
    x: number,
    y: number,
    durationMs = 500,
    diskPx = 96,
  ): Phaser.GameObjects.Image | null {
    // 三輪#2/#3：用專屬俯視腳底法陣盤(chargeDisk)；沒載才退回 charge2(正視漩渦)。不再退回最舊 charge。
    const key = this.scene.textures.exists(ENEMY_ATTACK_VFX.chargeDisk.key)
      ? ENEMY_ATTACK_VFX.chargeDisk.key
      : ENEMY_ATTACK_VFX.charge2.key;
    if (!this.scene.textures.exists(key)) return null;
    const spr = this.scene.add.image(x, y, key);
    // 三輪#3：貼地圓盤 → depth 壓在角色之下（角色 PLAY_DEPTH=10）、壓扁成俯視橢圓。
    spr.setOrigin(0.5, 0.5).setDepth(-4);
    // 四輪#2：加 ADD 疊加混合 → 紅金法陣在暗色地面更亮更醒目（原本太暗、subagent 看圖偏暗褐 smudge）。
    spr.setBlendMode(Phaser.BlendModes.ADD);
    const w = diskPx;
    const h = diskPx * 0.5; // 俯視透視壓扁（高=寬一半）呈貼地圓盤感
    spr.setDisplaySize(w * 0.6, h * 0.6).setAlpha(0); // 從小漸大
    // 能量匯聚：圓盤 0.6→1.0 漸大 + alpha 0→1 漸亮（整個蓄力期）。
    this.scene.tweens.add({
      targets: spr,
      displayWidth: w,
      displayHeight: h,
      alpha: 1,
      duration: Math.max(200, durationMs),
      ease: 'Sine.easeOut',
    });
    // 五輪#2#3：不再 setAngle 旋轉整個 sprite——壓扁橢圓一轉長軸就變斜、看起來「斜面」非水平躺地(subagent 確認)。
    // 貼地俯視盤保持長軸水平躺地; 改用「輕微 alpha 呼吸脈動」表現集氣能量感(取代旋轉、不破壞水平)。
    this.scene.tweens.add({
      targets: spr,
      alpha: { from: 1, to: 0.6 },
      duration: 320,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
      delay: Math.max(200, durationMs), // 匯聚亮到滿後才開始呼吸
    });
    return spr;
  }

  /**
   * 圓形範圍攻擊預告圈（用戶 #3）：平貼地面、以敵人為圓心、依 AOE 半徑 scale，蓄力期持續 + 緩慢自轉。
   * 回傳 sprite 供出手時 destroy（接 aoeBurst）。純視覺。
   * @param x,y 圓心（敵人攻擊圓心，世界座標）。
   * @param radiusPx AOE 半徑（px，預告圈直徑=2×此）。
   * @returns 預告圈 sprite；貼圖沒載則回 null。
   */
  enemyAoeRing(x: number, y: number, radiusPx: number): Phaser.GameObjects.Image | null {
    if (!this.scene.textures.exists(ENEMY_ATTACK_VFX.aoeRing.key)) return null;
    const spr = this.scene.add.image(x, y, ENEMY_ATTACK_VFX.aoeRing.key);
    spr.setOrigin(0.5, 0.5).setDepth(-4); // 平貼地面（角色之下，PLAY_DEPTH=10）
    spr.setDisplaySize(radiusPx * 2, radiusPx * 2).setAlpha(0);
    // 淡入 + 緩慢自轉（警示感）。
    this.scene.tweens.add({ targets: spr, alpha: 0.85, duration: 250, ease: 'Sine.easeOut' });
    this.scene.tweens.add({ targets: spr, angle: 360, duration: 4000, repeat: -1, ease: 'Linear' });
    return spr;
  }

  /**
   * 圓形範圍攻擊爆發（用戶 #3 → 四輪#3#4：壓到貼地層不蓋角色）：命中/出手瞬間播。同圓心、爆開放大、隨機旋轉、後半淡出。
   * depth 壓到角色之下(貼地)＝地面爆發、不遮擋角色/怪主體（原 ATTACK_VFX_DEPTH+1=951 蓋在角色上）。
   * @param x,y 圓心（世界座標）。
   * @param radiusPx AOE 半徑（爆發覆蓋 ≈ 此）。
   */
  enemyAoeBurst(x: number, y: number, radiusPx: number): void {
    if (!this.scene.textures.exists(ENEMY_ATTACK_VFX.aoeBurst.key)) return;
    const spr = this.scene.add.image(x, y, ENEMY_ATTACK_VFX.aoeBurst.key);
    // 六輪#4(用戶定調以警戒圈為準)：aoeBurst 改成跟 aoeRing「完全同套擺放」→ 預警圈=爆發圈完全重合(所見即所得)。
    // aoeRing 擺法：origin(0.5)、depth-4 貼地、setDisplaySize(radiusPx*2, radiusPx*2) 1:1 正圓、無壓扁無 rotation。
    // aoeBurst 對齊：同圓心(x,y=傳入 buildAttackCircle center)、同 1:1 尺寸、貼地；depth-3(在 ring -4 之上、角色 PLAY_DEPTH10 之下)當地面爆發不蓋角色。
    spr.setOrigin(0.5, 0.5).setDepth(-3);
    spr.setBlendMode(Phaser.BlendModes.ADD); // 貼地在暗地面更亮醒目
    const full = radiusPx * 2; // 與 aoeRing 同直徑(1:1 正圓、無壓扁)
    spr.setDisplaySize(full, full).setAlpha(1);
    // ~0.2s：scale 從滿圈微爆開 + 後半淡出（維持 1:1 正圓、與 aoeRing 同形）。
    this.scene.tweens.add({
      targets: spr,
      displayWidth: full * 1.15,
      displayHeight: full * 1.15, // 1:1 同步放大，保持正圓與 aoeRing 重合
      duration: 200,
      ease: 'Cubic.easeOut',
    });
    this.scene.tweens.add({
      targets: spr,
      alpha: 0,
      delay: 100,
      duration: 100,
      ease: 'Sine.easeIn',
      onComplete: () => spr.destroy(),
    });
  }

  /**
   * 死亡粒子：死亡點金黃粒子向四周爆散淡出。
   * @param x,y 死亡位置。
   */
  deathParticle(x: number, y: number, color: number): void {
    const count = 10;
    for (let i = 0; i < count; i += 1) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const g = this.scene.add.graphics();
      g.fillStyle(color, 1);
      g.fillCircle(0, 0, Phaser.Math.Between(4, 7));
      g.x = x;
      g.y = y;
      g.setDepth(ENERGY_FLY_DEPTH);
      const dist = Phaser.Math.Between(40, 80);
      this.scene.tweens.add({
        targets: g,
        x: x + Math.cos(a) * dist,
        y: y + Math.sin(a) * dist,
        alpha: 0,
        scale: 0.2,
        duration: Phaser.Math.Between(300, 480),
        ease: 'Cubic.easeOut',
        onComplete: () => g.destroy(),
      });
    }
  }

  /**
   * 火雨宣告字（對應 Unity FireRainTextUI）：大字「天降火雨！」
   * 左外滑進中央(0.4s) → 停留 3s → 右滑出畫面(0.4s) → onDone（火雨才開始）。
   * 深度最上層（蓋遊戲但在最上）；置中略偏上（y+60）。純視覺。
   * @param onDone 右滑出完成後回呼（FireRainSystem 用來延遲第一道火雨）。
   */
  fireRainAnnounce(onDone?: () => void): void {
    // 用戶 #8：讀 layout.screen.fireRainMessage 定位；無則 fallback 內建(GAME_HEIGHT/2-60 滿寬置中、高 92)。
    const el = this.screenElement('fireRainMessage', {
      x: 0,
      y: GAME_HEIGHT / 2 - 60 - 46,
      width: GAME_WIDTH,
      height: 92,
      align: 'center',
    });
    // 用戶 #6：勾掉 fireRainMessage → 不顯宣告字，但仍要呼 onDone（否則火雨被卡住不降）。
    if (!isVisible(el)) {
      onDone?.();
      return;
    }
    const cy = el.y + el.height / 2; // 元素中心 Y
    const align = el.align ?? 'center';
    const cx = align === 'left' ? el.x : align === 'right' ? el.x + el.width : el.x + el.width / 2;
    const originX = align === 'left' ? 0 : align === 'right' ? 1 : 0.5;
    const txt = this.scene.add.text(cx, cy, '天降火雨！', {
      fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
      fontSize: '96px',
      color: '#ffdd44',
      fontStyle: 'bold',
      stroke: '#7a1500',
      strokeThickness: 10,
    });
    txt.setOrigin(originX, 0.5).setScrollFactor(0).setDepth(ENERGY_FLY_DEPTH + 20);
    const startX = cx - GAME_WIDTH; // 左外
    const endX = cx + GAME_WIDTH; // 右外
    txt.x = startX;
    const slideMs = 400; // Unity SlideDuration 0.4s
    const holdMs = 3000; // 停留 3s
    // 左滑進定位。
    this.scene.tweens.add({
      targets: txt,
      x: cx,
      duration: slideMs,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        // 停留後右滑出 → 銷毀 → onDone（火雨才開始）。
        this.scene.tweens.add({
          targets: txt,
          x: endX,
          delay: holdMs,
          duration: slideMs,
          ease: 'Cubic.easeIn',
          onComplete: () => {
            txt.destroy();
            onDone?.();
          },
        });
      },
    });
  }

  /**
   * 一般波敵人登場召喚法陣（#3，取代 #1 純紅圈；對應 Unity SpawnEnemyWithWarning warningSprite）：
   * 生成點放 summon-circle 法陣圖，alpha 0→1 淡入（durationSec）+ 緩慢旋轉（召喚儀式感），
   * depth 低（在地上、怪之下）→ 淡入完短暫脈動一下 → onDone（怪原地出現）。
   * 未載到法陣圖時 graceful 退回畫紅圈。
   * @param onDone 淡入完成回呼（WaveSystem 用來在該點生成敵人）。
   * @returns 可取消 handle：cancel() 立即清召喚陣視覺（停 tween/destroy GameObject），且不觸發 onDone（N skip/換節點清視覺用）。
   */
  spawnWarning(x: number, y: number, durationSec: number, onDone?: () => void): { cancel: () => void } {
    const diameterPx = 150; // 法陣直徑（略大於怪、不蓋整場）
    let obj: Phaser.GameObjects.GameObject | null = null; // 召喚陣視覺 GameObject（sprite 或 graphics）
    let done = false; // 已完成/已取消 → 去重（cancel 不重複、完成後 cancel no-op）
    const cleanup = (): void => {
      if (obj) {
        this.scene.tweens.killTweensOf(obj); // 停召喚陣所有 tween（淡入/脈動）
        obj.destroy();
        obj = null;
      }
    };
    const handle = {
      cancel: (): void => {
        if (done) return;
        done = true;
        cleanup(); // 立即清視覺，不觸發 onDone（不生怪）
      },
    };
    if (this.scene.textures.exists(UI_ICONS.summonCircle.key)) {
      const sprite = this.scene.add.image(x, y, UI_ICONS.summonCircle.key);
      obj = sprite;
      sprite.setDisplaySize(diameterPx, diameterPx);
      sprite.setDepth(-6); // 在地上、角色（PLAY_DEPTH=10）之下
      sprite.setAlpha(0);
      sprite.setAngle(0);
      // 淡入 + 緩慢旋轉（召喚感）。
      this.scene.tweens.add({
        targets: sprite,
        alpha: 1,
        angle: 90, // 淡入期間轉 90°
        duration: durationSec * 1000,
        ease: 'Sine.easeIn',
        onComplete: () => {
          if (done) return; // 已取消 → 不續播不生怪
          // 淡入完短暫放大脈動一下 → 銷毀 → 出怪。
          this.scene.tweens.add({
            targets: sprite,
            scaleX: sprite.scaleX * 1.18,
            scaleY: sprite.scaleY * 1.18,
            alpha: 0,
            duration: 180,
            ease: 'Quad.easeOut',
            onComplete: () => {
              if (done) return;
              done = true;
              cleanup();
              onDone?.();
            },
          });
        },
      });
      return handle;
    }
    // graceful 後備：沒法陣圖 → 畫紅圈淡入。
    const g = this.scene.add.graphics();
    obj = g;
    g.fillStyle(0xff3322, 0.35);
    g.fillCircle(0, 0, diameterPx / 2);
    g.lineStyle(3, 0xff6644, 0.9);
    g.strokeCircle(0, 0, diameterPx / 2);
    g.x = x;
    g.y = y;
    g.setDepth(-6);
    g.setAlpha(0);
    this.scene.tweens.add({
      targets: g,
      alpha: 1,
      duration: durationSec * 1000,
      ease: 'Linear',
      onComplete: () => {
        if (done) return;
        done = true;
        cleanup();
        onDone?.();
      },
    });
    return handle;
  }
}
