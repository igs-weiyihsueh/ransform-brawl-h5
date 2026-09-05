import Phaser from 'phaser';
import {
  DASH_CONFIG,
  PLAYER_CONFIG,
  PLAYER_HIT_RADIUS,
  PLAYER_IFRAME_DURATION,
  SPRITE_SCALE,
} from '@/config/combatConfig';
import { PPU } from '@/config/gameConfig';
import { FOOT_GLOW, footGlowCenter, playerColor } from '@/config/playerConfig';
import { PANEL_DEPTH } from '@/config/uiConfig';
import { ENTRANCE, entrancePosition } from '@/systems/entranceMath';
import { CharacterAnimator } from '@/systems/CharacterAnimator';
import type { InputSource } from '@/systems/InputSource';
import type { Hittable, Vec2 } from '@/systems/hitDetection';

/** 玩家可用的角色美術 key（debug 預覽用 T 鍵循環切換）。 */
export const PLAYER_CHARACTERS = ['Human', 'SunWukong'] as const;

/** 衝刺殘影：生成間隔(秒)、藍色半透明 tint、初始 alpha、fade 時長(秒)。 */
const AFTER_IMAGE_INTERVAL = 0.05;
const AFTER_IMAGE_TINT = 0x8080ff; // ≈ (0.5, 0.5, 1)
const AFTER_IMAGE_ALPHA = 0.5;
const AFTER_IMAGE_FADE = 0.3;

/** 待機/進場中角色 depth：提到下方面板(PANEL_DEPTH=1000)之上，站在介面上看得見。 */
const WAITING_DEPTH = PANEL_DEPTH + 10;
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

  /** 無敵幀剩餘秒數（>0 表示免疫且閃爍）。 */
  private iFrameRemaining = 0;
  /** debug：最近被誰打到。 */
  private lastHitBy = '';

  /** 衝刺狀態。 */
  private dashing = false;
  private dashRemaining = 0;
  private dashDir: Vec2 = { x: 0, y: 0 };
  /** 本次衝刺已命中過的敵人（去重，一隻一次）。 */
  private readonly dashHitSet = new Set<object>();
  /** 衝刺殘影生成計時器（每 AFTER_IMAGE_INTERVAL 秒生一個）。 */
  private afterImageTimer = 0;

  private readonly hitRadiusPx: number;

  /** 腳下真空環（搜索圈）圖形；識別色圓環，depth 低於角色。 */
  private readonly footGlow!: Phaser.GameObjects.Graphics;
  /** 真空環顯示旗標（項目3 進場鉤子：待機隱藏、進場顯示；現預設顯示）。 */
  private footGlowVisible = true;

  /** 進場跳躍狀態（項目3）。 */
  private entranceActive = false;
  private entranceT = 0;
  private entranceStart: Vec2 = { x: 0, y: 0 };
  private entranceEnd: Vec2 = { x: 0, y: 0 };
  /** 待機狀態（投幣進場循環）：開場/耗盡回待機時 true，投幣進場後 false。 */
  private waiting = false;

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

    // 腳下真空環（搜索圈）：玩家識別色圓環，depth 低於角色不擋，每幀跟隨位置。
    this.footGlow = scene.add.graphics();
    this.footGlow.setDepth(FOOT_GLOW.depth);
    this.drawFootGlow();
    this.syncFootGlow();
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
    this.anim.setScale(SPRITE_SCALE);
    this.anim.setFacing(this.facing);
    // 重建後狀態旗標歸零，避免卡在舊 attack。
    this.attacking = false;
    this.damagedRemaining = 0;
  }

  getCharacterKey(): string {
    return this.charKey;
  }

  getPosition(): Vec2 {
    return { x: this.anim.sprite.x, y: this.anim.sprite.y };
  }

  // --- 腳下真空環（搜索圈） ---

  /** 重畫真空環（識別色、半徑、線寬固定；只在建立/顯示切換時呼叫）。 */
  private drawFootGlow(): void {
    const color = playerColor(this.playerId);
    this.footGlow.clear();
    this.footGlow.lineStyle(FOOT_GLOW.ringWidthPx, color, FOOT_GLOW.alpha);
    this.footGlow.strokeCircle(0, 0, FOOT_GLOW.radiusPx); // 圓心設在 graphics 原點，位置靠 syncFootGlow
    this.footGlow.setVisible(this.footGlowVisible);
  }

  /**
   * 每幀更新真空環中心 = 角色身體中心（sprite origin=中心）往下偏到腳下（#6 修：origin 已是中心，
   * 不再是 Unity 的 -50 往上，改用 footGlowCenter 往下貼腳部）。
   */
  syncFootGlow(): void {
    const c = footGlowCenter(this.anim.sprite.x, this.anim.sprite.y);
    this.footGlow.x = c.x;
    this.footGlow.y = c.y;
  }

  /**
   * 顯示/隱藏真空環（項目3 進場鉤子：待機隱藏、EnterGame 顯示）。
   * 現預設顯示，項目3 做進場流程時呼叫此切換。
   */
  setFootGlowVisible(visible: boolean): void {
    this.footGlowVisible = visible;
    this.footGlow.setVisible(visible);
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

  /** 直接設定位置（地圖邊界 clamp 寫回用）。 */
  setPosition(x: number, y: number): void {
    this.anim.sprite.x = x;
    this.anim.sprite.y = y;
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
    return FOOT_GLOW.radiusPx;
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

  /** 設定移動速度倍率（頭盔 MoveSpeed）。 */
  setSpeedMultiplier(m: number): void {
    this.speedMult = m;
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

  getFacing(): number {
    return this.facing;
  }

  isOnCooldown(): boolean {
    return this.cooldownRemaining > 0;
  }

  /** 依移動向量更新位置、面向與 idle/move 動畫。 */
  move(moveVec: Vec2, dt: number): void {
    if (this.hitlagRemaining > 0) return; // hitlag：凍結玩家位移（砍進肉卡住，不移動）
    const speedPx = PLAYER_CONFIG.moveSpeed * PPU * this.speedMult;
    this.anim.sprite.x += moveVec.x * speedPx * dt;
    this.anim.sprite.y += moveVec.y * speedPx * dt;

    if (moveVec.x > 0) this.setFacing(1);
    else if (moveVec.x < 0) this.setFacing(-1);

    // attack / damaged 期間不覆蓋動畫。
    if (this.attacking || this.damagedRemaining > 0) return;

    const moving = moveVec.x !== 0 || moveVec.y !== 0;
    this.anim.play(moving ? 'move' : 'idle');
  }

  // --- hitlag（命中敵人瞬間凍結玩家自身動畫+位移，Unity StartHitlag/TickHitlag） ---

  /** 是否處於 hitlag（PlayerControlSystem 用來凍結移動/衝刺推進）。 */
  isInHitlag(): boolean {
    return this.hitlagRemaining > 0;
  }

  /**
   * 命中敵人瞬間開始 hitlag：凍結玩家動畫（sprite anim 暫停）+ 位移（由 isInHitlag 擋 move/dash）。
   * 同幀多命中只觸發一次（已在 hitlag 中則忽略；Unity inHitlag 去重）。0=不做。
   */
  startHitlag(seconds: number): void {
    if (seconds <= 0 || this.hitlagRemaining > 0) return;
    this.hitlagRemaining = seconds;
    this.anim.sprite.anims?.pause(); // animator.speed = 0（動畫凍）
  }

  /**
   * 每幀推進 hitlag：計時歸零 or 攻擊已結束 → 結束並恢復動畫（Unity 攻擊結束強制恢復防卡）。
   * @param dt 幀時間。
   */
  tickHitlag(dt: number): void {
    if (this.hitlagRemaining <= 0) return;
    this.hitlagRemaining -= dt;
    if (this.hitlagRemaining <= 0 || !this.attacking) {
      this.hitlagRemaining = 0;
      this.anim.sprite.anims?.resume(); // animator.speed = 1（恢復）
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
    this.dashRemaining = DASH_CONFIG.duration;
    this.dashDir = { x, y };
    this.dashHitSet.clear();
    this.afterImageTimer = 0;
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
    const speedPx = DASH_CONFIG.speed * PPU * this.dashSpeedMult;
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
  tryStartAttack(hitDelay: number, cooldown: number): boolean {
    if (this.cooldownRemaining > 0) return false;
    this.cooldownRemaining = cooldown;
    this.hitDelayRemaining = hitDelay;
    this.pendingHit = true;
    this.attacking = true;
    this.anim.play('attack', {
      force: true,
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
