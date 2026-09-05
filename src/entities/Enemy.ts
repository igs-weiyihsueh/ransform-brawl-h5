import Phaser from 'phaser';
import { getPerCharScale } from '@/config/animationConfig';
import { SPRITE_SCALE, PLAYER_HIT_RADIUS } from '@/config/combatConfig';
import { ENEMY_AI, ENEMY_BODY_RADIUS_PX, type EnemyAIConfig } from '@/config/enemyConfig';
import { PPU } from '@/config/gameConfig';
import { MAP_BOUNDS, clampToBounds, insetBounds } from '@/config/mapConfig';
import { CharacterAnimator } from '@/systems/CharacterAnimator';
import {
  attackFacing,
  blockEliteAdvance,
  calculateSeparation,
  combineWithSeparation,
  pushOutOfPlayer,
} from '@/systems/enemySeparation';
import {
  buildAttackCircle,
  isPlayerInEnemyAttackShape,
  type Hittable,
  type Vec2,
} from '@/systems/hitDetection';
import { HIT_FEEL } from '@/config/hitFeelConfig';
import { knockbackDistancePx } from '@/config/hitFeelConfig';

/**
 * hitFeel 表演介面（Enemy 只依賴這幾個方法，避免對 EffectSystem 的循環相依）。
 * 由 EnemySpawner 注入 ctx.effects（實作在 EffectSystem）。
 */
export interface HitFeelFx {
  hitFlash(sprite: Phaser.GameObjects.Sprite, color: number, durationSec: number): void;
  punchScale(sprite: Phaser.GameObjects.Sprite, amount: number): void;
  hitSpark(x: number, y: number, dirX: number, dirY: number, color: number): void;
  deathParticle(x: number, y: number, color: number): void;
  /** 用戶 #7 敵人攻擊特效（純視覺）。實作於 EffectSystem。 */
  enemySlash?(x: number, y: number, angleRad: number, scale?: number): void;
  enemyImpact?(x: number, y: number, scale?: number): void;
  enemyCharge?(x: number, y: number, durationMs?: number): Phaser.GameObjects.Image | null;
}

/** 敵人可用的角色美術 key（debug 預覽用循環選擇）。 */
export const ENEMY_CHARACTERS = ['Enemy_Rush', 'Enemy_Ranged', 'Enemy_Elite'] as const;

/** 敵人 AI 狀態。 */
type EnemyState = 'idle' | 'chase' | 'charge' | 'attack' | 'cooldown' | 'damaged' | 'death';

/**
 * 敵人出手時通知場景的資料。melee 帶命中圓，projectile 帶生成參數。
 * 場景據此對玩家做命中判定 / 生成射彈（射彈為可重用系統）。
 */
export interface EnemyAttackEvent {
  kind: 'melee' | 'projectile';
  sourceName: string;
  damage: number;
  knockback: number;
  /** melee：世界像素判定圓。 */
  meleeCircle?: { center: Vec2; radius: number };
  /** projectile：生成點、方向、速度(unit)、半徑(unit)。 */
  projectile?: {
    x: number;
    y: number;
    dir: Vec2;
    speedUnits: number;
    radiusUnits: number;
  };
}

/**
 * Enemy — 資料驅動的敵人（三種行為由 ENEMY_AI 決定）。
 *
 * 狀態機：chase（追）→ 進 attackRange → charge（蓄力 chargeTime）→ 出手（播 attack + 發 attackEvent）
 * → cooldown（attackCooldown）→ 再來。damaged（hitStun 硬直 + 擊退）；death 播完消失。
 * 實作 Hittable 供玩家攻擊判定。出手用 callback 交給場景處理（近戰對玩家判定 / 生成射彈）。
 */
export class Enemy implements Hittable {
  private readonly anim: CharacterAnimator;
  private readonly cfg: EnemyAIConfig;
  private readonly scaleFactor: number;

  private hp: number;
  private readonly maxHp: number;
  private readonly radiusPx: number;

  private state: EnemyState = 'chase';
  private timer = 0; // 當前狀態的計時（charge/cooldown/damaged 用）
  private facing = 1;

  private dead = false;
  /** 上一幀（本幀 update 移動前）的位置，用於 immovable 菁英「只擋自己前進、不被玩家推」。 */
  private prevPos: Vec2 = { x: 0, y: 0 };

  /** hitFeel 表演（由 EnemySpawner 注入 ctx.effects）；null 則不播 juice。 */
  hitFeelFx: HitFeelFx | null = null;
  /** 用戶 #7：蓄力預警特效 sprite（進 charge 時建、出手/離開時 destroy）。 */
  private chargeFx: Phaser.GameObjects.Image | null = null;

  /** 局部頓幀剩餘秒數（hitFeel microFreeze，只凍被打這隻：>0 時 update 早退不動作）。 */
  private freezeRemaining = 0;

  /** grabber（抓人者，用戶試玩#4）：設為 grabber 後由 GrabSystem 驅動追玩家、衝來期間無敵、暫停一般 AI。 */
  private grabber = false;
  /** grabber 已抓住玩家（鎖定）：站著維持 idle（用戶新#5），非追擊 move。 */
  private grabberLocked = false;

  /** 擊退快進快出（hitFeel）：剩餘時長 + 每秒位移向量（取代舊 velocity+指數衰減）。 */
  private knockbackRemaining = 0;
  private knockbackPerSec: Vec2 = { x: 0, y: 0 };
  /** attack 動畫是否播完（由 onComplete 設定），播完才進 cooldown。 */
  private attackAnimDone = false;

  /** 出手回呼（由場景設定）。 */
  onAttack: ((e: EnemyAttackEvent) => void) | null = null;

  /** 擊殺回呼（由 EnemySpawner 設定），死亡當下觸發一次，帶敵人角色 key + 各 player 對這隻的傷害 + 死亡位置。 */
  onKilled:
    | ((enemyKey: string, damageByPlayer: ReadonlyMap<number, number>, deathPos: Vec2) => void)
    | null = null;

  /** 本隻怪各 player 造成的傷害（寶盒擊殺歸屬按比例分，決策 c61872a6）。 */
  private readonly damageByPlayer = new Map<number, number>();

  /** 命中時記傷害歸屬（呼叫端帶 attackerId；純函式層 takeHit 簽章不變）。 */
  recordDamageFrom(attackerId: number, dmg: number): void {
    if (dmg <= 0) return;
    this.damageByPlayer.set(attackerId, (this.damageByPlayer.get(attackerId) ?? 0) + dmg);
  }

  /** 守護波目標覆蓋：設定後 AI 追/打此目標而非玩家；清除(null)回玩家。 */
  private guardTarget: { getPosition(): Vec2 } | null = null;

  /** 設定/清除守護目標覆蓋（守護波開始設雕像、結束清回玩家）。 */
  setGuardTarget(target: { getPosition(): Vec2 } | null): void {
    this.guardTarget = target;
  }

  /** 本幀其他敵人位置（EnemySpawner 每幀在 update 前設；供 separation 用）。 */
  private neighbors: readonly Vec2[] = [];

  /** 設定本幀鄰居（其他存活敵人位置，不含自己）。 */
  setNeighbors(others: readonly Vec2[]): void {
    this.neighbors = others;
  }

  /** 敵人 body 半徑（像素）：用碰撞半徑當 body 半徑（含 perCharScale 放大）。 */
  getBodyRadius(): number {
    return this.radiusPx;
  }

  /**
   * 防穿透（死亡不頂）：
   * - 一般敵人：把自己推到「距每個 player 至少 minDist」的邊緣。
   * - immovable 菁英（用戶 #4，像牆）：菁英**自己被玩家擋住**——菁英移動撞到玩家時，把
   *   **菁英自己**頂回玩家外緣（菁英的前進被玩家擋下、停在外緣），**不推玩家**。
   *   （玩家主動穿進菁英的阻擋，由 EnemySpawner 另一道 pushPlayersOutOfElite 處理，
   *   兩道合起來＝真正的牆：菁英撞玩家會停、玩家撞菁英被擋，雙向都不會被「推著走」。）
   * @param players 每個 player 的中心/半徑 + pushOut(x,y)（一般敵人不用；菁英改頂自己）。
   */
  resolvePenetration(
    players: readonly {
      pos: Vec2;
      hitRadius: number;
      pushOut?: (x: number, y: number) => void;
    }[],
  ): void {
    if (this.dead || this.state === 'death') return;
    const immovable = this.cfg.immovable === true;
    for (const p of players) {
      const minDist = p.hitRadius + this.radiusPx;
      if (immovable) {
        // 菁英像牆：擋下菁英自己的前進（頂回玩家外緣），但不被玩家推倒退，也不推玩家。
        const fixed = blockEliteAdvance(
          { x: this.anim.sprite.x, y: this.anim.sprite.y },
          this.prevPos,
          p.pos,
          minDist,
        );
        this.anim.sprite.x = fixed.x;
        this.anim.sprite.y = fixed.y;
      } else {
        // 一般敵人：把自己推開。
        const fixed = pushOutOfPlayer(
          { x: this.anim.sprite.x, y: this.anim.sprite.y },
          p.pos,
          minDist,
        );
        this.anim.sprite.x = fixed.x;
        this.anim.sprite.y = fixed.y;
      }
    }
  }

  /** 地圖邊界夾限：把「整個 body」夾回場地內（body 半徑內縮，死亡不夾；只在真超界才寫回）。 */
  clampToMapBounds(): void {
    if (this.dead || this.state === 'death') return;
    // 用 body 半徑內縮邊界，確保敵人整個身體都在界內、不會被推擠推到邊界外露出。
    const bounds = insetBounds(MAP_BOUNDS, this.radiusPx);
    const c = clampToBounds(this.anim.sprite.x, this.anim.sprite.y, bounds);
    if (c.changed) {
      this.anim.sprite.x = c.x;
      this.anim.sprite.y = c.y;
    }
  }

  /**
   * 防穿透 immovable 障礙（守護波雕像，#8）：把自己頂到障礙外緣（不穿進雕像體內）。
   * @param center 障礙中心（雕像 getHitCenter）。
   * @param radiusPx 障礙半徑（雕像 getHitRadius）。死亡不頂。
   */
  pushOutOfObstacle(center: Vec2, radiusPx: number): void {
    if (this.dead || this.state === 'death') return;
    const minDist = radiusPx + this.radiusPx;
    const fixed = pushOutOfPlayer(
      { x: this.anim.sprite.x, y: this.anim.sprite.y },
      center,
      minDist,
    );
    this.anim.sprite.x = fixed.x;
    this.anim.sprite.y = fixed.y;
  }

  /** 追擊移動：朝 aim 疊加分離力後正規化、按速度位移。 */
  private moveChase(aimDx: number, aimDy: number, dt: number): void {
    const speedPx = this.cfg.moveSpeed * PPU;
    const sep = calculateSeparation(
      { x: this.anim.sprite.x, y: this.anim.sprite.y },
      this.neighbors,
    );
    const dir = combineWithSeparation({ x: aimDx, y: aimDy }, sep);
    this.anim.sprite.x += dir.x * speedPx * dt;
    this.anim.sprite.y += dir.y * speedPx * dt;
  }

  /** 定身（麻痺/凍結）剩餘秒數：>0 時 update 停止行動（移動/攻擊）。 */
  private stunRemaining = 0;

  /** 套用定身 N 秒（麻痺/凍結，additive；取較長者）。 */
  applyStun(seconds: number): void {
    if (this.dead) return;
    this.stunRemaining = Math.max(this.stunRemaining, seconds);
  }

  /** 是否定身中。 */
  isStunned(): boolean {
    return this.stunRemaining > 0;
  }

  constructor(scene: Phaser.Scene, x: number, y: number, charKey: string = ENEMY_CHARACTERS[0]) {
    this.cfg = ENEMY_AI[charKey] ?? ENEMY_AI[ENEMY_CHARACTERS[0]];
    this.scaleFactor = getPerCharScale(this.cfg.characterKey);
    this.anim = new CharacterAnimator(scene, this.cfg.characterKey, x, y);
    this.anim.setScale(SPRITE_SCALE);
    this.hp = this.cfg.hp;
    this.maxHp = this.cfg.hp;
    this.radiusPx = ENEMY_BODY_RADIUS_PX * this.scaleFactor; // 可視 body 半徑(用戶#1#2a根治), 取代 256 frame 半徑
  }

  isDead(): boolean {
    return this.dead;
  }

  /** 用戶 #7：清掉蓄力預警特效（出手/受擊/死亡時，避免殘留）。 */
  private clearChargeFx(): void {
    if (this.chargeFx) {
      this.chargeFx.destroy();
      this.chargeFx = null;
    }
  }

  /** 立即銷毀（守護波 cleanup ClearAllActiveEnemies 用，不播死亡動畫、不觸發 onKilled）。 */
  forceDestroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.state = 'death';
    this.clearChargeFx();
    this.anim.destroy();
  }

  getHitCenter(): Vec2 {
    return { x: this.anim.sprite.x, y: this.anim.sprite.y };
  }

  getHitRadius(): number {
    return this.radiusPx;
  }

  /** 是否為 immovable 菁英（像牆；EnemySpawner 用來決定玩家撞它時把玩家擋在外）。 */
  isImmovable(): boolean {
    return this.cfg.immovable === true;
  }

  // --- grabber（抓人者，用戶試玩#4，由 GrabSystem 驅動） ---

  /** 設為 grabber（true=開始抓人：暫停一般 AI、無敵、由 GrabSystem 追玩家）。 */
  setGrabber(on: boolean): void {
    this.grabber = on;
    if (!on) this.grabberLocked = false;
  }

  isGrabber(): boolean {
    return this.grabber;
  }

  /** grabber 抓住玩家後鎖定（用戶新#5）：站著維持 idle（GrabSystem 觸碰鎖定時呼叫 true）。 */
  setGrabberLocked(locked: boolean): void {
    this.grabberLocked = locked;
  }

  /** GrabSystem 驅動 grabber 移動到指定位置（追玩家用）。 */
  moveTo(x: number, y: number): void {
    if (this.dead) return;
    this.anim.sprite.x = x;
    this.anim.sprite.y = y;
    if (x > this.prevPos.x + 0.01) this.setFacing(1);
    else if (x < this.prevPos.x - 0.01) this.setFacing(-1);
    this.prevPos = { x, y };
  }

  /** 掙脫時對 grabber 施加擊退並解除 grabber（GrabSystem 呼叫）。 */
  releaseGrabberWithKnockback(fromPos: Vec2): void {
    this.grabber = false;
    this.grabberLocked = false;
    const dx = this.anim.sprite.x - fromPos.x;
    const dy = this.anim.sprite.y - fromPos.y;
    const len = Math.hypot(dx, dy) || 1;
    this.knockbackRemaining = HIT_FEEL.knockbackDuration;
    const distPx = knockbackDistancePx(2, PPU); // 掙脫擊退固定力道
    this.knockbackPerSec = { x: (dx / len) * (distPx / HIT_FEEL.knockbackDuration), y: (dy / len) * (distPx / HIT_FEEL.knockbackDuration) };
    this.state = 'chase'; // 解除後回一般 AI
  }

  getCharacterKey(): string {
    return this.cfg.characterKey;
  }

  getHp(): number {
    return this.hp;
  }

  getMaxHp(): number {
    return this.maxHp;
  }

  getState(): EnemyState {
    return this.state;
  }

  /** 每幀更新：套擊退殘速 → 跑狀態機 → 更新動畫。 */
  update(playerPos: Vec2, dt: number): void {
    if (this.dead) return;

    // 記錄移動前位置（immovable 菁英防穿透用：只擋自己前進、不被玩家推回）。
    this.prevPos = { x: this.anim.sprite.x, y: this.anim.sprite.y };

    // hitFeel 局部頓幀（microFreeze）：只凍被打這隻——早退不做任何位移/AI/動畫，倒數。
    // （不影響全場，其他敵人照跑；不動數值，扣血已在 takeHit 當下完成。）
    if (this.freezeRemaining > 0) {
      this.freezeRemaining -= dt;
      return;
    }

    // grabber（抓人者）：一般 AI 暫停，由 GrabSystem 驅動。
    // 追玩家中→播 move；已抓住玩家(locked)→站著維持 idle（用戶新#5），直到掙脫。
    if (this.grabber) {
      this.anim.play(this.grabberLocked ? 'idle' : 'move');
      return;
    }

    // 擊退（hitFeel 快進快出）：有剩餘時長則按每秒位移推進，時間到即停（取代舊指數衰減）。
    if (this.knockbackRemaining > 0) {
      const step = Math.min(dt, this.knockbackRemaining);
      this.anim.sprite.x += this.knockbackPerSec.x * step;
      this.anim.sprite.y += this.knockbackPerSec.y * step;
      this.knockbackRemaining -= dt;
    }

    if (this.state === 'death') return;

    // 定身（麻痺/凍結）：停止行動（移動/攻擊/AI），只保留 idle 動畫，倒數。
    if (this.stunRemaining > 0) {
      this.stunRemaining -= dt;
      this.anim.play('idle');
      return;
    }

    // 守護波：有覆蓋目標則追/打雕像，否則玩家。
    const aim = this.guardTarget ? this.guardTarget.getPosition() : playerPos;
    const dx = aim.x - this.anim.sprite.x;
    const dy = aim.y - this.anim.sprite.y;
    const dist = Math.hypot(dx, dy);

    // 面向目標（水平）。
    if (dx > 0.001) this.setFacing(1);
    else if (dx < -0.001) this.setFacing(-1);

    const detectPx = this.cfg.detectRange * PPU;
    const attackPx = this.cfg.attackRange * PPU;

    switch (this.state) {
      case 'damaged':
        this.timer -= dt;
        this.anim.play('damaged');
        if (this.timer <= 0) this.state = 'chase';
        break;

      case 'chase': {
        if (dist <= attackPx && this.canReachTarget(aim)) {
          // 進入攻擊距離 + 攻擊形狀確認搆得到 → 開始蓄力（否則不揮，繼續逼近/面向等下一幀）。
          this.state = 'charge';
          this.timer = this.cfg.chargeTime;
          this.anim.play('idle');
          // 用戶 #7：蓄力預警特效（貼敵人身前/腳下，出手時 destroy 接 slash）。純視覺。
          const cpos = this.getHitCenter();
          this.chargeFx =
            this.hitFeelFx?.enemyCharge?.(cpos.x, cpos.y, this.cfg.chargeTime * 1000) ?? null;
        } else if (dist <= detectPx && dist > 0.001) {
          this.moveChase(dx, dy, dt); // 追擊 + 分離力疊加（含 attackRange 內但形狀外→再逼近，根治空揮）
          this.anim.play('move');
        } else {
          this.anim.play('idle');
        }
        break;
      }

      case 'charge':
        this.timer -= dt;
        // 蓄力期間維持 idle 姿勢（別移動），時間到 → 進 attack 狀態出手。
        this.anim.play('idle');
        if (this.timer <= 0) {
          this.state = 'attack';
          this.attackAnimDone = false;
          this.fireAttack(aim); // 對準目標（守護波為雕像，否則玩家）出手
        }
        break;

      case 'attack':
        // 出手中：只播 attack 動畫，不做任何會覆蓋動畫的事（不移動、不改 play）。
        // 待 attack 動畫播完（attackAnimDone）→ 進 cooldown。
        if (this.attackAnimDone) {
          this.state = 'cooldown';
          this.timer = this.cfg.attackCooldown;
        }
        break;

      case 'cooldown':
        this.timer -= dt;
        // 冷卻期間仍會追（若玩家跑出攻擊距離）。
        if (dist > attackPx && dist <= detectPx && dist > 0.001) {
          this.moveChase(dx, dy, dt); // 追擊 + 分離力疊加
          this.anim.play('move');
        } else {
          this.anim.play('idle');
        }
        if (this.timer <= 0) this.state = 'chase';
        break;

      default:
        break;
    }
  }

  /** 出手：播 attack 動畫（一次性）並發出攻擊事件（近戰命中圓 / 射彈生成參數）。 */
  /** 揮前攻擊形狀確認：目標是否真在攻擊形狀內才揮，否則不揮（根治空揮，用戶試玩#2）。
   *  - 射彈敵人：朝目標拋射、無「短形狀搆不到」問題 → dist 已足夠，直接可揮。
   *  - 守護波打雕像：雕像大且不動、敵人圍攻、非空揮情境 → 直接可揮（不用玩家半徑低估）。
   *  - 近戰打玩家：用與實際命中同一套形狀（isPlayerInEnemyAttackShape）預判，形狀內才揮。 */
  private canReachTarget(aim: Vec2): boolean {
    if (this.cfg.attackKind !== 'melee') return true; // 射彈不受形狀短影響
    if (this.guardTarget) return true; // 打雕像不做玩家半徑低估
    return isPlayerInEnemyAttackShape(
      this.cfg.attack,
      this.getHitCenter(),
      this.facing,
      this.scaleFactor,
      aim,
      PLAYER_HIT_RADIUS * PPU,
    );
  }

  private fireAttack(playerPos: Vec2): void {
    // 用戶新#2：出手瞬間強制面向玩家那側（根治蓄力 0.5s 間玩家繞到另一側/dx≈0 卡背對）。
    // this.facing 供攻擊圓 offset 方向 + setFacing 更新視覺(setFacingEnemy)，兩者一致朝玩家。
    this.setFacing(attackFacing(playerPos.x, this.anim.sprite.x, this.facing));
    // 播 attack 一次性動畫；播完 → attackAnimDone，讓狀態機進 cooldown。
    this.anim.play('attack', {
      force: true,
      onComplete: () => {
        this.attackAnimDone = true;
      },
    });
    const pos = this.getHitCenter();
    const a = this.cfg.attack;

    // 用戶 #7：出手當下收掉蓄力預警、播揮擊斬光（rotation 對準玩家 aim 方向、生成偏敵人手前）。純視覺。
    this.clearChargeFx();
    const aimAngle = Math.atan2(playerPos.y - pos.y, playerPos.x - pos.x);
    const slashX = pos.x + Math.cos(aimAngle) * a.offsetX * PPU;
    const slashY = pos.y + Math.sin(aimAngle) * a.offsetX * PPU;
    this.hitFeelFx?.enemySlash?.(slashX, slashY, aimAngle, this.scaleFactor);

    if (this.cfg.attackKind === 'melee') {
      // 近戰圓形判定：offset 隨 perCharScale 放大（菁英大範圍）。
      const circle = buildAttackCircle(a, pos, this.facing, this.scaleFactor);
      this.onAttack?.({
        kind: 'melee',
        sourceName: this.cfg.characterKey,
        damage: a.damage,
        knockback: a.knockback,
        meleeCircle: { center: circle.center, radius: circle.radius },
      });
    } else {
      // 射彈：朝玩家方向，從身體前方生成。
      const dir = { x: playerPos.x - pos.x, y: playerPos.y - pos.y };
      const spawnX = pos.x + this.facing * a.offsetX * PPU;
      const spawnY = pos.y + a.offsetY * PPU;
      this.onAttack?.({
        kind: 'projectile',
        sourceName: this.cfg.characterKey,
        damage: a.damage,
        knockback: a.knockback,
        projectile: {
          x: spawnX,
          y: spawnY,
          dir,
          speedUnits: this.cfg.projectileSpeed ?? 8,
          radiusUnits: a.radius ?? 0.2,
        },
      });
    }
  }

  private setFacing(dir: number): void {
    if (dir === this.facing) return;
    this.facing = dir; // 保留正確 facing（攻擊 offset 方向用此，勿反）
    this.anim.setFacingEnemy(dir); // 只反轉視覺 flipX（敵人美術朝向相反，修倒著走 #2b）
  }

  /** 被玩家攻擊：扣血、hitStun 硬直、擊退。HP 歸 0 播 death 消失。 */
  takeHit(damage: number, knockback: number, fromPos: Vec2): void {
    if (this.dead || this.state === 'death') return;
    if (this.grabber) return; // grabber 衝來期間無敵（掙脫由 GrabSystem 處理，不走一般傷害）
    this.clearChargeFx(); // 用戶 #7：受擊中斷蓄力 → 清蓄力預警特效
    this.hp -= damage; // 數值即時（不受 hitFeel 影響）

    // 擊退方向：遠離攻擊來源。
    const dx = this.anim.sprite.x - fromPos.x;
    const dy = this.anim.sprite.y - fromPos.y;
    const len = Math.hypot(dx, dy) || 1;
    const immovable = this.cfg.immovable === true;

    // hitFeel 擊退「快進快出」：總距離 = clamp(force×forceScale, 0, knockbackDistance)×PPU，
    // 於 knockbackDuration 內線性推進。菁英(immovable) + hitStun 抗性 → 幾乎/完全不退（保留）。
    if (HIT_FEEL.enabled && !immovable) {
      const distPx = knockbackDistancePx(knockback, PPU) * this.cfg.hitStun; // hitStun 當抗性
      const dur = HIT_FEEL.knockbackDuration;
      this.knockbackRemaining = dur;
      this.knockbackPerSec = { x: (dx / len) * (distPx / dur), y: (dy / len) * (distPx / dur) };
    } else if (!immovable) {
      // hitFeel 關閉時的後備（基本擊退：舊式力道，於 0.18s 線性推進）。
      const kbPx = knockback * PPU * this.cfg.hitStun;
      this.knockbackRemaining = 0.18;
      this.knockbackPerSec = { x: (dx / len) * (kbPx / 0.18), y: (dy / len) * (kbPx / 0.18) };
    }

    // hitFeel 純視覺表演（不動數值）：白閃 + punch 彈跳 + 命中火花 + 局部頓幀。
    if (HIT_FEEL.enabled && this.hitFeelFx) {
      this.hitFeelFx.hitFlash(this.anim.sprite, HIT_FEEL.hitFlashColor, HIT_FEEL.hitFlashDuration);
      this.hitFeelFx.punchScale(this.anim.sprite, HIT_FEEL.punchScale);
      if (HIT_FEEL.hitSparkEnabled) {
        this.hitFeelFx.hitSpark(this.anim.sprite.x, this.anim.sprite.y, dx, dy, HIT_FEEL.hitSparkColor);
      }
    }
    if (HIT_FEEL.enabled && this.hp > 0) {
      this.freezeRemaining = Math.max(this.freezeRemaining, HIT_FEEL.microFreezeDuration);
    }

    if (this.hp <= 0) {
      this.die();
    } else {
      this.state = 'damaged';
      this.timer = this.cfg.hitStun;
      this.anim.play('damaged', { force: true });
    }
  }

  private die(): void {
    this.state = 'death';
    this.knockbackRemaining = 0;
    this.freezeRemaining = 0;
    // hitFeel 死亡金黃粒子（純視覺）。
    if (HIT_FEEL.enabled && this.hitFeelFx) {
      this.hitFeelFx.deathParticle(this.anim.sprite.x, this.anim.sprite.y, HIT_FEEL.deathParticleColor);
    }
    this.onKilled?.(this.cfg.characterKey, this.damageByPlayer, {
      x: this.anim.sprite.x,
      y: this.anim.sprite.y,
    }); // 擊殺事件 + 傷害歸屬 + 死亡位置(能量飛光起點)
    this.anim.play('death', {
      force: true,
      onComplete: () => {
        this.dead = true;
        this.anim.destroy();
      },
    });
  }
}
