import Phaser from 'phaser';
import {
  PLAYER_CONFIG,
  PLAYER_HIT_RADIUS,
  PLAYER_IFRAME_DURATION,
  SPRITE_SCALE,
} from '@/config/combatConfig';
import { PPU } from '@/config/gameConfig';
import { lungeDecay } from '@/systems/targetingMath';
import { getResolvedDash } from '@/config/dashSchema';
import { FOOT_GLOW, PLAYER_DISC, footGlowCenter, playerColor, resolveFoot } from '@/config/playerConfig';
import { PANEL_DEPTH } from '@/config/uiConfig';
import { UI_LAYOUT_ASSET } from '@/config/uiConfig';
import { validateUiLayout, isVisible } from '@/config/uiLayoutSchema';
import { loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';
import { ENTRANCE, entrancePosition } from '@/systems/entranceMath';
import { CharacterAnimator } from '@/systems/CharacterAnimator';
import type { InputSource } from '@/systems/InputSource';
import type { Hittable, Vec2 } from '@/systems/hitDetection';

/** 玩家可用的角色美術 key（debug 預覽用 T 鍵循環切換）。 */
export const PLAYER_CHARACTERS = ['Human', 'SunWukong'] as const;

/**
 * 攻擊動畫「揮出」幀 index（第十三輪#1 徹底解：斬光特效綁此幀觸發，非計時）。
 * attack 動畫 10 幀(0-9)，frame 02-07 是揮、04-05 揮出最明顯（md5/subagent 確認）→ 綁 frame 4「劍橫出」那刻。
 */
const ATTACK_SWING_FRAME = 4;

/** 衝刺殘影：生成間隔(秒)、藍色半透明 tint、初始 alpha、fade 時長(秒)。 */
const AFTER_IMAGE_INTERVAL = 0.05;
const AFTER_IMAGE_TINT = 0x8080ff; // ≈ (0.5, 0.5, 1)
const AFTER_IMAGE_ALPHA = 0.5;
const AFTER_IMAGE_FADE = 0.3;

/** 待機/進場中角色 depth：提到下方面板(PANEL_DEPTH=1000)之上，站在介面上看得見。 */
const WAITING_DEPTH = PANEL_DEPTH + 10;

/**
 * 用戶 #5/#8：從 scene 快取讀 layout.foot（搜索圈/真空帶設定）。
 * 無 JSON/未載/不合法/無 foot → undefined（呼叫端 resolveFoot fallback FOOT_GLOW，不炸）。
 */
function readFootLayout(scene: Phaser.Scene):
  | { searchRadiusPx?: number; offsetX?: number; offsetY?: number; visible?: boolean }
  | undefined {
  const override = loadOverride(EDITOR_STORE_KEYS.uiLayout); // 匯入機制：override 優先
  const raw = override ?? (scene.cache.json.get(UI_LAYOUT_ASSET.key) as unknown);
  if (raw === undefined || raw === null) return undefined;
  const result = validateUiLayout(raw);
  return result.ok ? result.data.foot : undefined;
}
/** 遊玩中角色 depth：正常地面層（面板之下、真空環 -10 之上）。 */
const PLAY_DEPTH = 10;

/**
 * Player — 玩家實體（Human 逐幀動畫）。
 *
 * 封裝移動、面向、攻擊冷卻/前搖計時，並依狀態機驅動動畫：
 * idle/move 循環、attack 播一次（配合 hitDelay/cooldown）、damaged 受擊、death 死亡。
 * 實作 Hittable，讓敵人攻擊/射彈能以幾何判定命中玩家。
 * 命中「自己的攻擊」判定不在此（交給 hitDetection + GameScene）。
 */
export class Player implements Hittable {
  /** 玩家編號（0-3；多人遷移 S1 目前只有 P1=0）。 */
  readonly playerId: number;
  /** 玩家種類（S1 目前只有 human）。 */
  readonly kind: 'human' | 'ai';

  /** 操控意圖來源（S2）：P1=人類 InputSystem；S4 AI 為另一實作。建 ctx 時注入。 */
  inputSource: InputSource | null = null;

  private anim: CharacterAnimator;
  private charKey: string;

  /** 面向：+1 面右、-1 面左。 */
  private facing = 1;

  private cooldownRemaining = 0;
  private hitDelayRemaining = 0;
  private pendingHit = false;

  /** 是否正在播 attack（播完前不切回 idle/move）。 */
  private attacking = false;
  /** 受擊硬直剩餘秒數（播 damaged，期間不覆蓋成 move/idle）。 */
  private damagedRemaining = 0;

  /** hitlag 剩餘秒數（>0：命中敵人瞬間凍結玩家自身動畫+位移，"砍進肉卡住"）。 */
  private hitlagRemaining = 0;
  /** 十四輪：hitlag 待觸發秒數（>0：已命中但攻擊動畫還沒播到揮擊幀，等播到才真正 pause 定格，避免卡起手幀）。 */
  private hitlagPending = 0;

  /** 被抓中（isGrabbed，用戶試玩#4）：不能動、藍閃、倒數掙脫；由 GrabSystem 控制。 */
  private grabbed = false;
  /** ★2 新事件：麻痺（stun）剩餘秒數（>0：地雷爆炸/魔尖塔環狀技命中→定住 N 秒不能移動/攻擊，時間到自動解除；★不扣血、純定住）。 */
  private stunRemaining = 0;
  /** 十六輪 bug1：被抓時按攻擊的掙脫輸入旗標（PlayerControl 被抓 gate 設、GrabSystem consume）——不實際普攻(保持 idle)但驅動掙脫。 */
  private struggleInput = false;

  /** 無敵幀剩餘秒數（>0 表示免疫且閃爍）。 */
  private iFrameRemaining = 0;
  /** debug：最近被誰打到。 */
  private lastHitBy = '';

  /** 二段變身視覺放大倍率（1=常態；二段變身時放大，乘在 SPRITE_SCALE 上）。 */
  private secondTransformScale = 1;

  /** 衝刺狀態。 */
  private dashing = false;
  private dashRemaining = 0;
  private dashDir: Vec2 = { x: 0, y: 0 };
  /** 本次衝刺已命中過的敵人（去重，一隻一次）。 */
  private readonly dashHitSet = new Set<object>();

  /** 攻擊前戳 lunge 速度（px/s，十一輪#2）：startLunge 給初速、updateLunge 每幀衰減施加位移。 */
  private lungeVel: Vec2 = { x: 0, y: 0 };
  /** 衝刺殘影生成計時器（每 AFTER_IMAGE_INTERVAL 秒生一個）。 */
  private afterImageTimer = 0;

  private readonly hitRadiusPx: number;
  /** 用戶 #5/#8：生效的搜索圈(真空帶)參數 = layout.foot 或 fallback FOOT_GLOW。 */
  private readonly foot: { radiusPx: number; offsetX: number; offsetY: number };
  /** 用戶 #6：layout.foot 顯示開關（visible=false → 不畫搜索圈）。 */
  private readonly footLayoutVisible: boolean = true;

  /** 腳下識別標記：七輪換 fx_player_disc 貼地發光圓盤（染玩家色）；素材缺 → fallback strokeCircle 環。depth 低於角色。 */
  private readonly footGlow!: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
  /** footGlow 是否為圓盤圖（true=Image disc；false=Graphics 環後備）。 */
  private readonly footGlowIsDisc: boolean = false;
  /** 真空環顯示旗標（項目3 進場鉤子：待機隱藏、進場顯示；現預設顯示）。 */
  private footGlowVisible = true;

  /** 進場跳躍狀態（項目3）。 */
  private entranceActive = false;
  private entranceT = 0;
  private entranceStart: Vec2 = { x: 0, y: 0 };
  private entranceEnd: Vec2 = { x: 0, y: 0 };
  /** 待機狀態（投幣進場循環）：開場/耗盡回待機時 true，投幣進場後 false。 */
  private waiting = false;
  /** 用戶#3 變身進場表演：投幣後在待機區浮起變身中（浮起→發光變身→降臨前）。基準 y 供還原。 */
  private transformFloating = false;
  private transformFloatBaseY = 0;
  /** 十五輪：沒 credit（耗盡）狀態旗標（CreditSystem 進/出耗盡各設一次；敵人 targeting/環繞/抓排除）。 */
  private outOfCredit = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    charKey: string = PLAYER_CHARACTERS[0],
    playerId = 0,
    kind: 'human' | 'ai' = 'human',
  ) {
    this.scene = scene;
    this.charKey = charKey;
    this.playerId = playerId;
    this.kind = kind;
    this.anim = new CharacterAnimator(scene, charKey, x, y);
    this.anim.setScale(SPRITE_SCALE);
    this.anim.setFacing(this.facing);
    this.hitRadiusPx = PLAYER_HIT_RADIUS * PPU;

    // 用戶 #5/#8：搜索圈(真空帶)大小/位置讀 layout.foot（可編輯器調）；無/不合法 → fallback FOOT_GLOW（不炸）。
    const footLayout = readFootLayout(scene);
    this.foot = resolveFoot(footLayout);
    this.footLayoutVisible = isVisible(footLayout); // 用戶 #6：foot 勾掉 → 不畫搜索圈

    // 腳下識別標記：七輪 fx_player_disc 貼地發光圓盤（染玩家色、跟腳下、depth 低於角色不擋）；
    //   素材缺 → fallback 舊 strokeCircle 識別環（不炸）。
    if (scene.textures.exists(PLAYER_DISC.key)) {
      const disc = scene.add.image(0, 0, PLAYER_DISC.key);
      disc.setDepth(FOOT_GLOW.depth); // decision d5d4527c：sortingOrder=-10 低於角色 body
      this.footGlow = disc;
      this.footGlowIsDisc = true;
    } else {
      this.footGlow = scene.add.graphics();
      this.footGlow.setDepth(FOOT_GLOW.depth);
    }
    this.drawFootGlow();
    this.syncFootGlow();
  }

  /** preload 識別圓盤素材（GameScene.preload 呼叫）。 */
  static preload(scene: Phaser.Scene): void {
    if (!scene.textures.exists(PLAYER_DISC.key)) {
      scene.load.image(PLAYER_DISC.key, PLAYER_DISC.path);
    }
  }

  private readonly scene: Phaser.Scene;

  /**
   * debug：切換玩家角色皮膚（Human↔SunWukong）。保留位置與面向，重建 animator。
   */
  switchCharacter(charKey: string): void {
    if (charKey === this.charKey) return;
    const { x, y } = this.anim.sprite;
    this.charKey = charKey;
    this.anim.destroy();
    this.anim = new CharacterAnimator(this.scene, charKey, x, y);
    this.anim.setScale(SPRITE_SCALE * this.secondTransformScale);
    this.anim.setFacing(this.facing);
    // 重建後狀態旗標歸零，避免卡在舊 attack。
    this.attacking = false;
    this.damagedRemaining = 0;
  }

  /**
   * 二段變身視覺放大（用戶新大功能）：設定倍率（乘在 SPRITE_SCALE 上），立即重套 sprite scale。
   * mult=1 還原常態。純視覺放大；攻擊範圍加成由 TransformSystem/判定端處理。
   */
  setSecondTransformScale(mult: number): void {
    this.secondTransformScale = mult > 0 ? mult : 1;
    this.anim.setScale(SPRITE_SCALE * this.secondTransformScale);
    this.syncFootGlow(); // 立即對齊：放大改變中心→腳底距離，footGlow 位置隨即更新（免站定不動時偏一幀）。
  }

  getCharacterKey(): string {
    return this.charKey;
  }

  getPosition(): Vec2 {
    return { x: this.anim.sprite.x, y: this.anim.sprite.y };
  }

  /**
   * 腳下落地點（世界座標）＝ sprite 中心往下偏到腳部（同真空環 syncFootGlow 用的 footGlowCenter）。
   * 供落地光效（descendImpact/shockwaveRing）貼腳下地面，而非 getPosition()（=sprite 中心，會偏頭上）。
   */
  getFootPosition(): Vec2 {
    return footGlowCenter(this.anim.sprite.x, this.anim.sprite.y, this.foot.offsetX, this.scaledFootOffsetY());
  }

  // --- 腳下真空環（搜索圈） ---

  /** 重畫/設定腳下識別標記（圓盤染色+尺寸 或 後備環）；建立/顯示切換時呼叫。 */
  private drawFootGlow(): void {
    const color = playerColor(this.playerId);
    const visible = this.footGlowVisible && this.footLayoutVisible;
    if (this.footGlowIsDisc) {
      const disc = this.footGlow as Phaser.GameObjects.Image;
      disc.setTint(color); // 中性白圓盤染玩家色（P1藍/P2紅/P3綠/P4黃）
      // 圓盤寬 = 搜索圈直徑 × widthScale；2:1 貼地 → 高 = 寬/2（素材已內建透視，不再壓扁）。
      const w = this.foot.radiusPx * 2 * PLAYER_DISC.widthScale;
      disc.setDisplaySize(w, w / 2);
      disc.setAlpha(PLAYER_DISC.alpha);
      disc.setVisible(visible);
    } else {
      const g = this.footGlow as Phaser.GameObjects.Graphics;
      g.clear();
      g.lineStyle(FOOT_GLOW.ringWidthPx, color, FOOT_GLOW.alpha);
      g.strokeCircle(0, 0, this.foot.radiusPx); // 用戶#5/#8：半徑讀 layout.foot（可編輯器調）
      g.setVisible(visible); // 用戶 #6：layout.foot visible=false → 不畫
    }
  }

  /**
   * 每幀更新真空環中心 = 角色身體中心（sprite origin=中心）往下偏到腳下（#6 修：origin 已是中心，
   * 不再是 Unity 的 -50 往上，改用 footGlowCenter 往下貼腳部）。
   */
  syncFootGlow(): void {
    const c = footGlowCenter(this.anim.sprite.x, this.anim.sprite.y, this.foot.offsetX, this.scaledFootOffsetY());
    this.footGlow.x = c.x;
    this.footGlow.y = c.y;
  }

  /**
   * 腳底 Y 偏移乘二段放大倍率（修：二段變身放大 sprite 後，中心→腳底距離按 scale 拉長；
   * foot.offsetY 是常態 mult=1 校準的常數，需乘 secondTransformScale 才對齊放大後真腳底，否則 footGlow 偏上）。
   * mult=1 → 回原 offsetY（現況不變）。X 偏移是水平置中不隨放大改，不乘。
   */
  private scaledFootOffsetY(): number {
    return this.foot.offsetY * this.secondTransformScale;
  }

  /**
   * 顯示/隱藏真空環（項目3 進場鉤子：待機隱藏、EnterGame 顯示）。
   * 現預設顯示，項目3 做進場流程時呼叫此切換。
   */
  setFootGlowVisible(visible: boolean): void {
    this.footGlowVisible = visible;
    this.footGlow.setVisible(visible && this.footLayoutVisible); // 用戶#6：layout.foot 勾掉則恆隱
  }

  /** 真空環目前是否顯示（測試/查詢用）。 */
  isFootGlowVisible(): boolean {
    return this.footGlowVisible;
  }

  // --- 進場跳躍（JumpToField，項目3） ---

  /**
   * 進入待機狀態（投幣進場循環）：站待機點、隱藏真空環、不可操控。
   * 開場所有玩家 waiting；Credit 耗盡倒數歸零也回 waiting。
   * @param waitX/waitY 待機點（下方面板該欄，界騎 getWaitingAnchor / fallback）
   */
  setWaiting(waitX: number, waitY: number): void {
    this.waiting = true;
    this.entranceActive = false;
    this.isJumping = false;
    this.setPosition(waitX, waitY);
    this.setFootGlowVisible(false); // 待機隱藏真空環（項目2鉤子）
    // 待機時角色 depth 提到下方面板之上，才「站在介面上」看得到（否則被 PANEL_DEPTH 蓋住）。
    this.anim.sprite.setDepth(WAITING_DEPTH);
    this.syncFootGlow();
    this.anim.play('idle');
  }

  /** 是否在待機狀態（不可操控/攻擊；投幣才進場）。 */
  isWaiting(): boolean {
    return this.waiting;
  }

  // --- 用戶#3 變身進場表演（待機區浮起→發光變身→降臨） ---

  /** 投幣後開始「變身浮起」：記待機基準 y，離開待機態、進浮起（仍在待機區位置，不可操控）。純位移，特效另掛。 */
  startTransformFloat(): void {
    this.waiting = false; // 離開待機態（進變身浮起表演；表演中由 isTransformFloating gate 不吃操控）
    this.transformFloating = true;
    this.transformFloatBaseY = this.anim.sprite.y;
    this.anim.play('idle'); // 浮空待機蓄力（不被 move 覆蓋）
    this.setFootGlowVisible(false); // 浮起中不顯搜索圈
  }

  /** 浮起中每幀更新 Y 位移（offsetY<=0 往上，由 entranceTransformMath.floatOffsetY 算）。相對記錄的基準 y。 */
  updateTransformFloat(offsetY: number): void {
    if (!this.transformFloating) return;
    this.anim.sprite.y = this.transformFloatBaseY + offsetY;
    this.syncFootGlow();
  }

  /** 結束變身浮起（降臨前）：還原基準 y、清浮起態（降臨由 startEntrance 接手）。 */
  endTransformFloat(): void {
    if (!this.transformFloating) return;
    this.transformFloating = false;
    this.anim.sprite.y = this.transformFloatBaseY; // 還原基準（降臨起點）
    this.syncFootGlow();
  }

  /** 是否在變身浮起表演中（PlayerControlSystem gate：浮起中不吃操控）。 */
  isTransformFloating(): boolean {
    return this.transformFloating;
  }

  /**
   * 開始從待機區進場跳躍到落點。進場中 isJumping=true（免疫地圖夾限）、真空環先隱藏。
   * @param startX/startY 起點（待機區，通常場外）
   * @param endX/endY 落點（按 playerId 分散）
   */
  startEntrance(startX: number, startY: number, endX: number, endY: number): void {
    this.waiting = false; // 離開待機（投幣進場）
    this.entranceActive = true;
    // 進場飛行中維持在面板之上（從面板跳出、飛越 UI 時可見）。
    this.anim.sprite.setDepth(WAITING_DEPTH);
    this.entranceT = 0;
    this.entranceStart = { x: startX, y: startY };
    this.entranceEnd = { x: endX, y: endY };
    this.isJumping = true; // 免疫地圖邊界夾限（接項目1鉤子）
    this.setFootGlowVisible(false); // 進場前不顯真空環（接項目2鉤子）
    this.setPosition(startX, startY);
    this.syncFootGlow();
    this.anim.play('move');
  }

  /** 進場中？（PlayerControl 進場期間跳過一般操控）。 */
  isEntering(): boolean {
    return this.entranceActive;
  }

  /**
   * 進場每幀更新：水平 lerp + 垂直拋物線；到期落地（位置=落點、isJumping=false、顯真空環）。
   * @returns 是否仍在進場中（落地當幀回 false）。
   */
  updateEntrance(dt: number): boolean {
    if (!this.entranceActive) return false;
    this.entranceT += dt / ENTRANCE.durationSec;
    if (this.entranceT >= 1) {
      // 落地：定位到落點、結束進場。
      this.entranceActive = false;
      this.isJumping = false;
      this.setPosition(this.entranceEnd.x, this.entranceEnd.y);
      this.setFootGlowVisible(true); // 進場後顯真空環（OnLanded）
      this.anim.sprite.setDepth(PLAY_DEPTH); // 落地回正常遊玩 depth（面板之下、地面之上）
      this.syncFootGlow();
      this.anim.play('idle');
      return false;
    }
    const p = entrancePosition(
      this.entranceStart.x,
      this.entranceStart.y,
      this.entranceEnd.x,
      this.entranceEnd.y,
      this.entranceT,
    );
    this.setPosition(p.x, p.y);
    this.syncFootGlow();
    return true;
  }

  /** 直接設定位置（地圖邊界 clamp 寫回 / 守護波 scripted introMove 等）。十六輪⑤：一併同步 footGlow 搜索圈跟隨（避免 scripted 自動移動時搜索圈留原地）。 */
  setPosition(x: number, y: number): void {
    this.anim.sprite.x = x;
    this.anim.sprite.y = y;
    this.syncFootGlow();
  }

  /**
   * 進場動畫旗標：true 時免疫地圖邊界夾限（從場外跳進來，接項目 3 待機區進場）。
   * 目前無進場動畫，預設 false，不影響現行行為。
   */
  isJumping = false;

  // --- Hittable（供敵人攻擊/射彈判定玩家） ---
  getHitCenter(): Vec2 {
    return { x: this.anim.sprite.x, y: this.anim.sprite.y };
  }

  getHitRadius(): number {
    return this.hitRadiusPx;
  }

  /**
   * 真空帶半徑（像素，用戶試玩#1）：敵人被推出玩家的範圍基準 = 腳下視覺搜索圈半徑
   * （FOOT_GLOW.radiusPx=50），讓「眼見的搜索圈 = 實際推怪真空帶」。
   * 與 getHitRadius（受擊命中半徑 40）分開：受擊用 40、推怪真空用 50（視覺一致）。
   */
  getVacuumRadius(): number {
    return this.foot.radiusPx; // 用戶#5/#8：讀 layout.foot.searchRadiusPx（fallback FOOT_GLOW.radiusPx）
  }

  /**
   * 真空帶中心（像素）。七輪#8 治本（對齊 Unity vacuumVisualOffsetY=0.5unit「環中心相對 pivot 往上到身體中心」）：
   * 改用「身體中心」= sprite 幾何中心（getHitCenter），不再用腳底 footGlowCenter。
   * → 真空推怪判定/surround 環繞圓心/牽引線/箭頭/負重 都以身體中心為圓心 = 上下對稱（不再下方特別大、
   *   下方槽位不離玩家 body 更遠 → 修 #7#8）。
   * 註（coupling 解耦）：視覺腳底識別光(syncFootGlow)仍用 footGlowCenter(腳部)＝暫留腳底(先 Y，X/Y 用戶拍板)；
   *   PLAYER_BOUNDS 下界 margin 另用 FOOT_GLOW.offsetYPx(角色中心→腳底物理距離)＝與真空中心分開，互不影響。
   */
  getVacuumCenter(): Vec2 {
    return this.getHitCenter(); // 身體中心（sprite origin 即中心）
  }

  /**
   * 視覺搜索圈（腳底識別光圈）中心（像素）。＝ syncFootGlow 用的 footGlowCenter（sprite 中心往下偏 foot.offsetY 到腳部）。
   * 用戶第九輪#5：牽引線要牽到「玩家看到的貼地搜索圈」邊緣＝此中心的圈，而非 getVacuumCenter（身體中心，#7#8 為 surround/推怪對稱改成 body 中心、比視覺圈高 ~75.6px）。
   * 與 getVacuumRadius（同 foot.radiusPx）搭配＝所見即所得的搜索圈幾何。
   */
  getFootGlowCenter(): Vec2 {
    return footGlowCenter(this.anim.sprite.x, this.anim.sprite.y, this.foot.offsetX, this.scaledFootOffsetY());
  }


  /** 目前是否處於無敵幀（iFrame 內免疫再次受擊）。 */
  isInvincible(): boolean {
    return this.iFrameRemaining > 0;
  }

  getLastHitBy(): string {
    return this.lastHitBy;
  }

  /**
   * 玩家被敵人攻擊命中。
   * 受擊反饋：damaged 動畫 + 0.5s iFrame 閃爍。iFrame 內呼叫會被忽略。
   * 若已設 soulDamageSink（變身中），命中真正落地時把 damage 交給它扣魂力。
   * @returns 是否實際受擊（false = 被 iFrame 擋掉）。
   */
  takeHit(damage: number, sourceName: string): boolean {
    if (this.shielded) return false; // 護盾：完全免疫（不扣血/魂力、不擊退）
    if (this.iFrameRemaining > 0) return false;
    this.lastHitBy = sourceName;
    this.iFrameRemaining = PLAYER_IFRAME_DURATION;
    this.damagedRemaining = 0.25;
    this.anim.play('damaged', { force: true });
    // 變身中：把傷害交給魂力扣血鉤子（TransformSystem 設定）。
    this.soulDamageSink?.(damage);
    return true;
  }

  /** 受擊扣魂力鉤子（由 TransformSystem 設；變身中才有）。 */
  private soulDamageSink: ((damage: number) => void) | null = null;

  /** buff 倍率/狀態（由 PlayerControl 每幀依 BuffSystem 設定）。 */
  private speedMult = 1;
  private dashSpeedMult = 1;
  private shielded = false;
  /** 推怪負重降速倍率（用戶：推越多越慢，PlayerControlSystem 每幀依真空圈可推敵人數設）。 */
  private pushLoadMult = 1;

  /** 設定移動速度倍率（頭盔 MoveSpeed）。 */
  setSpeedMultiplier(m: number): void {
    this.speedMult = m;
  }

  /** 設定推怪負重降速倍率（1=無負重、<1=推怪越多越慢；只影響移動不影響衝刺）。 */
  setPushLoadMultiplier(m: number): void {
    this.pushLoadMult = m;
  }

  /**
   * 目前每幀移動速度（px/秒，含 speedMult/pushLoadMult）。
   * 與 move() 內同一公式，供 ContactSolver 階段② paceMove 反算世界位移量用（純讀取、不改狀態/手感）。
   */
  getMoveSpeedPx(): number {
    return PLAYER_CONFIG.moveSpeed * PPU * this.speedMult * this.pushLoadMult;
  }

  /** 身體推擠半徑（＝推怪真空半徑；與 getVacuumRadius 一致，供 paceMove 當 ContactBody 半徑）。 */
  getBodyRadius(): number {
    return this.getVacuumRadius();
  }

  /** 設定衝刺速度倍率（頭盔 Dash / 寶盒坐騎）。 */
  setDashSpeedMultiplier(m: number): void {
    this.dashSpeedMult = m;
  }

  /** 設定護盾（頭盔 Shield）：受擊免疫、不扣魂力、不擊退。 */
  setShielded(on: boolean): void {
    this.shielded = on;
  }

  /** 設定/清除受擊扣魂力鉤子。變身時設、退變時傳 null 清除。 */
  setSoulDamageSink(sink: ((damage: number) => void) | null): void {
    this.soulDamageSink = sink;
  }

  /**
   * 變身金光閃 + 無敵。金(1,0.9,0.3)/原色交替 flashes 次、每次 halfSec 秒，並套 iFrame。
   * 用 tint 閃（精緻 VFX 之後補）。
   */
  playTransformFlash(iframeSec: number, flashes = 5, halfSec = 0.1): void {
    this.iFrameRemaining = Math.max(this.iFrameRemaining, iframeSec);
    const gold = 0xffe64d; // 約 (1, 0.9, 0.3)
    const spr = this.anim.sprite;
    for (let i = 0; i < flashes; i += 1) {
      this.scene.time.delayedCall(i * halfSec * 2, () => spr.setTint(gold));
      this.scene.time.delayedCall(i * halfSec * 2 + halfSec, () => spr.clearTint());
    }
    this.scene.time.delayedCall(flashes * halfSec * 2, () => spr.clearTint());
  }

  /** Credit 耗盡閃紅：on=紅色 tint、off=清除。由 CreditSystem 每幀切換做閃爍。 */
  setOutOfCreditTint(on: boolean): void {
    if (on) this.anim.sprite.setTint(0xff4444);
    else this.anim.sprite.clearTint();
  }

  /**
   * 十五輪：沒 credit 玩家狀態（權威旗標，由 CreditSystem 進/出耗盡時各設一次；有別於每幀閃爍的 setOutOfCreditTint）。
   * 供敵人 targeting / 環繞 / 抓 排除此玩家（沒 credit＝無敵待機，不被鎖定/攻擊/抓/環繞，對齊 Unity isOutOfCredit）。
   */
  setOutOfCredit(active: boolean): void {
    const was = this.outOfCredit;
    this.outOfCredit = active;
    // 十五輪 bug②：進耗盡（凍結，不能動）→ 強制切待機動畫（否則殘留之前的 move/attack 動畫）。
    if (active) {
      this.anim.play('idle');
      return;
    }
    // ★bug#2 修（用戶：英雄+credit警告倒數中按住方向鍵→投幣解除後 held 鍵沒重新觸發 walk、滑行）。
    //   解除耗盡時清 transient 戰鬥旗標（damaged/attacking），避免它們殘留使 move() early-return（不播 move 動畫→滑行）；
    //   動畫本身交回 PlayerControl 當幀依 held 輸入 play(move/idle)（move 方向未知，不在此主動 play）。
    if (was) {
      this.attacking = false;
      this.damagedRemaining = 0;
    }
  }

  /** 是否沒 credit（耗盡）狀態 → 敵人不鎖定/攻擊/抓/環繞（對齊 Unity）。 */
  isOutOfCredit(): boolean {
    return this.outOfCredit;
  }

  getFacing(): number {
    return this.facing;
  }

  isOnCooldown(): boolean {
    return this.cooldownRemaining > 0;
  }

  /** 依移動向量更新位置、面向與 idle/move 動畫。 */
  move(moveVec: Vec2, dt: number): void {
    if (this.hitlagRemaining > 0 || this.grabbed || this.stunRemaining > 0) return; // hitlag / 被抓 / 麻痺：凍結玩家位移
    const speedPx = PLAYER_CONFIG.moveSpeed * PPU * this.speedMult * this.pushLoadMult;
    this.anim.sprite.x += moveVec.x * speedPx * dt;
    this.anim.sprite.y += moveVec.y * speedPx * dt;

    if (moveVec.x > 0) this.setFacing(1);
    else if (moveVec.x < 0) this.setFacing(-1);

    // attack / damaged 期間不覆蓋動畫。
    if (this.attacking || this.damagedRemaining > 0) return;

    const moving = moveVec.x !== 0 || moveVec.y !== 0;
    this.anim.play(moving ? 'move' : 'idle');
  }

  // --- 攻擊前戳 lunge（Unity ApplyLungeVelocity，十一輪#2） ---

  /**
   * 攻擊觸發前戳：往 aim 方向（dirX,dirY 會正規化）給 lunge 初速 impulse（lungeForce×PPU）。
   * 連打累積（加到現有 lungeVel）；lungeEnabled=false 或零向量 → 不做。
   * @param dirX,dirY 前戳方向（通常玩家→最近怪 aim 向量；零向量 fallback 由呼叫端給 facing）。
   */
  startLunge(dirX: number, dirY: number): void {
    if (!PLAYER_CONFIG.lungeEnabled) return;
    const len = Math.hypot(dirX, dirY);
    if (len < 1e-6) return;
    const speed = PLAYER_CONFIG.lungeForce * PPU; // unit/s → px/s
    this.lungeVel.x += (dirX / len) * speed;
    this.lungeVel.y += (dirY / len) * speed;
  }

  /**
   * 每幀推進 lunge：施加位移（pos += lungeVel×dt）後指數衰減 lungeVel（lungeDecay 純函式）。
   * 不回彈（衰減到 0 停）；hitlag/被抓期間凍結（與 move 一致）。界內夾限由 PlayerControlSystem clampToMapBounds 收尾。
   * @param dt 幀時間。
   */
  updateLunge(dt: number): void {
    if (this.lungeVel.x === 0 && this.lungeVel.y === 0) return;
    if (this.hitlagRemaining > 0 || this.grabbed) return; // hitlag/被抓：凍結（不衰減，恢復後續戳）
    this.anim.sprite.x += this.lungeVel.x * dt;
    this.anim.sprite.y += this.lungeVel.y * dt;
    this.lungeVel.x = lungeDecay(this.lungeVel.x, dt, PLAYER_CONFIG.lungeDecayFactor);
    this.lungeVel.y = lungeDecay(this.lungeVel.y, dt, PLAYER_CONFIG.lungeDecayFactor);
  }

  /** 目前是否有 lunge 位移中（debug/測）。 */
  isLunging(): boolean {
    return this.lungeVel.x !== 0 || this.lungeVel.y !== 0;
  }

  /** 是否處於 hitlag（PlayerControlSystem 用來凍結移動/衝刺推進）。 */
  isInHitlag(): boolean {
    return this.hitlagRemaining > 0;
  }

  // --- ★2 新事件：麻痺（stun）狀態（地雷爆炸/魔尖塔環狀技命中→定住 N 秒） ---

  /**
   * 套用麻痺 N 秒（additive，取較長者）——定住不能移動/攻擊/衝刺，時間到自動解除。
   * ★不扣血（角色無血量）、不觸發被打倒扣二段能量（那是攻擊命中的獨立邏輯）；純「暫時定住」。
   * 供事件觸發（地雷爆炸/環狀技命中）呼叫，與 Enemy.applyStun 對稱。
   */
  applyStun(seconds: number): void {
    if (seconds <= 0) return;
    this.stunRemaining = Math.max(this.stunRemaining, seconds);
    this.anim.play('idle'); // 麻痺即停動作、切待機動畫
  }

  /** 是否麻痺中（PlayerControlSystem gate：麻痺時不吃移動/攻擊/衝刺輸入）。 */
  isStunned(): boolean {
    return this.stunRemaining > 0;
  }

  /** 每幀推進麻痺倒數（PlayerControlSystem 呼叫）；歸零自動解除。回傳是否仍麻痺。 */
  tickStun(dt: number): boolean {
    if (this.stunRemaining > 0) {
      this.stunRemaining = Math.max(0, this.stunRemaining - dt);
      // 麻痺視覺：閃爍（每 ~0.1s 切半透明，簡單提示定住）。解除復原 alpha。
      const blink = Math.floor(this.stunRemaining / 0.1) % 2 === 0;
      this.anim.sprite.setAlpha(blink ? 0.55 : 1);
      if (this.stunRemaining === 0) this.anim.sprite.setAlpha(1);
    }
    return this.stunRemaining > 0;
  }

  /**
   * 命中敵人瞬間開始 hitlag（真 hitstop，對齊 Unity CustomCharacterAnimator paused）：
   * 凍結攻擊動畫（anims.pause 定格頓挫）+ 位移（isInHitlag 擋 move/dash/lunge）。特效不凍（維持綁揮擊幀機制）。
   * 十四輪：★pause「只在攻擊揮擊命中幀(ATTACK_SWING_FRAME)之後」才觸發——命中判定走 hitDelay(0.1s≈frame2)早於揮擊幀(4)，
   *   若當下 pause 會卡起手幀（第十三輪 bug）。故先記 pending，tickHitlag 等動畫播到揮擊幀才真正 pause 定格（動畫已揮出去，頓挫在揮出那下）。
   * 同幀多命中只觸發一次（已在 hitlag 或 pending 中則忽略）。seconds<=0 不做。
   */
  startHitlag(seconds: number): void {
    if (seconds <= 0 || this.hitlagRemaining > 0 || this.hitlagPending > 0) return;
    this.hitlagPending = seconds;
    // 若動畫已播過揮擊幀（如攻擊 shape 大/慢速，hitDelay 時已到揮擊幀）→ 立即定格；
    //   否則等 tryStartAttack 註冊的揮擊幀事件（ANIMATION_UPDATE frame>=ATTACK_SWING_FRAME）觸發 activatePendingHitlag。
    if (this.isPastAttackSwingFrame()) this.activatePendingHitlag();
  }

  /** 揮擊幀到達（或已過）→ 把 pending hitlag 轉為真正定格（pause 動畫 + 起算 hitlagRemaining）。無 pending 則忽略。 */
  private activatePendingHitlag(): void {
    if (this.hitlagPending <= 0) return;
    this.hitlagRemaining = this.hitlagPending;
    this.hitlagPending = 0;
    this.anim.sprite.anims?.pause(); // 揮擊已播出 → 定格頓挫（hitstop，對齊 Unity）
  }

  /** attack 動畫是否已播到/過揮擊命中幀（ATTACK_SWING_FRAME）。非 attack 動畫→視為已過（相容）。 */
  private isPastAttackSwingFrame(): boolean {
    const anims = this.anim.sprite.anims;
    if (!anims?.currentAnim) return true;
    if (!anims.currentAnim.key.endsWith('__attack')) return true;
    return (anims.currentFrame?.index ?? 0) >= ATTACK_SWING_FRAME;
  }

  /**
   * 每幀推進 hitlag（active 定格倒數）：
   *  - pending 未定格 + 攻擊已結束（極快連打/中斷，沒到揮擊幀）→ 放棄 pending（不定格殘留）。
   *  - active（hitlagRemaining>0）：倒數；歸零 or 攻擊已結束 → resume 恢復動畫 + 清（★不殘留卡定格幀）。
   * @param dt 幀時間。
   */
  tickHitlag(dt: number): void {
    if (this.hitlagPending > 0 && !this.attacking) {
      this.hitlagPending = 0; // 攻擊結束前沒到揮擊幀 → 放棄，不定格
      return;
    }
    if (this.hitlagRemaining <= 0) return;
    this.hitlagRemaining -= dt;
    if (this.hitlagRemaining <= 0 || !this.attacking) {
      this.hitlagRemaining = 0;
      this.anim.sprite.anims?.resume(); // ★恢復動畫播放（連打/cooldown/中斷都 resume，不殘留卡定格幀）
    }
  }

  // --- 抓人（被 grabber 抓住，用戶試玩#4） ---

  /** 是否被抓（PlayerControlSystem/GrabSystem 用來凍結操控）。 */
  isGrabbed(): boolean {
    return this.grabbed;
  }

  /** 是否正在攻擊（被抓時偵測攻擊掙脫用）。 */
  isAttacking(): boolean {
    return this.attacking;
  }

  /** 十六輪 bug1：登記被抓掙脫攻擊輸入（PlayerControl 被抓 gate 每次 justPressedAttack 呼叫）。不實際普攻，僅供 GrabSystem 掙脫偵測。 */
  registerStruggleInput(): void {
    this.struggleInput = true;
  }

  /** 十六輪 bug1：consume 掙脫輸入 edge（GrabSystem 每幀讀，讀後清）。回傳本幀是否有新按攻擊掙脫。 */
  consumeStruggleInput(): boolean {
    const v = this.struggleInput;
    this.struggleInput = false;
    return v;
  }

  /** 設定被抓狀態：被抓 → 藍閃提示、不能動；解除 → 清 tint。 */
  setGrabbed(on: boolean): void {
    if (this.grabbed === on) return;
    this.grabbed = on;
    if (on) {
      this.anim.sprite.setTint(0x4488ff); // 藍閃提示
      this.anim.play('idle'); // 用戶第九輪 #2：被抓站定→切待機動畫（原只 setTint，move early-return 使被抓前 move 動畫卡住續播）
    } else {
      this.anim.sprite.clearTint();
      // 解除不強制切動畫：move/idle/dash 下幀自然接管（掙脫若走衝刺，dash 動畫續播不被打斷）。
    }
  }

  private setFacing(dir: number): void {
    if (dir === this.facing) return;
    this.facing = dir;
    this.anim.setFacing(dir);
  }

  /** 面向某世界 x（供 AI 面向目標）：目標在右→面右、在左→面左。 */
  faceTowards(targetX: number): void {
    const dx = targetX - this.anim.sprite.x;
    if (dx > 0.001) this.setFacing(1);
    else if (dx < -0.001) this.setFacing(-1);
  }

  // --- 衝刺（Dash） ---

  isDashing(): boolean {
    return this.dashing;
  }

  /** 目前衝刺方向（正規化）。 */
  getDashDir(): Vec2 {
    return { x: this.dashDir.x, y: this.dashDir.y };
  }

  /**
   * 發動衝刺。方向 dir 會被正規化；若為零向量則用當前面向。無 cooldown（呼叫端擋 isDashing）。
   */
  startDash(dir: Vec2): void {
    let x = dir.x;
    let y = dir.y;
    const len = Math.hypot(x, y);
    if (len < 1e-6) {
      x = this.facing;
      y = 0;
    } else {
      x /= len;
      y /= len;
    }
    this.dashing = true;
    this.dashRemaining = getResolvedDash().duration; // 衝刺可調：override 優先 + cache
    this.dashDir = { x, y };
    this.dashHitSet.clear();
    this.afterImageTimer = 0;
    // 十六輪 bug1(4bug③回歸)真因：dash 中途接管攻擊動畫 → attack 的 onComplete 永不觸發（anim 被 'move' 取代）
    //   → attacking 旗標卡 true→之後 move() 恆 early-return 不覆蓋動畫→走路殘留。dash 起手清攻擊態+移除揮擊監聽。
    this.attacking = false;
    this.hitlagPending = 0;
    this.anim.sprite.off(Phaser.Animations.Events.ANIMATION_UPDATE);
    // 面向依水平衝刺方向。
    if (x > 0) this.setFacing(1);
    else if (x < 0) this.setFacing(-1);
    this.anim.play('move'); // 衝刺用現有 move 動畫
    this.spawnAfterImage(); // 起手先生一個殘影
  }

  /**
   * 衝刺每幀更新：位移 dashSpeed×dt 往 dashDir；每 AFTER_IMAGE_INTERVAL 生殘影；時間到結束。
   * @returns 是否仍在衝刺中（結束當幀回 false）。
   */
  updateDash(dt: number): boolean {
    if (!this.dashing) return false;
    if (this.hitlagRemaining > 0) return true; // hitlag：凍結衝刺推進（不滑、清前衝感），仍算 dashing
    const speedPx = getResolvedDash().speed * PPU * this.dashSpeedMult; // 衝刺可調
    this.anim.sprite.x += this.dashDir.x * speedPx * dt;
    this.anim.sprite.y += this.dashDir.y * speedPx * dt;

    // 殘影：每 0.05s 生一個。
    this.afterImageTimer += dt;
    while (this.afterImageTimer >= AFTER_IMAGE_INTERVAL) {
      this.afterImageTimer -= AFTER_IMAGE_INTERVAL;
      this.spawnAfterImage();
    }

    this.dashRemaining -= dt;
    if (this.dashRemaining <= 0) {
      this.dashing = false;
    }
    return this.dashing;
  }

  /**
   * 生成一個衝刺殘影：快照當前角色貼圖的 ghost（同 texture/frame + 藍色半透明），
   * 排序在角色下一層(depth-1)，tween alpha→0 over 0.3s 後銷毀。
   * 只複製角色本體 sprite（腳底光/UI 等裝飾不在此 sprite 上，天然排除）。
   */
  private spawnAfterImage(): void {
    const src = this.anim.sprite;
    const ghost = this.scene.add.sprite(src.x, src.y, src.texture.key, src.frame.name);
    ghost.setOrigin(src.originX, src.originY);
    ghost.setScale(src.scaleX, src.scaleY);
    ghost.setFlipX(src.flipX);
    ghost.setTint(AFTER_IMAGE_TINT);
    ghost.setAlpha(AFTER_IMAGE_ALPHA);
    ghost.setDepth((src.depth || 0) - 1); // 角色下一層
    this.scene.tweens.add({
      targets: ghost,
      alpha: 0,
      duration: AFTER_IMAGE_FADE * 1000,
      ease: 'Linear',
      onComplete: () => ghost.destroy(),
    });
  }

  /** 衝刺命中去重：回傳 true 表示這隻本次衝刺尚未打過（並記錄）。 */
  tryDashHit(enemy: object): boolean {
    if (this.dashHitSet.has(enemy)) return false;
    this.dashHitSet.add(enemy);
    return true;
  }

  /**
   * 嘗試發動攻擊：非冷卻中則開始 hitDelay 前搖、進入冷卻、播 attack 一次。
   */
  tryStartAttack(hitDelay: number, cooldown: number, animTimeScale = 1, onSwingFrame?: () => void): boolean {
    if (this.cooldownRemaining > 0) return false;
    // 十四輪：新攻擊起手前，保險清 hitlag 定格（若上一擊 hitlag 未結束 resume）——避免 anims 殘留 paused 導致新攻擊動畫不播。
    if (this.hitlagRemaining > 0 || this.hitlagPending > 0) {
      this.hitlagRemaining = 0;
      this.hitlagPending = 0;
      this.anim.sprite.anims?.resume();
    }
    this.cooldownRemaining = cooldown;
    this.hitDelayRemaining = hitDelay;
    this.pendingHit = true;
    this.attacking = true;
    // 第十三輪#1 徹底解：斬光特效「綁揮擊幀」而非計時——攻擊動畫播到揮出幀(ATTACK_SWING_FRAME)才觸發 onSwingFrame。
    //   動畫沒揮到→不出特效；連打 restart 回 frame 0→重新播到揮擊幀才出（特效嚴格跟動畫動作，非固定計時）。
    const sp = this.anim.sprite;
    sp.off(Phaser.Animations.Events.ANIMATION_UPDATE); // 清前次殘留監聽（連打 restart）
    // 揮擊幀事件：動畫播到 ATTACK_SWING_FRAME（揮出）時觸發一次 → (a) 斬光特效 onSwingFrame（十三輪#1）
    //   (b) 若有 pending hitlag（命中已判定但等揮擊幀）→ 真正 pause 定格 hitstop（十四輪，避免卡起手幀）。
    {
      let fired = false;
      const onUpdate = (_a: unknown, frame: Phaser.Animations.AnimationFrame): void => {
        if (fired) return;
        if (!(this.anim.sprite.anims?.currentAnim?.key ?? '').endsWith('__attack')) return;
        if (frame.index >= ATTACK_SWING_FRAME) {
          fired = true;
          sp.off(Phaser.Animations.Events.ANIMATION_UPDATE, onUpdate);
          if (onSwingFrame) onSwingFrame();
          this.activatePendingHitlag(); // 揮擊已播出 → 定格 hitstop（若 pending）
        }
      };
      sp.on(Phaser.Animations.Events.ANIMATION_UPDATE, onUpdate);
    }
    this.anim.play('attack', {
      force: true,
      timeScale: animTimeScale, // 第十一輪#1：玩家攻擊動畫加速（attackSpeed.animTimeScale）。
      onComplete: () => {
        this.attacking = false;
      },
    });
    return true;
  }

  /** 更新計時器。回傳 true 表示本幀 hitDelay 到期、該做命中判定。 */
  updateTimers(dt: number): boolean {
    if (this.cooldownRemaining > 0) {
      this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    }
    if (this.damagedRemaining > 0) {
      this.damagedRemaining = Math.max(0, this.damagedRemaining - dt);
    }
    // iFrame 倒數 + 閃爍（每 ~60ms 切換半透明）。
    if (this.iFrameRemaining > 0) {
      this.iFrameRemaining = Math.max(0, this.iFrameRemaining - dt);
      const blink = Math.floor(this.iFrameRemaining / 0.06) % 2 === 0;
      this.anim.sprite.setAlpha(blink ? 0.4 : 1);
      if (this.iFrameRemaining === 0) {
        this.anim.sprite.setAlpha(1);
      }
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
