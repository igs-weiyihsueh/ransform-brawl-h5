import Phaser from 'phaser';
import { VFX_EFFECTS, VFX_FRAME_PAD, type VFXEffectDef } from '@/config/vfxConfig';
import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import { UI_ICONS, UI_LAYOUT_ASSET, PANEL_DEPTH } from '@/config/uiConfig';
import { validateUiLayout, isVisible, type ScreenElement } from '@/config/uiLayoutSchema';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';
import { WAVE_MESSAGE_FX } from '@/systems/waveMessage';
import { MINE_BODY_RADIUS_PX } from '@/systems/mineTrapMath';
import { ENERGY_FLY, flyAlpha, flyPosition, flyScale } from '@/systems/energyFlyMath';
import {
  CHEST_REWARD_FX,
  chestRewardIsTicket,
  chestRewardLabel,
} from '@/systems/chestRewardDisplay';
import {
  COMBO_REWARD_FX,
  COMBO_TICKET_BURST,
  comboRewardFontSize,
  comboRewardLabel,
  sparkleBurstCount,
  ticketBurstCount,
} from '@/systems/comboRewardDisplay';
import { getResolvedComboReward } from '@/config/comboRewardSchema';
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
  /** COMBO 報獎彩票噴發：金黃彩票券（128×128，往上扇形噴出+重力回落+自轉）。 */
  comboTicket: { key: 'vfx-combo-ticket', path: `${BASE_PATH}/fx_combo_ticket.png` },
  /** COMBO 報獎閃光點綴：暖金四芒星（64×64，短命在票群間隨機閃）。 */
  comboSparkle: { key: 'vfx-combo-sparkle', path: `${BASE_PATH}/fx_combo_sparkle.png` },
  /** 二段變身瞬間金光爆發（512×512，進二段那刻在角色位置播一次，scale 爆開後淡出）。 */
  secondTransformBurst: { key: 'vfx-second-transform-burst', path: `${BASE_PATH}/fx_second_transform_burst.png` },
  /** 二段變身持續強化光環（512×512 中空透明中心，二段期間包住放大角色，自轉+呼吸脈動）。 */
  secondTransformAura: { key: 'vfx-second-transform-aura', path: `${BASE_PATH}/fx_second_transform_aura.png` },
  /** 二段變身能量條滿格閃（256×64，給界騎能量條 UI）。 */
  secondTransformBarFull: { key: 'vfx-second-transform-barfull', path: `${BASE_PATH}/fx_second_transform_barfull.png` },
  /** ③投幣變身表演-浮起光（128×192，浮起階段貼角色身上，alpha 0→1 漸亮+scale 微升，持續 ~0.6~1.0s）。 */
  riseGlow: { key: 'vfx-rise-glow', path: `${BASE_PATH}/fx_rise_glow.png` },
  /** ③投幣變身表演-發光變身閃（384×384，變身瞬間中心對齊角色，scale 0.4→1.3 爆開後淡出，播一次 ~0.3s）。 */
  transformFlash: { key: 'vfx-transform-flash', path: `${BASE_PATH}/fx_transform_flash.png` },
  /** ③投幣變身表演-降臨落地衝擊（256×256，落點對齊地面，scale 0.7→1.1，先落→爆光→塵環淡出，~0.3s）。 */
  descendImpact: { key: 'vfx-descend-impact', path: `${BASE_PATH}/fx_descend_impact.png` },
  /** ③投幣變身表演-落地震退波（256×256，貼地壓扁橢圓，scale 0.3→1.6 擴散+alpha 1→0，~0.4s）。 */
  shockwaveRing: { key: 'vfx-shockwave-ring', path: `${BASE_PATH}/fx_shockwave_ring.png` },
  /** 2 新事件-地雷預警圈（256×256，地雷鋪下後 delaySec 內持續脈動顯示範圍，給玩家反應）。 */
  mineWarning: { key: 'vfx-mine-warning', path: `${BASE_PATH}/fx_mine_warning.png` },
  /** 2 新事件-地雷爆炸（256×256，延遲到→範圍爆炸播一次，scale 依 radiusPx）。 */
  mineExplosion: { key: 'vfx-mine-explosion', path: `${BASE_PATH}/fx_mine_explosion.png` },
  /** 魔尖塔環狀擴散技（2 新事件階段 B）：單張環 sprite，程式 scale 小→大 + alpha 淡出做漣漪/衝擊波擴散。 */
  towerRing: { key: 'vfx-tower-ring', path: `${BASE_PATH}/fx_tower_ring.png` },
  /** ★魔尖塔環狀「預警」專屬貼圖（512×512，紅危險中空環帶+符文+俯視壓扁 Y0.5 已內建）。 */
  towerRingWarning: { key: 'vfx-tower-ring-warning', path: `${BASE_PATH}/fx_tower_ring_warning.png` },
  /** ★魔尖塔環狀「攻擊」專屬貼圖（512×512，紫魔能衝擊環+白刃芯+bloom+能量刺+符文+俯視壓扁 Y0.5 已內建）。 */
  towerRingAttack: { key: 'vfx-tower-ring-attack', path: `${BASE_PATH}/fx_tower_ring_attack.png` },
  /** 魔尖塔尖塔怪靜態立繪（2 新事件；Enemy_Tower characterKey 換皮用，非 VFX 但同單張 PNG 載法）。 */
  towerSpire: { key: 'fx_tower_spire', path: `${BASE_PATH}/fx_tower_spire.png` },
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

    // 彩票噴發演出（用戶要：連段結算給彩票時彩票往上扇形噴出+重力回落+自轉+閃光）。
    // 保留下方既有報獎文字/彈跳/滿檔光環不動，疊加此演出。
    this.ticketBurst(x, topY, count, isMax);

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
      duration: getResolvedComboReward().rewardDurationSec * 1000,
      ease: 'Sine.easeOut',
      onComplete: () => txt.destroy(),
    });
  }

  /**
   * COMBO 報獎彩票噴發（用戶要，純視覺）：從結算點上方扇形噴出彩票券
   *  → 隨機初速 + 重力回落（噴上→散開→飄落）+ 隨機自轉 + 隨機 scale，尾段淡出銷毀；
   *  票群間隨機閃暖金四芒星（短命）。數量依 combo 段數（段數越高越多），滿檔加成。
   * 無素材（未載到）→ graceful 略過（不炸、不佔位方塊）。
   */
  private ticketBurst(x: number, y: number, count: number, isMax: boolean): void {
    const c = COMBO_TICKET_BURST;
    const ticketKey = ENEMY_ATTACK_VFX.comboTicket.key;
    const sparkleKey = ENEMY_ATTACK_VFX.comboSparkle.key;
    const hasTicket = this.scene.textures.exists(ticketKey);
    const hasSparkle = this.scene.textures.exists(sparkleKey);
    if (!hasTicket && !hasSparkle) return; // 無素材：略過（其餘報獎文字仍照演）
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const spawnY = y - c.spawnRiseYPx;
    const deg2rad = Math.PI / 180;

    // 彩票券：扇形噴出 + 重力回落 + 自轉。
    if (hasTicket) {
      const cr = getResolvedComboReward();
      const n = ticketBurstCount(count, isMax, cr.burstMinTickets, cr.burstMaxTickets, cr.burstCountForMax);
      for (let i = 0; i < n; i++) {
        const sx = x + rnd(-c.spawnSpreadX, c.spawnSpreadX);
        const spr = this.scene.add.image(sx, spawnY, ticketKey);
        spr.setDepth(ENERGY_FLY_DEPTH + 2);
        spr.setScale(rnd(c.ticketScaleMin, c.ticketScaleMax));
        const ang = rnd(c.angleMinDeg, c.angleMaxDeg) * deg2rad;
        const speed = rnd(c.speedMin, c.speedMax);
        let vx = Math.cos(ang) * speed;
        let vy = Math.sin(ang) * speed; // 角度偏上 → vy 為負（往上）
        const spin = rnd(-c.spinDegPerSecMax, c.spinDegPerSecMax);
        const total = rnd(c.fallSecMin, c.fallSecMax) + c.burstSec;
        const fadeStart = total * (1 - c.fadeTailRatio);
        let t = 0;
        // 手動積分（速度+重力）：用 addCounter 當每幀 tick，delta 秒推進位置/旋轉/尾段淡出。
        const tw = this.scene.tweens.addCounter({
          from: 0,
          to: 1,
          duration: total * 1000,
          onUpdate: (tween) => {
            const dt = ((tween.getValue() ?? 0) * total) - t;
            t += dt;
            vy += c.gravity * dt;
            spr.x += vx * dt;
            spr.y += vy * dt;
            spr.angle += spin * dt;
            if (t > fadeStart) {
              const k = Math.min(1, (t - fadeStart) / (total - fadeStart));
              spr.setAlpha(1 - k);
            }
          },
          onComplete: () => spr.destroy(),
        });
        void tw;
      }
    }

    // 閃光點綴：票群間隨機位置短命閃現（縮放脈衝 + 淡出）。
    if (hasSparkle) {
      const sn = sparkleBurstCount(count, isMax);
      for (let i = 0; i < sn; i++) {
        const px = x + rnd(-c.spawnSpreadX * 1.4, c.spawnSpreadX * 1.4);
        const py = spawnY + rnd(-40, 60);
        const delay = rnd(0, c.fallSecMin) * 1000;
        const life = rnd(c.sparkleSecMin, c.sparkleSecMax) * 1000;
        const sp = this.scene.add.image(px, py, sparkleKey);
        sp.setDepth(ENERGY_FLY_DEPTH + 3);
        sp.setScale(0.2).setAlpha(0);
        this.scene.tweens.add({
          targets: sp,
          delay,
          scale: rnd(0.6, 1.0),
          alpha: { from: 1, to: 0 },
          duration: life,
          ease: 'Quad.easeOut',
          onComplete: () => sp.destroy(),
        });
      }
    }
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
  /**
   * ★B4 魔尖塔波登場壓黑（比照守護波聚焦壓暗，但塔波多座、用全螢幕短暫壓黑烘托「塔登場」）：
   * 全螢幕壓黑淡入 → hold → 淡出自動清（純視覺，不 gate 遊戲；訊息時序由波騎 towerGate 擋好）。
   * 塔本身發亮由 Enemy.playTowerAppear 各自跑。
   * @param holdMs 壓黑持續（含淡入淡出外的停留），預設 ~600ms。
   */
  towerIntro(holdMs = 600): void {
    const depth = ENERGY_FLY_DEPTH + 8; // 壓在場上角色/塔之下一點（塔仍可見、烘托登場）
    const dim = this.scene.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55)
      .setScrollFactor(0)
      .setDepth(depth)
      .setAlpha(0);
    const fadeMs = 250;
    this.scene.tweens.add({
      targets: dim, alpha: 1, duration: fadeMs, ease: 'Sine.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: dim, alpha: 0, delay: Math.max(0, holdMs), duration: fadeMs, ease: 'Sine.easeIn',
          onComplete: () => dim.destroy(),
        });
      },
    });
  }

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
    g.setScale(1, EffectSystem.GROUND_SQUASH_Y); // ★貼地壓扁圓盤（俯視橢圓，跟魔尖塔環一致）；判定在 FireRainSystem 維持正圓
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
      spr.setDisplaySize(radiusPx * 1.6, radiusPx * 1.6);
      const sq = EffectSystem.GROUND_SQUASH_Y; // ★貼地壓扁圓盤（跟魔尖塔環/火雨預警一致俯視橢圓）
      const baseX = spr.scaleX;
      const baseY = spr.scaleY * sq;
      spr.setScale(baseX, baseY).setAlpha(1);
      spr.setAngle(Math.random() * 360); // 隨機旋轉(每次爆發不同向)
      if (key === fallbackBurst) spr.setTint(0xff7722); // 佔位：白熱 burst 染火焰橘紅(真素材不染)
      this.scene.tweens.add({
        targets: spr,
        scaleX: baseX * 1.5,
        scaleY: baseY * 1.5, // 維持壓扁比例爆開
        alpha: 0,
        duration: 400,
        ease: 'Cubic.easeOut', // scale 炸開 + 後半淡出
        onComplete: () => spr.destroy(),
      });
      return;
    }
    // 後備：純 graphics 橘紅圓閃（貼地壓扁）。
    const g = this.scene.add.graphics();
    g.fillStyle(0xffaa22, 0.85);
    g.fillCircle(0, 0, radiusPx);
    g.x = x;
    g.y = y;
    g.setDepth(ENERGY_FLY_DEPTH);
    const sq = EffectSystem.GROUND_SQUASH_Y;
    g.setScale(0.5, 0.5 * sq); // ★貼地壓扁
    this.scene.tweens.add({
      targets: g,
      scaleX: 1.15,
      scaleY: 1.15 * sq, // 維持壓扁比例
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

  // === 二段變身特效（用戶新大功能；TransformSystem 讀 isSecondTransformActive 邊緣觸發呼叫） ===

  /**
   * 二段變身瞬間金光爆發（進二段那刻在角色位置播一次）。
   * scale 0.5→1.3 爆開，後段定住 + alpha 後 40% 淡出，時長 ~0.35s，中心對齊角色。
   */
  secondTransformBurst(x: number, y: number): void {
    const key = ENEMY_ATTACK_VFX.secondTransformBurst.key;
    if (!this.scene.textures.exists(key)) return;
    const img = this.scene.add.image(x, y, key).setOrigin(0.5, 0.5);
    img.setDepth(PANEL_DEPTH + 16); // 角色上層（同 mashHitParticle 帶，JP 橫幅之上可見）
    img.setBlendMode(Phaser.BlendModes.ADD); // 金光加亮
    const base = 512;
    img.setDisplaySize(base * 0.5, base * 0.5);
    img.setAlpha(1);
    // scale 0.5→1.3 爆開（總時長 ~0.35s）。
    this.scene.tweens.add({
      targets: img,
      displayWidth: base * 1.3,
      displayHeight: base * 1.3,
      duration: 350,
      ease: 'Quad.easeOut',
    });
    // 後 40%（~140ms）淡出：延遲 210ms 後 alpha→0。
    this.scene.tweens.add({
      targets: img,
      alpha: 0,
      delay: 210,
      duration: 140,
      ease: 'Quad.easeIn',
      onComplete: () => img.destroy(),
    });
  }

  /**
   * 二段變身持續強化光環起手（二段期間持續顯示；handle 式，二段結束呼叫 End 淡出）。
   * 疊角色後方（depth 略低於角色），中空透明中心露角色、包住放大 1.4 角色。
   * @returns handle（Image）或 null（素材未載）。
   */
  secondTransformAuraStart(x: number, y: number): Phaser.GameObjects.Image | null {
    const key = ENEMY_ATTACK_VFX.secondTransformAura.key;
    if (!this.scene.textures.exists(key)) return null;
    const img = this.scene.add.image(x, y, key).setOrigin(0.5, 0.5);
    img.setDepth(5); // 角色(10)後方、地面之上，包住角色
    img.setBlendMode(Phaser.BlendModes.ADD);
    const base = 512;
    img.setDisplaySize(base, base);
    img.setData('rot', 0);
    img.setAlpha(0);
    this.scene.tweens.add({ targets: img, alpha: 0.85, duration: 200, ease: 'Quad.easeOut' }); // 淡入
    return img;
  }

  /**
   * 每幀更新二段光環：跟角色位置 + 自轉 ~40°/s + scale 0.95↔1.05 呼吸脈動 + alpha 呼吸。
   * @param dt 幀秒。
   */
  secondTransformAuraUpdate(handle: Phaser.GameObjects.Image | null, x: number, y: number, dt: number): void {
    if (!handle || !handle.active) return;
    handle.x = x;
    handle.y = y;
    const rot = ((handle.getData('rot') as number) ?? 0) + ((40 * Math.PI) / 180) * dt;
    handle.setData('rot', rot);
    handle.setRotation(rot);
    const t = performance.now?.() ?? Date.now();
    const pulse = 1 + 0.05 * Math.sin(t / 300); // 0.95↔1.05 呼吸
    const base = 512;
    handle.setDisplaySize(base * pulse, base * pulse);
    handle.setAlpha(0.85 * (0.9 + 0.1 * Math.sin(t / 320))); // alpha 呼吸
  }

  /** 二段變身結束（退回一段）→ 光環淡出移除。 */
  secondTransformAuraEnd(handle: Phaser.GameObjects.Image | null): void {
    if (!handle) return;
    this.scene.tweens.killTweensOf(handle);
    if (!handle.active) { handle.destroy(); return; }
    this.scene.tweens.add({
      targets: handle,
      alpha: 0,
      duration: 250,
      ease: 'Quad.easeIn',
      onComplete: () => handle.destroy(),
    });
  }

  // === ③投幣變身進場表演 VFX（翼騎 b17af4b hook；特效素材 fx_rise/flash/descend/shockwave） ===

  /**
   * ③浮起光起手（浮起階段貼角色身上；handle 式，浮完/變身時呼叫 riseGlowEnd 收）。
   * alpha 0→1 漸亮 + scale 微升（~0.6~1.0s 起亮），跟隨角色由 riseGlowUpdate 更新位置。
   * @returns handle（Image）或 null（素材未載）。
   */
  riseGlowStart(x: number, y: number): Phaser.GameObjects.Image | null {
    const key = ENEMY_ATTACK_VFX.riseGlow.key;
    if (!this.scene.textures.exists(key)) return null;
    const img = this.scene.add.image(x, y, key).setOrigin(0.5, 0.5);
    img.setDepth(PANEL_DEPTH + 14); // 角色身上、略低於變身閃
    img.setBlendMode(Phaser.BlendModes.ADD);
    img.setAlpha(0).setScale(0.9);
    // 漸亮 + scale 微升（浮起起手感）。
    this.scene.tweens.add({ targets: img, alpha: 1, duration: 400, ease: 'Quad.easeOut' });
    this.scene.tweens.add({ targets: img, scale: 1.05, duration: 700, ease: 'Sine.easeOut' });
    return img;
  }

  /** ③浮起光跟隨角色位置（每幀由浮起流程呼叫）。 */
  riseGlowUpdate(handle: Phaser.GameObjects.Image | null, x: number, y: number): void {
    if (!handle || !handle.active) return;
    handle.setPosition(x, y);
  }

  /** ③浮起光收（浮完/變身時）→ 淡出移除。 */
  riseGlowEnd(handle: Phaser.GameObjects.Image | null): void {
    if (!handle) return;
    this.scene.tweens.killTweensOf(handle);
    if (!handle.active) { handle.destroy(); return; }
    this.scene.tweens.add({
      targets: handle,
      alpha: 0,
      duration: 160,
      ease: 'Quad.easeIn',
      onComplete: () => handle.destroy(),
    });
  }

  /**
   * ③發光變身瞬間閃（變身 hook 播一次；中心對齊角色）。
   * scale 0.4→1.3 爆開後定住 + 後 40% 淡出，~0.3s。
   */
  transformFlash(x: number, y: number): void {
    const key = ENEMY_ATTACK_VFX.transformFlash.key;
    if (!this.scene.textures.exists(key)) return;
    const img = this.scene.add.image(x, y, key).setOrigin(0.5, 0.5);
    img.setDepth(PANEL_DEPTH + 16); // 角色上層（同變身金光）
    img.setBlendMode(Phaser.BlendModes.ADD);
    const base = 384;
    img.setDisplaySize(base * 0.4, base * 0.4).setAlpha(1);
    // scale 0.4→1.3 爆開（~300ms）。
    this.scene.tweens.add({
      targets: img,
      displayWidth: base * 1.3,
      displayHeight: base * 1.3,
      duration: 300,
      ease: 'Quad.easeOut',
    });
    // 後 40%（~120ms）淡出。
    this.scene.tweens.add({
      targets: img,
      alpha: 0,
      delay: 180,
      duration: 120,
      ease: 'Quad.easeIn',
      onComplete: () => img.destroy(),
    });
  }

  /**
   * ③降臨落地衝擊（落地 hook 播一次；落點對齊地面）。
   * scale 0.7→1.1（先落→爆光→塵環淡出），~0.3s。
   */
  descendImpact(x: number, y: number): void {
    const key = ENEMY_ATTACK_VFX.descendImpact.key;
    if (!this.scene.textures.exists(key)) return;
    const img = this.scene.add.image(x, y, key).setOrigin(0.5, 0.7); // 錨略偏下＝貼落點地面
    img.setDepth(PANEL_DEPTH + 12); // 角色腳下/地面層
    img.setBlendMode(Phaser.BlendModes.ADD);
    const base = 256;
    img.setDisplaySize(base * 0.7, base * 0.7).setAlpha(1);
    this.scene.tweens.add({
      targets: img,
      displayWidth: base * 1.1,
      displayHeight: base * 1.1,
      duration: 300,
      ease: 'Quad.easeOut',
    });
    this.scene.tweens.add({
      targets: img,
      alpha: 0,
      delay: 150,
      duration: 150,
      ease: 'Quad.easeIn',
      onComplete: () => img.destroy(),
    });
  }

  /**
   * ③落地震退波（落地 hook 與 descendImpact 同時播；貼地壓扁橢圓）。
   * ★單張靠引擎放大表現擴散：scale 0.3→1.6 向外擴散 + alpha 1→0 淡出，~0.4s。
   */
  shockwaveRing(x: number, y: number): void {
    const key = ENEMY_ATTACK_VFX.shockwaveRing.key;
    if (!this.scene.textures.exists(key)) return;
    const img = this.scene.add.image(x, y, key).setOrigin(0.5, 0.5);
    img.setDepth(PANEL_DEPTH + 11); // 地面層、略低於落地衝擊
    img.setBlendMode(Phaser.BlendModes.ADD);
    const base = 256;
    // 貼地：y 方向壓扁成橢圓（0.5×），模擬地面透視波紋。
    img.setDisplaySize(base * 0.3, base * 0.3 * 0.5).setAlpha(1);
    // scale 0.3→1.6 向外擴散（放大＝擴散）。
    this.scene.tweens.add({
      targets: img,
      displayWidth: base * 1.6,
      displayHeight: base * 1.6 * 0.5,
      alpha: 0,
      duration: 400,
      ease: 'Cubic.easeOut',
      onComplete: () => img.destroy(),
    });
  }

  // === 2 新事件-地雷 VFX（MineTrapSystem 呼叫；預警圈 handle 式持續脈動 / 爆炸一次性） ===

  /**
   * 地雷預警圈起手（鋪雷後 delaySec 內持續顯示範圍，脈動提示；handle 式，爆炸時 End 收）。
   * 貼地（origin 0.5,0.5、depth 地面層）；displaySize 依 radiusPx（爆炸半徑，直徑=2×r）。
   * @returns handle（Image）或 null（素材未載）。
   */
  mineWarningStart(x: number, y: number, radiusPx: number): Phaser.GameObjects.Image | null {
    const key = ENEMY_ATTACK_VFX.mineWarning.key;
    if (!this.scene.textures.exists(key)) return null;
    const img = this.scene.add.image(x, y, key).setOrigin(0.5, 0.5);
    img.setDepth(PANEL_DEPTH + 10); // 地面層（角色下）
    img.setBlendMode(Phaser.BlendModes.ADD);
    const d = Math.max(16, radiusPx * 2); // 直徑=覆蓋爆炸半徑
    img.setDisplaySize(d, d).setAlpha(0.85);
    this.scene.tweens.add({
      targets: img, alpha: 0.45, duration: 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    return img;
  }

  /** 地雷預警圈收（爆炸瞬間）→ 立即移除（爆炸 VFX 接手）。 */
  mineWarningEnd(handle: Phaser.GameObjects.Image | null): void {
    if (!handle) return;
    this.scene.tweens.killTweensOf(handle);
    handle.destroy();
  }

  /** 地雷爆炸（延遲到播一次；貼地、範圍依 radiusPx）。scale 0.6→1.1 爆開+後段淡出，~0.35s。 */
  mineExplosion(x: number, y: number, radiusPx: number): void {
    const key = ENEMY_ATTACK_VFX.mineExplosion.key;
    if (!this.scene.textures.exists(key)) return;
    const img = this.scene.add.image(x, y, key).setOrigin(0.5, 0.5);
    img.setDepth(PANEL_DEPTH + 13);
    img.setBlendMode(Phaser.BlendModes.ADD);
    const d = Math.max(16, radiusPx * 2);
    img.setDisplaySize(d * 0.6, d * 0.6).setAlpha(1);
    this.scene.tweens.add({ targets: img, displayWidth: d * 1.1, displayHeight: d * 1.1, duration: 350, ease: 'Quad.easeOut' });
    this.scene.tweens.add({ targets: img, alpha: 0, delay: 175, duration: 175, ease: 'Quad.easeIn', onComplete: () => img.destroy() });
  }

  /**
   * 地雷靜置本體（★踩雷式修正：撒下＝一個「靜止的地雷物件」，**不閃、不脈動、不帶爆炸半徑預警圈**）。
   * 用戶#1#2：撒下不該預先帶閃爍預警圈——之前重用 fx_mine_warning 貼圖 @爆炸半徑直徑=看起來就是預警圈。
   * 改用程式畫「小顆地雷本體」（固定小尺寸，與 radiusPx 爆炸範圍脫鉤）：深色圓身 + 亮邊 + 小高光點，
   * 貼地、depth 地面層、完全靜態（無 tween）。玩家踩到 → mineMarkerEnd 收、改起 mineWarningStart 閃爍預警圈。
   * @returns handle（Graphics）或 null。
   */
  mineMarkerStart(x: number, y: number, _radiusPx: number): Phaser.GameObjects.GameObject | null {
    const g = this.scene.add.graphics();
    g.setPosition(x, y).setDepth(PANEL_DEPTH + 9); // 地面層（比觸發預警圈 +10 稍低）
    const bodyR = MINE_BODY_RADIUS_PX; // ★固定小尺寸的地雷本體（=踩雷觸發半徑，與爆炸半徑脫鉤）
    // 深色圓身。
    g.fillStyle(0x2a2a30, 0.95);
    g.fillCircle(0, 0, bodyR);
    // 亮邊（讓地雷本體在地面上看得出、但非發光大圈）。
    g.lineStyle(2, 0xff5533, 0.9);
    g.strokeCircle(0, 0, bodyR);
    // 中心小高光點（讀作「一顆地雷」而非「一個圈」）。
    g.fillStyle(0xff8866, 1);
    g.fillCircle(0, 0, 3);
    return g;
  }

  /** 地雷靜置本體收（玩家踩到觸發時 / 離開節點清場時）→ 立即移除。 */
  mineMarkerEnd(handle: Phaser.GameObjects.GameObject | null): void {
    if (!handle) return;
    this.scene.tweens.killTweensOf(handle);
    handle.destroy();
  }

  /**
   * 「小心地雷！」宣告（★踩雷式：開放撒雷時發，比照 fireRainAnnounce 左滑進→停留→右滑出→銷毀）。
   * 定位讀 layout.screen.mineMessage；無則 fallback fireRainMessage 定位；再無則內建置中。
   * 純視覺提示（不 gate 撒雷；波次宣告時機已由波騎 mineGateSec 處理）。
   */
  mineAnnounce(): void {
    const el = this.screenElement('fireRainMessage', {
      x: 0,
      y: GAME_HEIGHT / 2 - 60 - 46,
      width: GAME_WIDTH,
      height: 92,
      align: 'center',
    });
    if (!isVisible(el)) return; // 勾掉訊息 → 不顯宣告字（純視覺、無 onDone 需求）
    const cy = el.y + el.height / 2;
    const align = el.align ?? 'center';
    const cx = align === 'left' ? el.x : align === 'right' ? el.x + el.width : el.x + el.width / 2;
    const originX = align === 'left' ? 0 : align === 'right' ? 1 : 0.5;
    const txt = this.scene.add.text(cx, cy, '小心地雷！', {
      fontFamily: 'Arial, "Microsoft JhengHei", sans-serif',
      fontSize: '96px',
      color: '#ff6644',
      fontStyle: 'bold',
      stroke: '#4a0a00',
      strokeThickness: 10,
    });
    txt.setOrigin(originX, 0.5).setScrollFactor(0).setDepth(ENERGY_FLY_DEPTH + 20);
    const startX = cx - GAME_WIDTH;
    const endX = cx + GAME_WIDTH;
    txt.x = startX;
    const slideMs = 400;
    const holdMs = 2000;
    this.scene.tweens.add({
      targets: txt,
      x: cx,
      duration: slideMs,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: txt,
          x: endX,
          delay: holdMs,
          duration: slideMs,
          ease: 'Cubic.easeIn',
          onComplete: () => txt.destroy(),
        });
      },
    });
  }

  /** 貼地圓盤 Y 軸壓扁比例（俯視橢圓；魔尖塔環 Graphics 版 + 火雨預警/落點共用；判定另處維持正圓，此僅視覺）。 */
  private static readonly GROUND_SQUASH_Y = 0.5;

  /**
   * ★魔尖塔「預警」環（C9 warning phase）：專屬貼圖 fx_tower_ring_warning（紅危險環帶+符文，★俯視壓扁 Y0.5 已內建）。
   * 貼圖：setScale 只對半徑（貼圖已壓扁，★不再套 GROUND_SQUASH_Y 免雙重壓扁）；alpha/亮度脈動 0.7↔1（越近攻擊越急迫感）
   * + 緩慢自轉；warningSec 到 → alpha 快速歸零自清。素材未載 → 退回 Graphics 版（火雨風格紅填充脈動+程式壓扁）。
   * 圓心=塔腳底 getTowerRingGroundCenter（貼地）。判定維持正圓（不影響 ringHitsPlayer）。
   * @param x,y 塔腳底地面點。@param diameterPx 環直徑（=2×半徑）。@param thicknessPx 環帶厚（Graphics 退回用）。@param durationMs 預警時長（=warningSec）。
   */
  towerRingWarning(x: number, y: number, diameterPx: number, thicknessPx: number, durationMs: number): void {
    const d = Math.max(16, diameterPx);
    const dur = Math.max(120, durationMs);
    const key = ENEMY_ATTACK_VFX.towerRingWarning.key;
    if (this.scene.textures.exists(key)) {
      const spr = this.scene.add.image(x, y, key).setOrigin(0.5, 0.5).setDepth(PANEL_DEPTH + 10);
      spr.setDisplaySize(d, d).setAlpha(0.85); // ★貼圖已內建俯視壓扁 Y0.5 → 直徑對半徑、不再程式壓扁
      // 脈動 0.7↔1（危險預警急迫感）。★不自轉——已壓扁橢圓貼圖做平面旋轉會看起來「立起來上下翻」非貼地平轉，故靜態朝向。
      const pulse = this.scene.tweens.add({
        targets: spr, alpha: 0.7, duration: 240, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      // warningSec 到 → alpha 快速歸零自清（攻擊瞬間接手）。
      this.scene.tweens.add({
        targets: spr, alpha: 0, delay: Math.max(0, dur - 120), duration: 120, ease: 'Sine.easeIn',
        onComplete: () => { pulse.stop(); spr.destroy(); },
      });
      return;
    }
    this.towerRingWarningGraphics(x, y, d, Math.max(2, thicknessPx), dur);
  }

  /** 預警環 Graphics 退回版（素材未載）：火雨風格紅填充脈動 + 程式貼地壓扁。 */
  private towerRingWarningGraphics(x: number, y: number, d: number, lw: number, dur: number): void {
    const radius = d / 2;
    const sq = EffectSystem.GROUND_SQUASH_Y;
    const g = this.scene.add.graphics();
    g.setPosition(x, y).setDepth(PANEL_DEPTH + 10);
    g.fillStyle(0xff3300, 0.22);
    g.fillCircle(0, 0, radius + lw / 2);
    g.lineStyle(Math.max(3, lw), 0xff5522, 0.9);
    g.strokeCircle(0, 0, radius);
    g.setScale(1, sq).setAlpha(0.85);
    const pulse = this.scene.tweens.add({
      targets: g, alpha: 0.55, duration: 250, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
    this.scene.tweens.add({
      targets: g, alpha: 0, delay: Math.max(0, dur - 200), duration: 200, ease: 'Sine.easeIn',
      onComplete: () => { pulse.stop(); g.destroy(); },
    });
  }

  /**
   * ★魔尖塔「攻擊/炸出」環（C9 active phase）：專屬貼圖 fx_tower_ring_attack（紫魔能衝擊環+白刃芯+bloom+能量刺，★俯視壓扁 Y0.5 已內建）。
   * 預警結束瞬間播一次：scale 微擴 1.0→1.12 迸發 + 後 50% alpha 淡出（時長 0.3~0.45s，不吃滿 ringInterval）+ 輕微自轉。
   * 貼圖 setScale 只對半徑（★不再套 GROUND_SQUASH_Y）。素材未載 → 退回 Graphics 版（雙層 ADD 紫爆閃+程式壓扁）。
   * 圓心=塔腳底（貼地）。判定維持正圓（active 命中在 EnemySpawner，此僅視覺）。
   * @param durationMs active 持續（=ringIntervalSec）；攻擊爆閃取其 0.3~0.45s。
   */
  towerRingActive(x: number, y: number, diameterPx: number, thicknessPx: number, durationMs: number): void {
    const d = Math.max(16, diameterPx);
    const dur = Math.max(120, durationMs);
    const key = ENEMY_ATTACK_VFX.towerRingAttack.key;
    if (this.scene.textures.exists(key)) {
      const burstMs = Math.min(450, Math.max(300, dur)); // 迸發時長 0.3~0.45s（不吃滿 ringInterval）
      const spr = this.scene.add.image(x, y, key).setOrigin(0.5, 0.5).setDepth(PANEL_DEPTH + 12).setBlendMode(Phaser.BlendModes.ADD);
      spr.setDisplaySize(d, d).setAlpha(1); // ★貼圖已內建壓扁 → 直徑對半徑、不再程式壓扁
      const base = spr.scale; // setDisplaySize 後的等效 scale（供迸發微擴基準）
      spr.setScale(base); // 明確化
      // ★不自轉——已壓扁橢圓貼圖平面旋轉會看似「立起來上下翻」非貼地平轉，故靜態朝向。
      // scale 微擴 1.0→1.12 迸發，後 50% alpha 淡出。
      this.scene.tweens.add({
        targets: spr, scale: base * 1.12, duration: burstMs, ease: 'Quad.easeOut',
      });
      this.scene.tweens.add({
        targets: spr, alpha: 0, delay: burstMs * 0.5, duration: burstMs * 0.5, ease: 'Sine.easeIn',
        onComplete: () => spr.destroy(),
      });
      return;
    }
    this.towerRingActiveGraphics(x, y, d, Math.max(3, thicknessPx), dur);
  }

  /** 攻擊環 Graphics 退回版（素材未載）：雙層 ADD 紫爆閃 + 程式貼地壓扁。 */
  private towerRingActiveGraphics(x: number, y: number, d: number, lw: number, dur: number): void {
    const radius = d / 2;
    const sq = EffectSystem.GROUND_SQUASH_Y;
    const core = this.scene.add.graphics();
    core.setPosition(x, y).setDepth(PANEL_DEPTH + 12).setBlendMode(Phaser.BlendModes.ADD);
    core.lineStyle(lw * 1.6, 0x9b5cff, 1);
    core.strokeCircle(0, 0, radius);
    const edge = this.scene.add.graphics();
    edge.setPosition(x, y).setDepth(PANEL_DEPTH + 13).setBlendMode(Phaser.BlendModes.ADD);
    edge.lineStyle(Math.max(2, lw * 0.5), 0xe0c8ff, 1);
    edge.strokeCircle(0, 0, radius);
    for (const g of [core, edge]) g.setScale(1.08, 1.08 * sq).setAlpha(0);
    this.scene.tweens.add({
      targets: [core, edge], scaleX: 1, scaleY: sq, alpha: 1,
      duration: Math.min(90, dur * 0.25), ease: 'Quad.easeOut',
      onComplete: () => {
        this.scene.tweens.add({
          targets: edge, alpha: 0, duration: Math.max(80, dur * 0.3), ease: 'Sine.easeIn',
          onComplete: () => edge.destroy(),
        });
        this.scene.tweens.add({
          targets: core, scaleX: 1.12, scaleY: 1.12 * sq, alpha: 0,
          delay: Math.max(0, dur * 0.25), duration: Math.max(100, dur * 0.5), ease: 'Sine.easeIn',
          onComplete: () => core.destroy(),
        });
      },
    });
  }

  deathParticle(x: number, y: number, color: number): void {
    // 十五輪回歸修（真因：死亡點在 JP 橫幅帶（螢幕中央 y385-685）被 JP panel(depth≤1002) 遮住看不見，
    //   同寶盒報獎「被面板遮」教訓）→ 死亡粒子提到面板/JP 之上（PANEL_DEPTH+15=1015），戰鬥回饋恆可見。
    const depth = PANEL_DEPTH + 15;
    // 中央亮閃（爆點）：一顆大圓快速放大淡出，強化「死亡爆散」瞬間可見度。
    const flash = this.scene.add.graphics().setDepth(depth);
    flash.fillStyle(0xffffff, 0.95);
    flash.fillCircle(0, 0, 10);
    flash.x = x;
    flash.y = y;
    this.scene.tweens.add({
      targets: flash,
      scale: 3.5,
      alpha: 0,
      duration: 220,
      ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });
    // 爆散粒子（加強：16 顆、8-14px、噴 60-120px、500-700ms 更明顯久看得見）。
    const count = 16;
    for (let i = 0; i < count; i += 1) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const g = this.scene.add.graphics();
      g.fillStyle(color, 1);
      g.fillCircle(0, 0, Phaser.Math.Between(8, 14));
      g.x = x;
      g.y = y;
      g.setDepth(depth);
      const dist = Phaser.Math.Between(60, 120);
      this.scene.tweens.add({
        targets: g,
        x: x + Math.cos(a) * dist,
        y: y + Math.sin(a) * dist,
        alpha: 0,
        scale: 0.2,
        duration: Phaser.Math.Between(500, 700),
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
