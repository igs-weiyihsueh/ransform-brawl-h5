import Phaser from 'phaser';
import { getPerCharScale } from '@/config/animationConfig';
import { PLAYER_HIT_RADIUS } from '@/config/combatConfig';
import { ENEMY_AI, ENEMY_BODY_RADIUS_PX, ENEMY_BODY_CENTER_OFFSET_Y, type EnemyAIConfig } from '@/config/enemyConfig';
import { getResolvedEnemy } from '@/config/enemySchema';
import { PPU, GROUND_SQUASH_Y } from '@/config/gameConfig';
import { FOOT_GLOW } from '@/config/playerConfig';
import { effectiveEnemyPlayBounds, clampToBounds, insetBounds } from '@/config/mapConfig';
import { CharacterAnimator } from '@/systems/CharacterAnimator';
import {
  attackFacing,
  enemyAttackVfx,
  blockEliteAdvance,
  calculateSeparation,
  combineWithSeparation,
  pushOutOfPlayer,
  pushOutOfPlayerSmoothed,
  isChargeInvulnerable,
  shouldEnterCharge,
  SEPARATION_RADIUS_PX,
} from '@/systems/enemySeparation';
import { slotApproachDir, SLOT_REACH_THRESHOLD_PX, TRAVELER_AVOID_WEIGHT } from '@/systems/surroundSlots';
import { getPlayerSolver } from '@/config/surroundConfig';
import {
  buildAttackCircle,
  isPlayerInEnemyAttackShape,
  type Hittable,
  type Vec2,
} from '@/systems/hitDetection';
import { knockbackDistancePx } from '@/config/hitFeelConfig';
import { getResolvedHitFeel } from '@/config/hitFeelSchema';
import { ENTRANCE_TRANSFORM } from '@/systems/entranceTransformMath';
import { stepTowardNode } from '@/systems/formationMath';

/**
 * ★塔專屬「碰撞半徑」預設（省略 preset.towerCollisionRadiusPx 時 game-side 走此，非沿用怪 ENEMY_BODY_RADIUS_PX×scale）。
 * 變身-leader 定案：塔是「立地結構」語意 ≠ 怪，該有塔自己的預設；且 (乙) 全遊戲貼地圓盤後縱深有效擋距 = 半徑×GROUND_SQUASH_Y(0.5)，
 * 塔若沿用怪半徑 67.5 → 縱深僅 ~34px「扁扁一條、不像塔基實擋」＝沒填欄位就微妙壞掉的 footgun。
 * 110 為 headed 實測值（縱深 ~55px 才像塔基有感實擋，量出來非拍腦袋）。仍完全可被 preset/用戶 towerCollisionRadiusPx 覆寫。
 */
export const TOWER_DEFAULT_COLLISION_RADIUS_PX = 110;

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
  enemyFan?(x: number, y: number, angleRad: number, scale?: number): void;
  enemyImpact?(x: number, y: number, scale?: number): void;
  enemyCharge?(x: number, y: number, durationMs?: number, diskPx?: number): Phaser.GameObjects.Image | null;
  /** 用戶 #3 圓形範圍攻擊特效（純視覺；菁英蓄力改 Graphics 貼地壓扁圓盤，不自轉）。 */
  enemyAoeRing?(x: number, y: number, radiusPx: number): Phaser.GameObjects.Graphics | null;
  /** ★菁英蓄力圓盤「由內而外紅填充」每幀重畫（progress 0~1＝蓄力進度，填滿=發招）。純視覺、貼地壓扁不自轉。 */
  redrawEnemyAoeRing?(g: Phaser.GameObjects.Graphics, radiusPx: number, progress: number): void;
  enemyAoeBurst?(x: number, y: number, radiusPx: number): void;
  /** ★技能三層：子彈命中爆點（fx_enemy_bullet_hit，配子彈色 tint）。純視覺。 */
  enemyBulletHit?(x: number, y: number, tint?: number, scale?: number): void;
  /** ★技能三層：子彈貼圖 key（Projectile 用；沒載回 undefined 退 Arc 佔位）。 */
  getEnemyBulletTextureKey?(): string | undefined;
  /** ★命中分級（第 3 塊 HitEffectPackage，純表現層）：依 tier 播 light/mid/heavy 命中特效。 */
  playHitEffect?(x: number, y: number, tier: 'light' | 'mid' | 'heavy', tint?: number): void;
  /** ★魔尖塔環狀技（C9 拆兩特效，貼地壓扁 annulus）：預警（紅填充+脈動危險感）+ 攻擊（能量迸發衝擊）。thicknessPx=環帶厚。 */
  towerRingWarning?(x: number, y: number, diameterPx: number, thicknessPx: number, durationMs: number): void;
  towerRingActive?(x: number, y: number, diameterPx: number, thicknessPx: number, durationMs: number): void;
}

/** 敵人可用的角色美術 key（debug 預覽用循環選擇）。 */
export const ENEMY_CHARACTERS = ['Enemy_Rush', 'Enemy_Ranged', 'Enemy_Elite'] as const;

/**
 * 十五輪（用戶決定）：攻擊範圍尺寸固定＝攻擊 config，不隨體型 scale 縮放。
 * 傳給 build*Attack* / isPlayerInEnemyAttackShape 的 sizeScale＝此值（1），使「放大隻怪不會打更遠」。
 * 視覺 sprite(setScaleFactor)+身體 radiusPx+攻擊起點 offset 位置仍維持 scaleFactor（怪的圖/身體變大小、攻擊發起點對變大的身體）。
 */
const ATTACK_SIZE_SCALE = 1;

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
  private maxHp: number;
  /** 尖塔環狀技參數覆寫（TowerWave 節點設定，spawnTower 套用；null＝用 config.ringSkill）。 */
  private ringSkillOverride: {
    ringCount: number;
    baseRadiusPx: number;
    radiusStepPx: number;
    ringIntervalSec: number;
    ringThicknessPx: number;
    energyCost: number;
    warningSec: number;
    vacuumRadiusPx?: number;
  } | null = null;
  private radiusPx: number; // body 碰撞/推擠半徑（真空帶）；塔可由 setTowerCollisionRadius 覆寫（故非 readonly）
  /** ★塔碰撞圓圓心偏移（towerCollisionOffsetXPx/YPx，用戶微調）；碰撞圓心＝塔視覺塔基底 + 此 offset。 */
  private towerCollisionOffset: Vec2 = { x: 0, y: 0 };
  /**
   * ★塔「視覺塔基底」screen Y（不透明素材底邊，非 frame 腳底錨點）——spawn 時讀 alpha bounds 算一次 cache（非每幀）。
   * 塔素材底部常有透明 padding，frame 腳底錨點(sp.y)落在 padding 底＝比視覺塔基低 bottomPad×scale；
   * 碰撞/環圓心用此才貼「塔真正站的地面」。null＝未算（fallback 走 getTowerRingGroundCenter 腳底）。
   */
  private towerVisualBaseY: number | null = null;
  /** ★塔碰撞範圍可視圈（貼地壓扁橢圓，半徑=towerCollisionRadiusPx）：用戶要遊戲裡一眼看到塔碰撞範圍。 */
  private towerCollisionRing: Phaser.GameObjects.Graphics | null = null;

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
  /** ★小怪蓄力身體閃紅 tint 呼吸 tween（進 charge 建、出手/取消/死亡清）。 */
  private chargeTintTween: Phaser.Tweens.Tween | null = null;
  /** 用戶 #3：圓形範圍攻擊預告圈（菁英蓄力，改 Graphics 貼地壓扁圓盤；出手/離開 destroy）。 */
  private aoeRingFx: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics | null = null;
  /** ★菁英蓄力圓盤半徑（建立時存，供 syncChargeFx 每幀按蓄力進度重畫由內而外紅填充）。 */
  private aoeRingRadiusPx = 0;

  /** 局部頓幀剩餘秒數（hitFeel microFreeze，只凍被打這隻：>0 時 update 早退不動作）。 */
  private freezeRemaining = 0;

  /**
   * 十六輪①：蓄力站定錨點——進 charge 當下記錄位置，charge 期間每幀鎖回，防外力(de-overlap/slot/追擊殘留)
   * 讓怪蓄力中移動追人。null=非蓄力中。完成/取消/離開 charge 清 null。
   */
  private chargeAnchor: Vec2 | null = null;

  /** 十六輪(5項)③：無目標遊走——當前遊走方向(單位向量)+重選方向倒數(秒)。 */
  private wanderDir: Vec2 = { x: 1, y: 0 };
  private wanderRetargetSec = 0;
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

  /** 守護波目標覆蓋：設定後 AI 追/打此目標而非玩家；清除(null)回玩家。含判定半徑/中心供 canReach 形狀判定(七輪#3)。 */
  private guardTarget: { getPosition(): Vec2; getHitCenter?(): Vec2; getHitRadius?(): number } | null = null;

  /** 設定/清除守護目標覆蓋（守護波開始設雕像、結束清回玩家）。 */
  setGuardTarget(target: { getPosition(): Vec2; getHitCenter?(): Vec2; getHitRadius?(): number } | null): void {
    this.guardTarget = target;
  }

  /** 本幀其他敵人位置（EnemySpawner 每幀在 update 前設；供 separation 用）。 */
  private neighbors: readonly Vec2[] = [];

  /** 設定本幀鄰居（其他存活敵人位置，不含自己）。 */
  setNeighbors(others: readonly Vec2[]): void {
    this.neighbors = others;
  }

  // --- surround 環繞槽位（征騎，整合六輪）：EnemySpawner 每幀協調 claim 槽 → setSlotTarget ---

  /** 敵人唯一 id（供 SurroundSlotManager 佔用表 key；每隻遞增）。 */
  readonly id: number = Enemy.nextId++;
  private static nextId = 1;

  /**
   * 本幀槽位環繞目標（EnemySpawner 每幀協調後設）：
   *  - slotPos：已 claim 到的槽世界座標（像素）→ chase 用 slotApproachDir 繞圈趨近它。
   *  - slotRingCenter：環中心（真空圈中心）→ 繞圈趨近的圈心參考。
   *  - null：未 claim（或全滿/目標不可環繞）→ fallback 現有 moveChase 分離力追擊。
   */
  private slotPos: Vec2 | null = null;
  private slotRingCenter: Vec2 | null = null;

  /** 設定本幀槽位目標（EnemySpawner 協調後每幀呼叫；null=無槽走 fallback）。 */
  setSlotTarget(slotPos: Vec2 | null, ringCenter: Vec2 | null): void {
    this.slotPos = slotPos;
    this.slotRingCenter = ringCenter;
  }

  /**
   * ★陣型控制旗標（怪物 AI 第 2 塊）：true 時此怪由 EnemyFormation 驅動（followFormationNode）、
   *  EnemySpawner 不呼 e.update（＝不各自 chase）；解除陣型設 false → 回 e.update 乾淨 chase。
   */
  private formationControlled = false;
  setFormationControlled(v: boolean): void {
    // 解除陣型：清蓄力態保險（雖 followFormationNode 進入已清；解除當幀也確保中性）。
    if (this.formationControlled && !v && this.state === 'charge') {
      this.clearChargeFx();
      this.chargeAnchor = null;
      this.state = 'chase';
      this.timer = 0;
    }
    this.formationControlled = v;
  }
  isFormationControlled(): boolean {
    return this.formationControlled;
  }

  /**
   * 槽位環繞的起始層（Unity minLayer）：菁英(immovable 大體型)=2 排外圈不佔內圈；小怪=0 內圈優先。
   * EnemySpawner claim/遞補時讀此。
   */
  getSurroundMinLayer(): number {
    return this.cfg.immovable === true ? 2 : 0;
  }

  /** 本幀是否已到槽附近（dist<threshold）：EnemySpawner 供 debug / 內層遞補節流參考。 */
  isAtSlot(threshold = 10): boolean {
    if (!this.slotPos) return false;
    const dx = this.slotPos.x - this.anim.sprite.x;
    const dy = this.slotPos.y - this.anim.sprite.y;
    return Math.hypot(dx, dy) < threshold;
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
    // 七輪#1：grabber（抓人者）是 GrabSystem 專屬驅動的特殊態（無敵/暫停一般 AI/不走環繞）——
    //   也不受一般真空分離推出，否則觸碰基準(grabberR+playerHitRadius 40) 被推出基準(grabberR+vacuumRadius 50)
    //   每幀推到觸碰範圍外 → 左右晃抓不到。補齊 grabber 例外（對齊環繞協調 line138 的 isGrabber 排除），抓取全交 GrabSystem。
    if (this.grabber) return;
    if (isChargeInvulnerable(this.state, this.cfg.immovable === true)) return; // 六輪#3：菁英蓄力免疫被推(站定)
    // 十六輪④真修：任何怪(含非菁英)蓄力中免疫被玩家推(站定)——配合③ chargeAnchor 鎖定，charge 中怪真的不移動，
    //   則 chargeFx(charge 每幀 syncChargeFx)恆貼合怪位置、不分離。真因=舊只菁英免疫→非菁英 charging 被玩家撞推走、
    //   fx 留在 anchor(update 後 spawner 才推、那幀沒再 sync)→用戶實測特效分離。
    if (this.state === 'charge') return;
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
        // ContactSolver 階段②：playerSolver==='contactSolver' → 用平滑版（單幀上限+鬆弛，防深度重疊瞬移）；
        //   legacy → 原硬頂版（一次頂到 minDist，不變）。
        const fixed = getPlayerSolver() === 'contactSolver'
          ? pushOutOfPlayerSmoothed(
              { x: this.anim.sprite.x, y: this.anim.sprite.y },
              p.pos,
              minDist,
            )
          : pushOutOfPlayer(
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
    // 第四輪#1：下界改用面板感知 ENEMY_PLAY_BOUNDS（怪底邊停面板上緣、不擦進下方面板）。
    // ★block-offset：用 effectiveEnemyPlayBounds()（已套當前 levelOffsetX），怪在當前區塊內夾限、不被拉回原點。
    const bounds = insetBounds(effectiveEnemyPlayBounds(), this.radiusPx);
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
    if (isChargeInvulnerable(this.state, this.cfg.immovable === true)) return; // 六輪#3：菁英蓄力免疫被推(站定)
    const minDist = radiusPx + this.radiusPx;
    const fixed = pushOutOfPlayer(
      { x: this.anim.sprite.x, y: this.anim.sprite.y },
      center,
      minDist,
    );
    this.anim.sprite.x = fixed.x;
    this.anim.sprite.y = fixed.y;
  }

  /**
   * 追擊移動（整合 surround，征騎；七輪#7 到槽後逼近攻擊範圍）：
   *  - 有槽位目標（slotPos）→ 繞圈趨近該槽（slotApproachDir）；到槽後**若離目標 body 仍 > 攻擊範圍**
   *    （shouldApproachAfterSlot）→ 繼續朝 aim(玩家 body)逼近到 attackRange 內才停（slot 給環繞骨架、不擋進攻，
   *    修 #7 外圈槽半徑>攻擊範圍→卡 chase 不打）；已在攻擊範圍內 → 停在槽。
   *  - 無槽 → fallback 原分離力直線追擊。
   */
  private moveChase(aimDx: number, aimDy: number, dt: number): void {
    const speedPx = this.cfg.moveSpeed * PPU;
    const selfPos = { x: this.anim.sprite.x, y: this.anim.sprite.y };
    const sepR = this.separationRadiusPx(); // 十五輪回歸修②：separation 半徑隨 body scale（大菁英避讓區更大）

    if (this.slotPos && this.slotRingCenter) {
      const ddx = this.slotPos.x - selfPos.x;
      const ddy = this.slotPos.y - selfPos.y;
      const atSlot = Math.hypot(ddx, ddy) < SLOT_REACH_THRESHOLD_PX;
      // 七輪#3 治本(decision 34b0be5b)：停止基準＝攻擊基準。到槽後「攻擊 shape 已涵蓋目標(canReachTarget)」才停；
      //   否則繼續朝目標 body 逼近，進到攻擊 shape 內才停 → 停下必能打(不再停在搆不到處空轉，含正上/下方)。
      if (atSlot) {
        const aim = { x: selfPos.x + aimDx, y: selfPos.y + aimDy }; // 還原目標絕對座標供攻擊 shape 判定
        if (this.canReachTarget(aim)) return; // 攻擊 shape 已涵蓋→停在槽
        // 到槽但攻擊 shape 搆不到 → 直接朝目標 body 逼近(疊分離力)，進攻擊 shape 才停。
        const sep = calculateSeparation(selfPos, this.neighbors, sepR);
        const dir = combineWithSeparation({ x: aimDx, y: aimDy }, sep);
        this.anim.sprite.x += dir.x * speedPx * dt;
        this.anim.sprite.y += dir.y * speedPx * dt;
        return;
      }
      // 未到槽：繞圈趨近方向 + 趕路避讓（較高 separation weight 繞開彼此）。
      const approach = slotApproachDir(selfPos, this.slotRingCenter, this.slotPos);
      const sep = calculateSeparation(selfPos, this.neighbors, sepR);
      const dir = combineWithSeparation(approach, sep, TRAVELER_AVOID_WEIGHT);
      this.anim.sprite.x += dir.x * speedPx * dt;
      this.anim.sprite.y += dir.y * speedPx * dt;
      return;
    }

    // fallback：無槽 → 原分離力直線追擊。
    const sep = calculateSeparation(selfPos, this.neighbors, sepR);
    const dir = combineWithSeparation({ x: aimDx, y: aimDy }, sep);
    this.anim.sprite.x += dir.x * speedPx * dt;
    this.anim.sprite.y += dir.y * speedPx * dt;
  }

  /**
   * 十五輪回歸修②：soft-separation 避讓半徑隨 body scale。
   * 原 SEPARATION_RADIUS_PX=60px 對大菁英(scale4 body radius 180、直徑 360)遠小於體型→ soft 避讓幾乎不作用，
   * 只剩 hard de-overlap 硬解→大菁英趨近雕像時擠團互推。改為 base(60) + 自己 body 半徑：大菁英提早繞開彼此，
   * 環繞趨近時避讓足不擠團。基準怪 radiusPx=45 → 60+45=105（略增，仍溫和），大菁英隨體型放大。
   */
  private separationRadiusPx(): number {
    return SEPARATION_RADIUS_PX + this.radiusPx;
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
    // 六輪 enemies JSON 化：override(enemy-editor 套用)優先 + cache，無/壞→打包預設 ENEMY_AI。
    this.cfg = getResolvedEnemy(charKey) ?? getResolvedEnemy(ENEMY_CHARACTERS[0]) ?? ENEMY_AI[ENEMY_CHARACTERS[0]];
    // 第十輪#3：體型縮放 override 優先（?? 非 ||，scale=0... 實務不會但保 0-nullish 一致），舊資料無 scale → getPerCharScale fallback。
    this.scaleFactor = this.cfg.scale ?? getPerCharScale(this.cfg.characterKey);
    this.anim = new CharacterAnimator(scene, this.cfg.characterKey, x, y);
    // 十五輪：視覺縮放套 scaleFactor override（與判定 radiusPx 同一 factor，調 enemy-editor scale 圖+判定一起變）。
    // 無 override 時 scaleFactor=getPerCharScale → setScaleFactor(getPerCharScale)=SPRITE_SCALE×getPerCharScale=原本值。
    this.anim.setScaleFactor(this.scaleFactor);
    // 第三大輪#1 回歸根治：出生就同步視覺面向 = 資料 facing(預設 1)。
    // 否則 setFacing 的 early-return(dir===facing) 會讓「首次朝右(=預設 1)追玩家」永遠不呼 setFacingEnemy，
    // enemyFacing 停在 null → play('move') 不套 flipX → sprite 用預設 flipX=false → 背對。
    // 這裡強制初始化，使 enemyFacing≠null 且 flipX 與 facing 一致(enemyFlipForAnim)，從出生第一幀就正確。
    this.anim.setFacingEnemy(this.facing);
    this.hp = this.cfg.hp;
    this.maxHp = this.cfg.hp;
    this.radiusPx = ENEMY_BODY_RADIUS_PX * this.scaleFactor; // 可視 body 半徑(用戶#1#2a根治), 取代 256 frame 半徑
    // 魔尖塔尖塔怪：★用戶定案——不用美術圖 fx_tower_spire（碰撞圈對不上頭重腳輕/透明 padding），
    //   改畫「錐狀色塊」（Graphics 生成 texture，無透明 padding→視覺塔基＝色塊底＝腳底錨點，碰撞圈對得上所見即所得）。
    //   origin 底部中心(0.5,1.0) 站地固定物；靜態模式 play() no-op。碰撞判定不變（getBodyRadius/getTowerCollisionCenter 照舊）。
    if (this.isTower()) {
      const coneKey = Enemy.ensureTowerConeTexture(this.anim.sprite.scene);
      this.anim.setStaticTexture(coneKey, 0.5, 1.0);
      this.anim.sprite.setScale(1.0);
      this.computeTowerVisualBaseY(); // 色塊無 padding → 視覺塔基底≈腳底（alpha 讀到色塊底），碰撞圈對得上
      this.drawTowerCollisionRing(); // ★初畫碰撞範圍圈（GameScene 隨後 setTowerCollisionRadius/Offset 會再重畫更新）
    }
  }

  /**
   * ★塔「錐狀色塊」texture 生成（用戶定案：換掉美術圖，色塊是我們畫的、碰撞圈能對上）：
   * 梯形/錐狀（上窄下寬）色塊代表塔身，★底邊貼滿 frame 底（無透明 padding）→ 視覺塔基＝色塊底＝腳底錨點。
   * 一張共用 texture（key 固定），已存在則直接回 key（不重生）。純視覺示意，尺寸沿用原塔 frame 感（192×320）。
   */
  private static ensureTowerConeTexture(scene: Phaser.Scene): string {
    const key = 'tower-cone-block';
    if (scene.textures.exists(key)) return key;
    const W = 192;
    const H = 320;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const cxp = W / 2;
    const topW = W * 0.34; // 塔身頂寬
    const bodyTopY = 40; // 塔身梯形頂 y（上方留給尖頂）
    // 塔身梯形（上窄下寬，底邊貼 frame 底 y=H＝無透明 padding）
    g.fillStyle(0x6b6f8c, 1);
    g.fillPoints([
      { x: cxp - topW / 2, y: bodyTopY },
      { x: cxp + topW / 2, y: bodyTopY },
      { x: W, y: H },
      { x: 0, y: H },
    ], true);
    // 塔頂魔能尖（三角，紫）
    g.fillStyle(0x9b5cff, 1);
    g.fillTriangle(cxp - topW / 2, bodyTopY, cxp + topW / 2, bodyTopY, cxp, 0);
    // 亮邊描塔身輪廓
    g.lineStyle(4, 0xb9bee0, 1);
    g.strokePoints([
      { x: cxp - topW / 2, y: bodyTopY },
      { x: cxp + topW / 2, y: bodyTopY },
      { x: W, y: H },
      { x: 0, y: H },
    ], true, true);
    g.generateTexture(key, W, H);
    g.destroy();
    return key;
  }

  /**
   * ★算「視覺塔基底」screen Y 並 cache 進 towerVisualBaseY（spawn 一次、非每幀 getImageData）：
   * 讀塔素材不透明 alpha bounds 的底邊（opaqueMaxY），換算 = frameTop + opaqueMaxY/texH × displayHeight
   * = 腳底錨點 − bottomPad×(displayHeight/texH)。塔素材底常有透明 padding，用此圓心才貼塔真正站的地面。
   * ★fallback：texture 未載/讀不到/canvas 失敗/算出 NaN → towerVisualBaseY 留 null，getter 退回腳底 getTowerRingGroundCenter（不 NaN/不爆）。
   */
  private computeTowerVisualBaseY(): void {
    this.towerVisualBaseY = null; // 預設 null＝fallback 腳底
    try {
      const sp = this.anim.sprite;
      const scene = sp.scene;
      const texKey = sp.texture?.key;
      if (!texKey || !scene?.textures?.exists(texKey)) return; // texture 未載 → fallback
      const src = scene.textures.get(texKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      const texW = (src as { width?: number }).width ?? 0;
      const texH = (src as { height?: number }).height ?? 0;
      if (texW <= 0 || texH <= 0) return;
      const cv = document.createElement('canvas');
      cv.width = texW; cv.height = texH;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      if (!cx) return;
      cx.drawImage(src as CanvasImageSource, 0, 0);
      const data = cx.getImageData(0, 0, texW, texH).data;
      const ALPHA = 16; // 視為不透明的 alpha 門檻
      let opaqueMaxY = -1;
      for (let y = texH - 1; y >= 0 && opaqueMaxY < 0; y -= 1) {
        for (let x = 0; x < texW; x += 1) {
          if (data[(y * texW + x) * 4 + 3] > ALPHA) { opaqueMaxY = y; break; }
        }
      }
      if (opaqueMaxY < 0) return; // 全透明 → fallback
      const originY = sp.originY ?? 1.0;
      const dh = sp.displayHeight || 0;
      if (dh <= 0) return;
      const frameTop = sp.y - originY * dh; // origin 1.0→sp.y-dh；一般 origin 亦成立
      const baseY = frameTop + (opaqueMaxY + 1) / texH * dh; // 不透明底邊對應 screen Y
      if (Number.isFinite(baseY)) this.towerVisualBaseY = baseY;
    } catch {
      this.towerVisualBaseY = null; // 任何例外 → fallback 腳底，不爆
    }
  }

  isDead(): boolean {
    return this.dead;
  }

  /** 用戶 #7/#3：清掉蓄力預警 + AOE 預告圈特效（出手/受擊/死亡時，避免殘留）。 */
  private clearChargeFx(): void {
    if (this.chargeFx) {
      this.chargeFx.destroy();
      this.chargeFx = null;
    }
    if (this.aoeRingFx) {
      this.aoeRingFx.destroy();
      this.aoeRingFx = null;
    }
    this.clearChargeTint(); // ★清小怪蓄力身體閃紅 tint
  }

  /**
   * ★小怪蓄力身體閃紅（大更；用戶回饋太強→減弱）：sprite 淡紅 tint 0xff8888 + 輕微 alpha 呼吸（幅度小）。
   * 蓄力期間持續；出手瞬間 flashChargeTintOnFire() 閃亮一下再清；出手/取消/死亡 clearChargeTint。
   */
  private startChargeTint(): void {
    const sp = this.anim.sprite;
    sp.setTint(0xff8888); // 減弱：0xff4444→0xff8888（淡紅、不那麼強烈）
    this.chargeTintTween?.stop();
    this.chargeTintTween = sp.scene.tweens.add({
      targets: sp, alpha: { from: 1, to: 0.85 }, duration: 260, yoyo: true, repeat: -1, ease: 'Sine.inOut', // 呼吸幅度縮小 0.6→0.85
    });
  }

  /** ★出手瞬間：身體閃亮一下（alpha 拉滿）再清 tint，作為蓄力結束的爆發提示。 */
  private flashChargeTintOnFire(): void {
    const sp = this.anim.sprite;
    this.chargeTintTween?.stop();
    this.chargeTintTween = null;
    sp.setAlpha(1);
    sp.setTint(0xffffff); // 閃亮白一下
    sp.scene.tweens.add({
      targets: sp, alpha: 1, duration: 90, ease: 'Sine.easeOut',
      onComplete: () => sp.clearTint(),
    });
  }

  /** ★清小怪蓄力身體 tint（出手/取消/死亡）：停呼吸 tween、還原 alpha、清 tint。 */
  private clearChargeTint(): void {
    if (this.chargeTintTween) {
      this.chargeTintTween.stop();
      this.chargeTintTween = null;
    }
    const sp = this.anim.sprite;
    sp.setAlpha(1);
    sp.clearTint();
  }

  /**
   * 六輪#11：蓄力特效每幀跟隨怪當前位置（怪蓄力期被推開/擠開→特效跟著移動，不留原地）。
   * chargeFx=腳底法陣盤（footY=body 中心下方 radiusPx×1.7，與建立時同式，不寫死）；
   * aoeRingFx=AOE 預警圈（圓心=視覺 body 中心，同五輪#4）。只更新位置，depth/壓扁/旋轉等視覺（EffectSystem 設）不動。
   */
  private syncChargeFx(): void {
    if (this.chargeFx) {
      const cpos = this.getHitCenter();
      this.chargeFx.setPosition(cpos.x, cpos.y + this.radiusPx * 1.7);
    }
    if (this.aoeRingFx) {
      const center = this.getBodyCenter();
      this.aoeRingFx.setPosition(center.x, center.y);
      // ★菁英蓄力「由內而外紅填充」＝蓄力進度：progress = 已蓄力/總蓄力（timer 從 chargeTime 倒數）。
      //   填滿(progress→1) 那刻＝發招。每幀重畫（Graphics 才能，貼地壓扁不自轉）。
      const total = this.cfg.chargeTime > 0 ? this.cfg.chargeTime : 1;
      const progress = Math.min(1, Math.max(0, 1 - this.timer / total));
      if (this.aoeRingFx instanceof Phaser.GameObjects.Graphics) {
        this.hitFeelFx?.redrawEnemyAoeRing?.(this.aoeRingFx, this.aoeRingRadiusPx, progress);
      }
    }
  }

  /** 十六輪④安全帶：spawner 所有推力/clamp 之後，對蓄力中怪再補一次 chargeFx sync（保證特效恆貼合怪位置，不分離）。 */
  syncChargeFxAfterMove(): void {
    if (this.state === 'charge') this.syncChargeFx();
  }

  /** 立即銷毀（守護波 cleanup ClearAllActiveEnemies 用，不播死亡動畫、不觸發 onKilled）。 */
  forceDestroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.state = 'death';
    this.clearChargeFx();
    this.towerCollisionRing?.destroy(); // ★清塔碰撞範圍可視圈
    this.towerCollisionRing = null;
    this.anim.destroy();
  }

  getHitCenter(): Vec2 {
    return { x: this.anim.sprite.x, y: this.anim.sprite.y };
  }

  /**
   * 視覺 body 中心（五輪#4）：sprite 幾何中心往下偏 ENEMY_BODY_CENTER_OFFSET_Y×perCharScale 到「可見 body 中心」。
   * 範圍攻擊圓心（預警圈/爆發/傷害判定）用此，讓菁英/近戰在圈正中央（sprite frame 上方留白造成幾何中心偏上）。
   */
  getBodyCenter(): Vec2 {
    return { x: this.anim.sprite.x, y: this.anim.sprite.y + ENEMY_BODY_CENTER_OFFSET_Y * this.scaleFactor };
  }

  /**
   * 尖塔環狀技 VFX 圓心（C7）：塔用 setStaticTexture('fx_tower_spire', 0.5, 1.0)＝底部錨點（originY=1.0），
   * 故 sprite.y 是塔「腳底」而非中心；環要畫在塔**視覺中心**（腳底往上半個顯示高度），才對準塔本體正中央。
   * 非塔時 fallback getHitCenter（不影響其他怪）。
   */
  getTowerRingCenter(): Vec2 {
    const sp = this.anim.sprite;
    const originY = sp.originY ?? 1.0;
    const h = sp.displayHeight || 0;
    // 視覺中心 Y = sprite.y - (originY - 0.5) * displayHeight（origin 1.0 → 上移半高；origin 0.5 → 不動）。
    return { x: sp.x, y: sp.y - (originY - 0.5) * h };
  }

  /**
   * 尖塔環狀技「貼地圓盤」圓心（環改貼地壓扁後）：塔**底部（腳底/站的地面點）**——環以此為圓心往地面擴，才真的貼地不浮空。
   * 塔 originY=1.0（底部錨點）→ 腳底 = sprite.y；一般 origin 用 sp.y + (1-originY)*displayHeight 推回底邊。
   */
  getTowerRingGroundCenter(): Vec2 {
    const sp = this.anim.sprite;
    const originY = sp.originY ?? 1.0;
    const h = sp.displayHeight || 0;
    return { x: sp.x, y: sp.y + (1 - originY) * h }; // origin 1.0 → sp.y（腳底）
  }

  /**
   * ★塔「視覺塔基底」圓心（碰撞 + C7 環共用同源，變身-leader 定案修法 A）：
   * = { x: sprite.x, y: towerVisualBaseY }（spawn 算好的不透明素材底邊 screen Y）。
   * towerVisualBaseY 未算/fallback（texture 未載等）→ 退回 getTowerRingGroundCenter（腳底），不 NaN。
   * ★語意：塔真正站的地面點（非 frame 腳底錨點在透明 padding 底、比視覺塔基低 bottomPad）。
   */
  getTowerVisualBaseCenter(): Vec2 {
    const sp = this.anim.sprite;
    if (this.towerVisualBaseY == null) return this.getTowerRingGroundCenter(); // fallback 腳底
    return { x: sp.x, y: this.towerVisualBaseY };
  }

  /**
   * 尖塔「物件半徑」（環以塔物件大小為中心/包住塔用）：塔顯示尺寸的半寬/半高取大者。
   * 用於環最內圈 baseRadius 下限——讓最內環從塔物件邊緣往外、把塔物件包住（不穿過塔身）。
   */
  getTowerObjectRadius(): number {
    const sp = this.anim.sprite;
    const w = sp.displayWidth || 0;
    const h = sp.displayHeight || 0;
    return Math.max(w, h) / 2;
  }

  getHitRadius(): number {
    return this.radiusPx;
  }

  /** 是否為 immovable 菁英（像牆；EnemySpawner 用來決定玩家撞它時把玩家擋在外）。 */
  isImmovable(): boolean {
    return this.cfg.immovable === true;
  }

  /**
   * 第八輪#4：敵-敵 de-overlap 是否可被推移。
   * false（像牆不被推、只推別人）：immovable 菁英 / 蓄力免疫中的菁英（六輪#3，蓄力站定不被擠走）。
   * true：一般敵人（會被推開解重疊）。（grabber/dead 由呼叫端過濾，不進 de-overlap。）
   */
  isSeparationMovable(): boolean {
    const immovable = this.cfg.immovable === true;
    if (immovable) return false;
    if (isChargeInvulnerable(this.state, immovable)) return false;
    // 十六輪①：蓄力站定——任何怪(含非菁英)蓄力中不被 de-overlap 推移，配合 charge 位置鎖=真正站定不被拖走。
    if (this.state === 'charge') return false;
    return true;
  }

  // --- grabber（抓人者，用戶試玩#4，由 GrabSystem 驅動） ---

  /** 設為 grabber（true=開始抓人：暫停一般 AI、無敵、由 GrabSystem 追玩家）。 */
  setGrabber(on: boolean): void {
    this.grabber = on;
    if (!on) this.grabberLocked = false;
    // 七輪#2：轉抓人態放棄蓄力 → 收蓄力特效（否則 grabber branch early-return 跳過 clear → 特效留原地）。
    //   對齊 die()/fireAttack 出手/canReach-fail 打斷的 clearChargeFx 慣例（轉 grabber 態也進 clear 路徑）。
    if (on) this.clearChargeFx();
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
    const hf = getResolvedHitFeel();
    this.knockbackRemaining = hf.knockbackDuration;
    const distPx = knockbackDistancePx(2, PPU, hf); // 掙脫擊退固定力道
    this.knockbackPerSec = { x: (dx / len) * (distPx / hf.knockbackDuration), y: (dy / len) * (distPx / hf.knockbackDuration) };
    this.state = 'chase'; // 解除後回一般 AI
  }

  /**
   * 用戶#3：變身進場落地震退——以落點為中心把周圍怪往外推（衝擊波）。immovable 菁英/死亡/蓄力 不被震。
   * @param fromPos 落點中心。@param distUnits 推進距離 unit（預設 ENTRANCE_TRANSFORM.knockbackDistUnits）。
   */
  applyLandingKnockback(fromPos: Vec2, distUnits: number = ENTRANCE_TRANSFORM.knockbackDistUnits): void {
    if (this.dead || this.state === 'death') return;
    if (this.cfg.immovable === true) return; // 菁英像牆不被震
    if (this.state === 'charge') return; // 蓄力站定不被震（對齊 resolvePenetration/isSeparationMovable charge 豁免）
    const dx = this.anim.sprite.x - fromPos.x;
    const dy = this.anim.sprite.y - fromPos.y;
    const len = Math.hypot(dx, dy) || 1;
    const hf = getResolvedHitFeel();
    const dur = hf.knockbackDuration;
    const distPx = distUnits * PPU;
    this.knockbackRemaining = dur;
    this.knockbackPerSec = { x: (dx / len) * (distPx / dur), y: (dy / len) * (distPx / dur) };
    this.stunRemaining = Math.max(this.stunRemaining, dur); // 震開期間壓制追擊（乾淨往外推）
    this.state = 'chase';
  }

  getCharacterKey(): string {
    return this.cfg.characterKey;
  }

  /** 是否為尖塔怪（有 ringSkill 設定＝魔尖塔的塔，固定不動、週期放環狀技）。 */
  isTower(): boolean {
    return this.getRingSkill() != null;
  }

  /** 尖塔環狀技參數（非尖塔回 null）。對齊波騎 RingSkillParams 欄位。 */
  getRingSkill(): {
    ringCount: number;
    baseRadiusPx: number;
    radiusStepPx: number;
    ringIntervalSec: number;
    ringThicknessPx: number;
    energyCost: number;
    warningSec: number;
  } | null {
    if (this.ringSkillOverride) return this.ringSkillOverride;
    if (!this.cfg.ringSkill) return null;
    // config 的 ringSkill 可能沒 warningSec（舊 config）→ 補預設 0.5。
    return { warningSec: 0.5, ...this.cfg.ringSkill };
  }

  /** 覆寫環狀技參數（TowerWave 節點 ringSkill 由 spawnTower 套用；缺欄沿用 config）。 */
  setRingSkillOverride(ring: {
    ringCount?: number;
    baseRadiusPx?: number;
    radiusStepPx?: number;
    ringIntervalSec?: number;
    ringThicknessPx?: number;
    energyCost?: number;
    warningSec?: number;
    vacuumRadiusPx?: number;
  }): void {
    const base = this.cfg.ringSkill ?? {
      ringCount: 3, baseRadiusPx: 90, radiusStepPx: 120, ringIntervalSec: 0.6, ringThicknessPx: 40, energyCost: 2,
    };
    const baseWarning = (base as { warningSec?: number }).warningSec ?? 0.5;
    const baseVacuum = (base as { vacuumRadiusPx?: number }).vacuumRadiusPx;
    this.ringSkillOverride = {
      ringCount: ring.ringCount != null && ring.ringCount >= 1 ? Math.floor(ring.ringCount) : base.ringCount,
      baseRadiusPx: ring.baseRadiusPx != null && ring.baseRadiusPx >= 0 ? ring.baseRadiusPx : base.baseRadiusPx,
      radiusStepPx: ring.radiusStepPx != null && ring.radiusStepPx >= 0 ? ring.radiusStepPx : base.radiusStepPx,
      ringIntervalSec: ring.ringIntervalSec != null && ring.ringIntervalSec > 0 ? ring.ringIntervalSec : base.ringIntervalSec,
      ringThicknessPx: ring.ringThicknessPx != null && ring.ringThicknessPx > 0 ? ring.ringThicknessPx : base.ringThicknessPx,
      energyCost: ring.energyCost != null && ring.energyCost >= 0 ? ring.energyCost : base.energyCost,
      warningSec: ring.warningSec != null && ring.warningSec >= 0 ? ring.warningSec : baseWarning,
      // ②真空帶：override 優先，缺則沿用 config，再缺則 undefined（resolveTowerRingParams 退回 baseRadiusPx）。
      vacuumRadiusPx: ring.vacuumRadiusPx != null && ring.vacuumRadiusPx >= 0 ? ring.vacuumRadiusPx : baseVacuum,
    };
  }

  /** A3：設定尖塔 sprite 縮放（towerScale，>0；1＝原尺寸）。塔靜態立繪 setStaticTexture 後套用。 */
  setTowerScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0) return;
    this.anim.sprite.setScale(scale);
  }

  /**
   * ★真空帶（物件間碰撞/推擠最小距離）：覆寫塔的 body 碰撞半徑 radiusPx。
   * getBodyRadius() 回此值 → ContactSolver paceMove 接觸距離 = 玩家半徑 + 此半徑 → 縮小它讓角色能貼近塔。
   * 用戶要能調塔真空帶（碰撞半徑），towerCollisionRadiusPx preset 欄由 spawnTower 傳入。>=0；省略不呼＝現行預設。
   * ★只改碰撞半徑值，不動 ContactSolver/paceMove 演算法、immovable 維持（塔仍推不動、只是碰撞圈縮小）。
   * ★跟魂力環 ring vacuumRadiusPx（環狀攻擊最內圈）完全無關、不同回事。
   */
  setTowerCollisionRadius(px: number): void {
    if (!Number.isFinite(px) || px < 0) return;
    this.radiusPx = px;
    this.drawTowerCollisionRing(); // ★半徑變→重畫碰撞範圍可視圈
  }

  /**
   * ★塔碰撞圓圓心偏移（towerCollisionOffsetXPx/YPx，用戶微調圓心位置）：碰撞圓圓心＝塔視覺中心 + (offsetX, offsetY)。
   * 省略＝0（正對塔視覺中心）。spawnTower 傳入。
   */
  setTowerCollisionOffset(offsetXPx: number, offsetYPx: number): void {
    this.towerCollisionOffset = {
      x: Number.isFinite(offsetXPx) ? offsetXPx : 0,
      y: Number.isFinite(offsetYPx) ? offsetYPx : 0,
    };
    this.drawTowerCollisionRing(); // ★offset 變→重畫碰撞範圍可視圈
  }

  /**
   * ★塔碰撞圓圓心（變身-leader 定案修法 A：圓心基準改「視覺塔基底」getTowerVisualBaseCenter）：
   * 前兩版（塔身中央 getTowerRingCenter→frame 腳底 getTowerRingGroundCenter）都對不上：塔素材底部有透明 padding、
   * frame 腳底錨點落在 padding 底＝比視覺塔基低 ~bottomPad×scale→(乙)壓扁橢圓大半掉到塔下方路面（塔身穿得過、塔下方路擋）。
   * 改讀 alpha 算的視覺塔基底＝塔真正站的地面→碰撞橢圓貼塔基、塔身佔位擋、塔下方路大幅改善。
   * ★碰撞用視覺塔基底、C7 環維持腳底（EnemySpawner:453 仍 getTowerRingGroundCenter）——兩者刻意不同源：
   *   大環(r60~150+)視覺基 vs 腳底差~22px＝<2% 肉眼無差、環貼地觀感不變，且環判定屬 a655c53d 契約、為 <2% 動它要重跑環 review 不划算；
   *   碰撞小 footprint(r110) 22px 佔比大、是錯位主因故必須精準到視覺基底。（變身-leader ③定案認可此可辯護差異。）
   * 再加 towerCollisionOffset（用戶微調）。非塔走 getHitCenter。
   */
  getTowerCollisionCenter(): Vec2 {
    const c = this.getTowerVisualBaseCenter(); // ★視覺塔基底（碰撞專用；環維持腳底 getTowerRingGroundCenter、刻意不同源見上）
    return { x: c.x + this.towerCollisionOffset.x, y: c.y + this.towerCollisionOffset.y };
  }

  /**
   * ★塔碰撞範圍可視圈（用戶定案：遊戲裡一眼看到塔碰撞範圍）：貼地壓扁橢圓，
   * 圓心＝getTowerCollisionCenter（色塊底＝碰撞圓心）、
   * ★水平半徑＝塔 getBodyRadius + 玩家半徑（＝實際接觸距離 contactDist = self.radius + body.radius，
   *   角色「中心貼到就停」的真實邊界；只畫塔半徑會讓角色離圈邊還一個玩家半徑就被擋＝用戶「離很遠就擋」）、
   * 垂直半徑＝×GROUND_SQUASH_Y 貼地壓扁。玩家半徑取 FOOT_GLOW.radiusPx 基準常數（拿不到玩家實例；變身放大時略小估，
   * 但為安全視覺基準夠用）。調 towerCollisionRadiusPx→圈跟著變。每次半徑/offset 變重畫。純視覺、不動判定。
   */
  drawTowerCollisionRing(): void {
    if (!this.isTower()) return;
    const sp = this.anim.sprite;
    const c = this.getTowerCollisionCenter();
    // ★實際接觸邊界 = 塔半徑 + 玩家半徑（contactSolver contactDist = self.radius + body.radius）
    const playerRadius = FOOT_GLOW.radiusPx; // 玩家基準推擠半徑（=getVacuumRadius 預設）
    const r = this.getBodyRadius() + playerRadius;
    if (!this.towerCollisionRing) {
      this.towerCollisionRing = sp.scene.add.graphics();
      this.towerCollisionRing.setDepth((sp.depth ?? 15) - 1); // 在塔色塊下方（貼地）
    }
    const g = this.towerCollisionRing;
    g.clear();
    g.setPosition(c.x, c.y);
    // 貼地壓扁橢圓：填半透明 + 亮邊描線（像角色腳下圈）。
    g.fillStyle(0x33ccff, 0.18);
    g.fillEllipse(0, 0, r * 2, r * 2 * GROUND_SQUASH_Y);
    g.lineStyle(3, 0x66ddff, 0.85);
    g.strokeEllipse(0, 0, r * 2, r * 2 * GROUND_SQUASH_Y);
  }

  /**
   * ★B4 塔登場發亮：塔 sprite 短暫加色高亮 + 微 pop（scale 1→1.12→1），烘托「魔尖塔登場」。
   * 純視覺、不動行為（塔仍靜止）；tint 短暫後清回原色。基準 scale 沿用當前（含 towerScale）。
   */
  playTowerAppear(): void {
    const sp = this.anim.sprite;
    const baseScale = sp.scaleX || 1;
    sp.setTint(0xffe08a); // 暖金高亮
    sp.scene.tweens.add({
      targets: sp, scaleX: baseScale * 1.12, scaleY: baseScale * 1.12,
      duration: 180, yoyo: true, ease: 'Quad.easeOut',
      onComplete: () => sp.clearTint(),
    });
  }

  /**
   * ★Bug2：塔聚焦顯現——把塔 sprite depth 提到 spotlight overlay(960) 之上（比照守護波雕像 setDepth 972），
   * 聚焦壓黑時塔在亮圈中被照亮看得見（塔在聚焦前就已生成，不再是空亮圈）。
   */
  setTowerFocusDepth(focusDepth = 972): void {
    this.anim.sprite.setDepth(focusDepth);
  }

  /** ★Bug2：聚焦結束還原塔一般遊玩 depth（比照守護波雕像還原 15）。 */
  restoreTowerDepth(normalDepth = 15): void {
    this.anim.sprite.setDepth(normalDepth);
  }

  getHp(): number {
    return this.hp;
  }

  getMaxHp(): number {
    return this.maxHp;
  }

  /** 覆寫血量（尖塔怪 towerHp 由 TowerWave 節點設定，spawn 後套用；同步 hp/maxHp）。 */
  setMaxHp(hp: number): void {
    if (!Number.isFinite(hp) || hp <= 0) return;
    this.maxHp = hp;
    this.hp = hp;
  }

  getState(): EnemyState {
    return this.state;
  }

  /** 測試用：讀取剩餘擊退時長（>0 表示正被擊退推進中）。 */
  getKnockbackRemaining(): number {
    return this.knockbackRemaining;
  }

  /** 每幀更新：套擊退殘速 → 跑狀態機 → 更新動畫。 */
  /**
   * ★CREDIT 待機（用戶定案：怪要保持平常巡邏 wander 遊走、不能定住；只去掉兩個真問題）：
   * 玩家待機/沒 CREDIT 且無雕像目標時 EnemySpawner 每幀呼此——
   *  1) 清蓄力態+FX+chargeAnchor（怪待機時不進蓄力、不殘留蓄力 FX 跟著遊走）；
   *  2) 防投 CREDIT 瞬移（不殘留 charge→目標恢復時不會被 charge case 鎖回舊 chargeAnchor）；
   *  然後**照常走一般 update(null)＝隨機遊走巡邏**（怪照常走動、不定住）。
   * 死亡/被抓/麻痺/擊退暫態由 update 內各自處理、不干擾。
   */
  freezeIdleWaiting(dt: number): void {
    if (this.dead || this.state === 'death') return;
    // 清蓄力（防殘留 charge→目標恢復瞬移 + 蓄力 FX 跟著遊走）；被抓/麻痺/擊退不動它們的態。
    if (!this.grabber && this.stunRemaining <= 0 && this.knockbackRemaining <= 0) {
      if (this.state === 'charge') {
        this.clearChargeFx();
        this.chargeAnchor = null;
        this.state = 'chase'; // 回中性態，目標恢復從 chase 重新 gate（不殘留 charge/attack/cooldown）
        this.timer = 0;
      }
    }
    // ★照常走一般 update(null)＝待機正常巡邏遊走（會動、不定住）。
    this.update(null, dt);
  }

  /**
   * ★陣型跟隨（怪物 AI 第 2 塊，比照 freezeIdleWaiting 範式：取代 e.update 的外部驅動、不跑 chase FSM）：
   *  EnemyFormation 每幀呼此，讓怪朝分配到的陣型節點移動（速度補償+最大速度），**不各自 chase 玩家**。
   *  ★契約：不碰 switch/enum FSM（外層編排）；進入時清蓄力態（同 freezeIdleWaiting，不殘留 charge/FX/anchor）；
   *   解除陣型＝EnemyFormation 停呼此、改回 e.update → 乾淨回 chase（狀態不殘留）。
   * @param node 目標節點世界座標（px；由 EnemyFormation 算，含 offset-aware anchor）。
   * @param dt 幀時間。
   * @param maxSpeedUnits 入位追節點最大速度（unit/s）；省略＝moveSpeed×2。
   */
  followFormationNode(node: Vec2, dt: number, maxSpeedUnits?: number): void {
    if (this.dead || this.state === 'death') return;
    // 被抓/麻痺/擊退暫態不干擾（由各自邏輯處理）。
    if (this.grabber || this.stunRemaining > 0 || this.knockbackRemaining > 0) return;
    // 進陣型清蓄力態（比照 freezeIdleWaiting，不殘留 charge→解除瞬移/空揮）。
    if (this.state === 'charge') {
      this.clearChargeFx();
      this.chargeAnchor = null;
      this.state = 'chase'; // 中性態，解除陣型從 chase 重新 gate
      this.timer = 0;
    }
    const cur = { x: this.anim.sprite.x, y: this.anim.sprite.y };
    const baseSpeedPx = this.cfg.moveSpeed * PPU;
    const maxSpeedPx = maxSpeedUnits !== undefined ? maxSpeedUnits * PPU : undefined;
    const next = stepTowardNode(cur, node, baseSpeedPx, dt, maxSpeedPx);
    // 面向推進方向（水平）。
    if (next.x - cur.x > 0.01) this.setFacing(1);
    else if (next.x - cur.x < -0.01) this.setFacing(-1);
    this.anim.sprite.x = next.x;
    this.anim.sprite.y = next.y;
    // 到節點站定播 idle、否則 move。
    const atNode = Math.hypot(node.x - next.x, node.y - next.y) < 2;
    this.anim.play(atNode ? 'idle' : 'move');
  }
  update(playerPos: Vec2 | null, dt: number): void {    if (this.dead) return;

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
    // ★2 新事件麻痺視覺：閃爍（每 ~0.1s 切半透明）提示定住；解除復原 alpha。
    if (this.stunRemaining > 0) {
      this.stunRemaining -= dt;
      this.anim.play('idle');
      const blink = Math.floor(this.stunRemaining / 0.1) % 2 === 0;
      this.anim.sprite.setAlpha(blink ? 0.55 : 1);
      if (this.stunRemaining <= 0) this.anim.sprite.setAlpha(1);
      return;
    }

    // 守護波：有覆蓋目標則追/打雕像，否則玩家。
    // 七輪 待機隔離：無雕像目標且玩家待機(playerPos=null) → 無有效目標。
    // 十六輪(5項)③：無目標時不再站原地發呆 → 隨機遊走（巡邏感：慢速走+定期換向+撞邊界反彈）。
    const aim = this.guardTarget ? this.guardTarget.getPosition() : playerPos;
    if (!aim) {
      this.wanderRetargetSec -= dt;
      if (this.wanderRetargetSec <= 0) {
        const ang = Math.random() * Math.PI * 2;
        this.wanderDir = { x: Math.cos(ang), y: Math.sin(ang) };
        this.wanderRetargetSec = 1.5 + Math.random() * 1.5; // 1.5~3s 換一次方向
      }
      const wanderSpeed = this.cfg.moveSpeed * PPU * 0.4; // 遊走慢速（追擊的 40%）
      this.anim.sprite.x += this.wanderDir.x * wanderSpeed * dt;
      this.anim.sprite.y += this.wanderDir.y * wanderSpeed * dt;
      if (this.wanderDir.x > 0.01) this.setFacing(1);
      else if (this.wanderDir.x < -0.01) this.setFacing(-1);
      this.anim.play('move');
      return;
    }
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
        // 第十輪#2 治本(決策 34b0be5b 停止=攻擊基準)：近戰只信 canReach(攻擊 shape 權威判定)，
        //   不再被粗 gate dist<=attackPx 誤殺(大範圍菁英 attack.radius 225px>attackRange 200px、環繞槽=200px
        //   邊界抖動→卡外圈空轉)；射彈仍用 dist<=attackPx 當射程 gate。
        if (shouldEnterCharge(this.cfg.attackKind, dist, attackPx, this.canReachTarget(aim))) {
          // 進入攻擊距離 + 攻擊形狀確認搆得到 → 開始蓄力（否則不揮，繼續逼近/面向等下一幀）。
          this.state = 'charge';
          this.timer = this.cfg.chargeTime;
          this.anim.play('idle');
          // 十六輪①：蓄力站定——記錄蓄力當下位置，charge 期間每幀鎖回（不追遠離的目標）。
          this.chargeAnchor = { x: this.anim.sprite.x, y: this.anim.sprite.y };
          // 用戶 #7/#4 + 三輪#3 + 四輪#2：蓄力集氣特效 → 腳底貼地圓盤法陣(俯視壓扁+盤旋氣流)，出手 destroy 接 slash/burst。純視覺。
          // 四輪#2 修：footY 往下讓整盤落在角色腳底「之下」(disk 上緣 ≤ 腳底、不與身體/腿重疊)，
          //   否則 depth-4 在身後、身體遮住盤中心只露側邊弧在軀幹高 → 看似「身上打轉」(用戶回歸)。不寫死: 從 radiusPx 算。
          const isAoe = enemyAttackVfx(this.cfg.attackKind, this.cfg.attackVfx) === 'aoe';
          if (isAoe) {
            // 六輪#2：菁英(aoe)不要腳底小蓄力盤 chargeFx，只留 aoeRing 範圍預告圈。
            // 五輪#4：預警圈圓心用視覺 body 中心(非 sprite 幾何中心, frame 上方留白會偏上)→菁英在圈正中央。
            // 十五輪：攻擊範圍尺寸不隨體型（sizeScale=1）；offset 位置仍對變大的身體(scaleFactor)。
            const circle = buildAttackCircle(this.cfg.attack, this.getBodyCenter(), this.facing, this.scaleFactor, aim, ATTACK_SIZE_SCALE);
            this.aoeRingRadiusPx = circle.radius; // 存半徑供 syncChargeFx 按進度重畫填充
            this.aoeRingFx =
              this.hitFeelFx?.enemyAoeRing?.(circle.center.x, circle.center.y, circle.radius) ?? null;
          } else {
            // ★小怪蓄力（大更）：取消腳底 chargeFx 法陣盤 → 改「身體閃紅 tint 脈動」提示蓄力。
            //   0xff4444 紅 tint + alpha 呼吸（tween yoyo），蓄力期間持續；出手瞬間閃亮一下再 clearTint。
            //   出手/取消/死亡清 tint（clearChargeTint / clearChargeFx）。
            this.startChargeTint();
          }
        } else if (this.guardTarget || (dist <= detectPx && dist > 0.001)) {
          // 十五輪回歸修①：有守護目標(雕像)＝一律朝雕像逼近（雕像是圍攻目標，非「偵測到才追」），
          //   不受 detectRange gate → 被 de-overlap/雕像頂開推到 detectRange 外時仍走回來，不再落 else 純 idle 凍死。
          //   對玩家維持 detectPx gate（偵測範圍外不追，行為不變）。
          if (dist > 0.001) this.moveChase(dx, dy, dt); // 追擊 + 分離力疊加（含 attackRange 內但形狀外→再逼近，根治空揮）
          // surround(征騎)：已到槽定位→idle(停走姿)，否則 move(趕路)。
          this.anim.play(this.slotPos && this.isAtSlot(SLOT_REACH_THRESHOLD_PX) ? 'idle' : 'move');
        } else {
          this.anim.play('idle');
        }
        break;
      }

      case 'charge':
        this.timer -= dt;
        // 蓄力期間維持 idle 姿勢（別移動），時間到 → 進 attack 狀態出手。
        this.anim.play('idle');
        // 十六輪①：蓄力站定——每幀鎖回蓄力起始位置，防目標遠離時被追擊殘留/slot/de-overlap 拖著移動。
        if (this.chargeAnchor) {
          this.anim.sprite.x = this.chargeAnchor.x;
          this.anim.sprite.y = this.chargeAnchor.y;
        }
        // 六輪#11：蓄力特效每幀跟隨怪當前位置（怪被推開時特效跟著移動、不留原地）。
        this.syncChargeFx();
        if (this.timer <= 0) {
          // 六輪#8：出手前再 gate 一次 canReachTarget（與進 charge 同基準 getBodyCenter，五輪#4 已對齊）。
          // 真因=gate 只擋「進 charge」那刻、沒擋「出手」那刻，蓄力期玩家跑出範圍仍照揮→空揮。
          // 搆不到 → 取消出手、收蓄力特效、回 chase 繼續逼近（不空揮、不發呆；下一幀 chase 重新逼近/gate）。
          this.chargeAnchor = null; // 離開 charge 解鎖站定
          // ★用戶選 B：菁英(aoe)蓄滿「必發」——跳過 canReachTarget gate、就算玩家跑出範圍也硬打出去
          //   （＝由內而外填滿圓盤那刻一定打出攻擊 VFX，跟填充進度視覺一致：填滿=發招、不會填滿卻取消）。
          //   小怪(slash)保留現行：蓄滿搆不到→取消回 chase 不空揮（用戶只要菁英改 B）。
          const isAoe = enemyAttackVfx(this.cfg.attackKind, this.cfg.attackVfx) === 'aoe';
          if (isAoe || this.canReachTarget(aim)) {
            this.state = 'attack';
            this.attackAnimDone = false;
            this.fireAttack(aim); // 對準目標（守護波為雕像，否則玩家）出手
          } else {
            this.clearChargeFx(); // 收掉蓄力集氣/預告圈殘留
            this.state = 'chase';
          }
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
          this.anim.play(this.slotPos && this.isAtSlot(SLOT_REACH_THRESHOLD_PX) ? 'idle' : 'move');
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
    // 七輪#3：守護波打雕像也做形狀判定（原本 return true 跳過→怪在雕像上/下方時攻擊 offset 依水平 facing、
    //   meleeCircle 偏側邊搆不到雕像仍照揮＝空揮）。用雕像判定中心+半徑（對齊 Unity hitAnchor 統一錨點）。
    if (this.guardTarget) {
      const gc = this.guardTarget.getHitCenter?.() ?? this.guardTarget.getPosition();
      const gr = this.guardTarget.getHitRadius?.() ?? 0;
      return isPlayerInEnemyAttackShape(
        this.cfg.attack,
        this.getBodyCenter(),
        this.facing,
        this.scaleFactor,
        gc,
        gr + this.guardReachBonusPx(), // 十五輪回歸修：大身體被頂到雕像外緣的補償（見 guardReachBonusPx）
        ATTACK_SIZE_SCALE, // 十五輪：到達/停止基準的攻擊範圍不隨體型（與傷害圓同 sizeScale=1）
      );
    }
    return isPlayerInEnemyAttackShape(
      this.cfg.attack,
      this.getBodyCenter(), // 五輪#4：與實際傷害圓同用視覺 body 中心(一致, 否則揮前判定與命中圓錯位)
      this.facing,
      this.scaleFactor,
      // 十六輪②：衝鋒怪(horizontalAttackOnly) → 觸及判定亦用水平 aim（與實際水平攻擊一致）：
      //   玩家在正上/正下時水平攻擊圓涵蓋不到 → 不揮、繼續繞到水平側再攻擊（不做垂直攻擊）。
      this.cfg.horizontalAttackOnly === true ? { x: aim.x, y: this.getBodyCenter().y } : aim,
      PLAYER_HIT_RADIUS * PPU,
      ATTACK_SIZE_SCALE, // 十五輪：同上，停止基準＝攻擊基準（範圍固定）
    );
  }

  /**
   * 十五輪回歸修（菁英雕像旁卡死）：大身體怪被防穿透(pushOutOfObstacle)頂到雕像外緣，
   * 距離 = 雕像半徑 + 自己 radiusPx(隨 scaleFactor 放大)。但攻擊範圍拆開後 sizeScale=1（不隨體型），
   * 大怪在被頂開的遠距離攻擊 shape 搆不到雕像 → canReachTarget false → 判定沒到→靠近→又被頂開→來回卡死。
   *
   * 補償：只對 immovable 雕像，補回「大身體被頂開超出基準身體的距離」= radiusPx − 基準 radiusPx（= 45×(scaleFactor−1)，
   * 基準怪=0 不受影響）。等同用「身體外緣＋攻擊範圍 vs 雕像」（與 de-overlap 頂開基準一致），而非怪中心。
   * ★純用於雕像的觸及/停止 + 對雕像的傷害圓（見 fireAttack），不放大對玩家的攻擊範圍、不放大一般傷害範圍。
   */
  private guardReachBonusPx(): number {
    return Math.max(0, this.radiusPx - ENEMY_BODY_RADIUS_PX);
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
    // 五輪#4：攻擊圓心(爆發+斬光+傷害判定)用視覺 body 中心，非 sprite 幾何中心(frame 上方留白偏上)→
    //   預警圈=傷害圈=菁英/近戰視覺中心(所見即所得)。全近戰共用此 builder、一致下移對齊 body。
    const pos = this.getBodyCenter();
    const a = this.cfg.attack;
    // 十六輪②：衝鋒怪(horizontalAttackOnly) → 攻擊方向 clamp 到水平（aim.y 設為攻擊圓心 y），
    //   使揮砍 fx 角度/攻擊圓 offset/傷害判定皆朝左右，不朝正上/正下（類玩家 ec318b03）。其餘怪照原 aim。
    const aim: Vec2 = this.cfg.horizontalAttackOnly === true ? { x: playerPos.x, y: pos.y } : playerPos;

    // 用戶 #7/#3：出手當下收掉蓄力/預告圈，播出手特效。純視覺。
    this.clearChargeFx();
    const vfx = enemyAttackVfx(this.cfg.attackKind, this.cfg.attackVfx); // 三輪#12：slash/aoe/none
    // ★小怪（slash）蓄力身體閃紅→出手瞬間閃亮一下再清（大更）。菁英(aoe)/射彈不套。
    if (vfx === 'slash' || vfx === 'fan') this.flashChargeTintOnFire();
    if (vfx === 'aoe') {
      // 真大範圍敵人(菁英) → 播 AOE 爆發（同攻擊圓心、依 AOE 半徑）。七輪#3：offset 朝 aim(playerPos)。
      // 十五輪：AOE 爆發視覺半徑=實際攻擊範圍(sizeScale=1，不隨體型)，與預警圈/傷害圓一致(所見即所得)。
      const circle = buildAttackCircle(a, pos, this.facing, this.scaleFactor, aim, ATTACK_SIZE_SCALE);
      this.hitFeelFx?.enemyAoeBurst?.(circle.center.x, circle.center.y, circle.radius);
    } else if (vfx === 'fan') {
      // 七輪：衝鋒兵扇形揮砍（頂點=出手點偏敵人手前、rotate 朝 aim、scale 依攻擊範圍隨範圍縮放）。十六輪②：aim 已 clamp 水平。
      const aimAngle = Math.atan2(aim.y - pos.y, aim.x - pos.x);
      const fanX = pos.x + Math.cos(aimAngle) * a.offsetX * PPU;
      const fanY = pos.y + Math.sin(aimAngle) * a.offsetX * PPU;
      // scale 隨攻擊範圍：以 fan 素材涵蓋 ~攻擊半徑(a.radius×PPU)為基準（fan 頂點→弧 ≈128px）×perCharScale。
      const fanScale = (((a.radius ?? 0.45) * PPU * 2) / 128) * this.scaleFactor;
      this.hitFeelFx?.enemyFan?.(fanX, fanY, aimAngle, fanScale);
    } else if (vfx === 'slash') {
      // 一般近戰 → 揮擊斬光（rotation 對準 aim、生成偏敵人手前）。三輪#12 修回歸。
      const aimAngle = Math.atan2(aim.y - pos.y, aim.x - pos.x);
      const slashX = pos.x + Math.cos(aimAngle) * a.offsetX * PPU;
      const slashY = pos.y + Math.sin(aimAngle) * a.offsetX * PPU;
      this.hitFeelFx?.enemySlash?.(slashX, slashY, aimAngle, this.scaleFactor);
    }
    // vfx==='none'（射彈）：不播近戰揮斬/AOE，有自己的射彈視覺。

    if (this.cfg.attackKind === 'melee') {
      // 近戰圓形判定：offset 隨 perCharScale 放大（菁英大範圍）。七輪#3：offset 朝 aim＝與 canReachTarget 同基準。
      // 十五輪：攻擊範圍尺寸不隨體型(sizeScale=1)，offset 位置仍對變大的身體(scaleFactor)。與 canReachTarget 同 sizeScale=1 一致。
      // 十六輪②：衝鋒怪 aim 已 clamp 水平 → 傷害圓 offset 亦水平（判定與視覺一致，不朝正上/下）。
      const circle = buildAttackCircle(a, pos, this.facing, this.scaleFactor, aim, ATTACK_SIZE_SCALE);
      // 十五輪回歸修：打雕像(immovable)時傷害圓半徑補回大身體被頂開的距離，與 canReachTarget 對雕像的觸及基準一致
      //   → 大菁英被頂到雕像外緣後「停下就打得到」(不再停了卻空揮)。只對雕像，不影響對玩家的傷害範圍。
      const meleeRadius = circle.radius + (this.guardTarget ? this.guardReachBonusPx() : 0);
      this.onAttack?.({
        kind: 'melee',
        sourceName: this.cfg.characterKey,
        damage: a.damage,
        knockback: a.knockback,
        meleeCircle: { center: circle.center, radius: meleeRadius },
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
    const hf = getResolvedHitFeel(); // 第十一輪：hitFeel override 優先（頓幀/擊退/白閃等時長可套用）
    // 六輪#3：菁英蓄力不可被打斷——charge 期間受擊照扣血，但不清蓄力特效、不進 damaged 硬直、不擊退，繼續蓄力到出手。
    const chargeLocked = isChargeInvulnerable(this.state, this.cfg.immovable === true);
    if (chargeLocked) {
      this.hp -= damage; // 數值即時
      // 純視覺受擊回饋（白閃/火花）仍給，但不打斷 charge、不改 state、不擊退。
      if (hf.enabled && this.hitFeelFx) {
        this.hitFeelFx.hitFlash(this.anim.sprite, hf.hitFlashColor, hf.hitFlashDuration);
      }
      if (this.hp <= 0) this.die(); // 血扣光仍會死（不可被打斷≠無敵）
      return;
    }
    this.clearChargeFx(); // 用戶 #7：受擊中斷蓄力 → 清蓄力預警特效
    this.hp -= damage; // 數值即時（不受 hitFeel 影響）

    // 擊退方向：遠離攻擊來源。
    const dx = this.anim.sprite.x - fromPos.x;
    const dy = this.anim.sprite.y - fromPos.y;
    const len = Math.hypot(dx, dy) || 1;
    const immovable = this.cfg.immovable === true;

    // hitFeel 擊退「快進快出」：總距離 = knockbackDistancePx(招式 knockback)，於 knockbackDuration 內線性推進。
    // 擊退定案(用戶)：怪被玩家打的擊退 = 看玩家招式 knockback、**所有怪統一照招式**(移除 ×hitStun 抗性, 不再因怪而異)。
    // 菁英(immovable) 仍走 !immovable 分支豁免(像牆不退)；knockbackForce(怪被擊退力)遊戲端不用(改讀招式)。
    if (hf.enabled && !immovable) {
      const distPx = knockbackDistancePx(knockback, PPU, hf); // 統一照招式 knockback(不 ×hitStun)
      const dur = hf.knockbackDuration;
      this.knockbackRemaining = dur;
      this.knockbackPerSec = { x: (dx / len) * (distPx / dur), y: (dy / len) * (distPx / dur) };
    } else if (!immovable) {
      // hitFeel 關閉時的後備（基本擊退：舊式力道，於 0.18s 線性推進；同樣統一照招式不 ×hitStun）。
      const kbPx = knockback * PPU;
      this.knockbackRemaining = 0.18;
      this.knockbackPerSec = { x: (dx / len) * (kbPx / 0.18), y: (dy / len) * (kbPx / 0.18) };
    }

    // hitFeel 純視覺表演（不動數值）：白閃 + punch 彈跳 + 命中火花 + 局部頓幀。
    if (hf.enabled && this.hitFeelFx) {
      this.hitFeelFx.hitFlash(this.anim.sprite, hf.hitFlashColor, hf.hitFlashDuration);
      this.hitFeelFx.punchScale(this.anim.sprite, hf.punchScale);
      if (hf.hitSparkEnabled) {
        this.hitFeelFx.hitSpark(this.anim.sprite.x, this.anim.sprite.y, dx, dy, hf.hitSparkColor);
      }
    }
    if (hf.enabled && this.hp > 0) {
      this.freezeRemaining = Math.max(this.freezeRemaining, hf.microFreezeDuration);
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
    this.clearChargeFx(); // 七輪#6：死亡清蓄力特效(charge disk+aoeRing 預告圈)。單點根治——
    //   六輪#3 菁英蓄力免疫「打斷」的 chargeLocked 致死分支沒清特效→殘留在場；免疫打斷≠免疫死亡，死了就清。
    // hitFeel 死亡金黃粒子（純視覺）。
    const hf = getResolvedHitFeel();
    if (hf.enabled && this.hitFeelFx) {
      this.hitFeelFx.deathParticle(this.anim.sprite.x, this.anim.sprite.y, hf.deathParticleColor);
    }
    this.onKilled?.(this.cfg.characterKey, this.damageByPlayer, {
      x: this.anim.sprite.x,
      y: this.anim.sprite.y,
    }); // 擊殺事件 + 傷害歸屬 + 死亡位置(能量飛光起點)
    // ★靜態貼圖（尖塔）：anim.play() 是 no-op → death 動畫的 onComplete 不會觸發、dead 永遠不會設 true
    //   （＝塔打死不消失、還放招、進度不動的根因）。★立刻設 dead=true（下一幀即從 enemies filter 掉→停放招+
    //   onTowerDestroyed 通知進度++），sprite 淡出後銷毀（純視覺，與 dead 判定解耦）。
    if (this.anim.isStaticTexture?.()) {
      this.dead = true;
      const sp = this.anim.sprite;
      this.towerCollisionRing?.destroy(); // ★清塔碰撞範圍可視圈（不殘留）
      this.towerCollisionRing = null;
      sp.scene.tweens.add({
        targets: sp, alpha: 0, duration: 220, ease: 'Sine.easeIn',
        onComplete: () => this.anim.destroy(),
      });
      return;
    }
    this.anim.play('death', {
      force: true,
      onComplete: () => {
        this.dead = true;
        this.anim.destroy();
      },
    });
  }
}
