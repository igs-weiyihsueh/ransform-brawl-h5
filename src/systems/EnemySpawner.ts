import Phaser from 'phaser';
import { Enemy, type EnemyAttackEvent } from '@/entities/Enemy';
import type { Player } from '@/entities/Player';
import { circleIntersectsCircle, type Vec2 } from '@/systems/hitDetection';
import { pushOutOfPlayer } from '@/systems/enemySeparation';
import { Projectile } from '@/systems/Projectile';
import { SurroundSlotManager, type ISurroundTarget } from '@/systems/SurroundSlotManager';

/**
 * EnemySpawner — 生怪 API + 敵人/射彈執行時容器。
 *
 * 對外契約（波次系統等消費者用）：
 *   spawner.spawn(type, x, y) → 生成一隻該類型敵人並接管其生命週期。
 * 消費者只呼叫這個 API 決定「何時在哪生什麼怪」，完全不碰 Enemy.ts / enemyConfig 內部。
 *
 * 內部負責：敵人 onAttack 接線（近戰對玩家判定 / 生成射彈）、每幀更新敵人與射彈、
 * 清除死亡敵人/失效射彈。update(dt) 由 EnemySystem 每幀呼叫。
 */
export class EnemySpawner {
  private readonly scene: Phaser.Scene;
  private readonly player: Player;
  private readonly worldBounds: Phaser.Geom.Rectangle;

  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];

  /** 敵人近戰判定圓的最近一次（供 debug 繪製）。 */
  private lastMeleeCircle: { center: { x: number; y: number }; radius: number } | null =
    null;
  private meleeCircleFlash = 0;

  constructor(scene: Phaser.Scene, player: Player, worldBounds: Phaser.Geom.Rectangle) {
    this.scene = scene;
    this.player = player;
    this.worldBounds = worldBounds;
  }

  /** 擊殺回呼（由 GameScene 設定）。帶被擊殺敵人的角色 key + 各 player 對這隻的傷害 + 死亡位置。 */
  onEnemyKilled:
    | ((
        enemyKey: string,
        damageByPlayer: ReadonlyMap<number, number>,
        deathPos: Vec2,
      ) => void)
    | null = null;

  /** 取得全部玩家（由 GameScene 注入）：供防穿透對所有 player 頂開。預設只有 P1。 */
  getAllPlayers: () => readonly Player[] = () => [this.player];

  /** hitFeel 表演（由 GameScene 注入 EffectSystem）；spawn 時傳給每隻新敵人。 */
  hitFeelFx: import('@/entities/Enemy').HitFeelFx | null = null;

  /** 生怪 API：生成一隻指定類型的敵人於 (x,y)，回傳該敵人。 */
  spawn(type: string, x: number, y: number): Enemy {
    const e = new Enemy(this.scene, x, y, type);
    e.onAttack = (ev) => this.handleEnemyAttack(ev);
    e.hitFeelFx = this.hitFeelFx; // hitFeel 表演注入（白閃/punch/火花/死亡粒子）
    e.onKilled = (key, dmgByPlayer, deathPos) =>
      this.onEnemyKilled?.(key, dmgByPlayer, deathPos);
    if (this.guardTarget) e.setGuardTarget(this.guardTarget); // 守護波中新生怪也打雕像
    this.enemies.push(e);
    return e;
  }

  /** 清除全部場上敵人（守護波結束 ClearAllActiveEnemies 用）。 */
  clearAllEnemies(): void {
    for (const e of this.enemies) {
      this.releaseSurroundFor(e);
      e.forceDestroy();
    }
    this.enemies = [];
    this.projectiles = [];
  }

  // --- 槽位同心圓環繞協調（每幀 update 前） ---

  /**
   * 快取的 ISurroundTarget adapter：把 Player / GuardTarget 包成環繞目標介面。
   * 快取的原因：SurroundSlotManager 靜態註冊表用 target 物件身份當 key，每幀新建 adapter 會炸出多個 manager、槽位錯亂。
   * 用底層物件(player/guard 實例)當 key 快取同一個 adapter，維持 manager 一對一。
   */
  private readonly surroundAdapters = new WeakMap<object, ISurroundTarget>();

  /** 取得（或建立快取）某玩家的環繞 adapter。IsSurroundActive = 非待機（待機/出局不被環繞）。 */
  private playerAsSurroundTarget(p: Player): ISurroundTarget {
    const cached = this.surroundAdapters.get(p as unknown as object);
    if (cached) return cached;
    const adapter: ISurroundTarget = {
      getVacuumCenter: () => p.getVacuumCenter?.() ?? p.getHitCenter(),
      getVacuumRadius: () => p.getVacuumRadius?.() ?? p.getHitRadius(),
      isSurroundActive: () => !(p.isWaiting?.() ?? false),
    };
    this.surroundAdapters.set(p as unknown as object, adapter);
    return adapter;
  }

  /** 取得（或建立快取）守護目標的環繞 adapter。中心=getHitCenter、半徑=getHitRadius、active=未被擊破。 */
  private guardAsSurroundTarget(
    g: import('@/systems/hitDetection').Hittable & {
      getPosition(): Vec2;
      isDefeated?: () => boolean;
    },
  ): ISurroundTarget {
    const cached = this.surroundAdapters.get(g as unknown as object);
    if (cached) return cached;
    const adapter: ISurroundTarget = {
      getVacuumCenter: () => g.getHitCenter(),
      getVacuumRadius: () => g.getHitRadius(),
      isSurroundActive: () => !(g.isDefeated?.() ?? false),
    };
    this.surroundAdapters.set(g as unknown as object, adapter);
    return adapter;
  }

  /**
   * 決定某敵人本幀的環繞目標 adapter：守護波→雕像；否則→玩家（對應 e.update 的 aim 目標）。
   * 目標不可環繞（待機/出局/被擊破）或真空半徑<=0 → 回 null（該敵人 fallback 一般追擊）。
   */
  private surroundTargetFor(): ISurroundTarget | null {
    const adapter = this.guardTarget
      ? this.guardAsSurroundTarget(this.guardTarget)
      : this.playerAsSurroundTarget(this.player);
    if (!adapter.isSurroundActive()) return null;
    if (adapter.getVacuumRadius() <= 0) return null;
    return adapter;
  }

  /**
   * 每幀協調：對每隻活著、追擊中的敵人 claim 槽（就近內層優先）+ 主動往內遞補，設好本幀 slot 目標。
   * 目標不可環繞/全滿 → 釋放舊槽 + slotTarget(null)（fallback 一般 moveChase 分離力追擊）。
   * claim 後持有、不被動遞補，只 tryClaimInner 往更內層遞補（避免抖動；Unity 設計）。
   */
  private coordinateSurround(): void {
    for (const e of this.enemies) {
      if (e.isDead()) continue;
      // grabber（抓人者）不走環繞（由 GrabSystem 驅動）。
      if (e.isGrabber?.()) {
        this.releaseSurroundFor(e);
        e.setSlotTarget(null, null);
        continue;
      }
      const target = this.surroundTargetFor();
      if (!target) {
        this.releaseSurroundFor(e);
        e.setSlotTarget(null, null);
        continue;
      }
      const mgr = SurroundSlotManager.getOrCreate(target);
      const enemyPos = e.getHitCenter();
      const minLayer = e.getSurroundMinLayer();

      // claim（沒持槽才 claim；持槽則回原槽）。
      let slotId = mgr.claim(e.id, enemyPos, minLayer);
      // 主動往更內層遞補（前排死→內圈空）：持槽後每幀嘗試，找不到就保留原槽。
      if (slotId >= 0) {
        const inner = mgr.tryClaimInner(e.id, enemyPos, minLayer);
        if (inner >= 0) slotId = inner;
      }

      if (slotId < 0) {
        // 全滿 → 無槽，fallback 一般追擊（不釋放已持槽者；此處 slotId<0 代表本來就沒槽）。
        e.setSlotTarget(null, mgr.getRingCenter());
        continue;
      }
      e.setSlotTarget(mgr.getSlotPos(slotId), mgr.getRingCenter());
    }
  }

  /** 釋放某敵人在（所有可能目標的）manager 中持有的槽（死亡/離場/換目標/停止環繞）。 */
  private releaseSurroundFor(e: Enemy): void {
    if (this.guardTarget) {
      SurroundSlotManager.get(this.guardAsSurroundTarget(this.guardTarget))?.release(e.id);
    }
    SurroundSlotManager.get(this.playerAsSurroundTarget(this.player))?.release(e.id);
  }

  /** 目前存活的敵人（唯讀）。 */
  getEnemies(): readonly Enemy[] {
    return this.enemies;
  }

  /** 每幀：更新敵人 AI、射彈；處理射彈命中目標（玩家或守護雕像）；清除死亡/失效。 */
  update(dt: number): void {
    if (this.meleeCircleFlash > 0) this.meleeCircleFlash -= dt;

    const playerPos = this.player.getPosition();
    // separation：每幀給每個敵人「其他敵人位置」清單。
    const positions = this.enemies.map((e) => e.getHitCenter());
    // 槽位環繞協調：每幀在 update 前 claim/遞補/釋放，設好各敵人本幀 slot 目標（e.update 讀它決定繞圈到槽或 fallback 追擊）。
    this.coordinateSurround();
    for (let i = 0; i < this.enemies.length; i += 1) {
      const e = this.enemies[i];
      e.setNeighbors(positions.filter((_, j) => j !== i));
      e.update(playerPos, dt);
    }

    // 防穿透：敵人移動後，對所有 player 頂開（不穿透）。
    // pushOut：immovable 菁英頂不動時，改把玩家本身移到菁英外（玩家被擋、不穿進菁英）。
    // 真空帶半徑用 getVacuumRadius（=FOOT_GLOW 50）、中心用 getVacuumCenter（=視覺圈腳部中心，用戶試玩#1）。
    const players = this.getAllPlayers().map((p) => ({
      pos: p.getVacuumCenter?.() ?? p.getHitCenter(),
      hitRadius: p.getVacuumRadius?.() ?? p.getHitRadius(),
      pushOut: (x: number, y: number) => p.setPosition?.(x, y),
    }));
    for (const e of this.enemies) {
      e.resolvePenetration(players);
    }

    // #1 修正：菁英「像牆」——玩家主動撞 immovable 菁英時，把玩家擋在菁英外緣（玩家穿不進）。
    // 注意：菁英自己移動撞玩家「不推玩家」由 Enemy.resolvePenetration(blockEliteAdvance) 處理；
    // 這道只在「玩家侵入菁英」時把玩家頂出，兩道合起來＝真正的牆（雙向都不會被推著走）。
    for (const e of this.enemies) {
      if (!e.isImmovable()) continue;
      const ec = e.getHitCenter();
      const er = e.getHitRadius();
      for (const p of this.getAllPlayers()) {
        const pc = p.getVacuumCenter?.() ?? p.getHitCenter();
        const vac = p.getVacuumRadius?.() ?? p.getHitRadius();
        const fixed = pushOutOfPlayer(pc, ec, er + vac);
        if (fixed.x !== pc.x || fixed.y !== pc.y) {
          // 修正量施加回玩家 sprite（pushOut 用 setPosition；換算回 sprite 座標＝加上位移）。
          const dx = fixed.x - pc.x;
          const dy = fixed.y - pc.y;
          const cur = p.getHitCenter();
          p.setPosition?.(cur.x + dx, cur.y + dy);
        }
      }
    }

    // 守護波雕像實體碰撞（#8 用戶要「原本碰撞」）：雕像 immovable 擋住，玩家/敵人不穿進雕像。
    // 對齊新雕像圖尺寸（getHitRadius 已依 statue 顯示寬設定）。
    if (this.guardTarget) {
      const sc = this.guardTarget.getHitCenter();
      const sr = this.guardTarget.getHitRadius();
      // 玩家不穿進雕像：把玩家頂到雕像外緣。
      for (const p of this.getAllPlayers()) {
        const ppos = p.getHitCenter();
        const fixed = pushOutOfPlayer(ppos, sc, sr + p.getHitRadius());
        if (fixed.x !== ppos.x || fixed.y !== ppos.y) p.setPosition?.(fixed.x, fixed.y);
      }
      // 敵人不穿進雕像：把敵人頂到雕像外緣（守護波敵人圍攻雕像時不重疊進體內）。
      for (const e of this.enemies) e.pushOutOfObstacle(sc, sr);
    }

    // 六輪#10 根本修：clamp 是「單一最後防線」——排在所有位移/推力
    //（moveChase/surround + resolvePenetration + 守護 pushOutOfObstacle）之後，統一跑一次。
    // 真因=舊 clamp 排在守護 pushOutOfObstacle 之前，雕像貼界時怪被頂出界沒再 clamp（頂出 122px）。
    // ★此後不得有任何敵人位移/推力排在這道之後（clamp 永遠是每幀敵人位置最後一步）。
    for (const e of this.enemies) e.clampToMapBounds();

    // 守護波：射彈打雕像；否則打玩家。
    const target = this.guardTarget ?? this.player;
    for (const p of this.projectiles) {
      const hit = p.update(target, dt, this.worldBounds);
      if (hit) {
        this.applyAttackDamage(p.damage, p.sourceLabel);
        // 用戶 #7：射彈命中玩家也播命中爆閃（打雕像不播）。純視覺。
        if (!this.guardTarget) {
          const hc = this.player.getHitCenter();
          this.hitFeelFx?.enemyImpact?.(hc.x, hc.y);
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.isDead());
    // 死亡敵人移除前先釋放其環繞槽（前排死→內圈空→外層怪 tryClaimInner 遞補進來）。
    const dead = this.enemies.filter((e) => e.isDead());
    for (const e of dead) this.releaseSurroundFor(e);
    this.enemies = this.enemies.filter((e) => !e.isDead());
  }

  /** 守護波目標介面：可判定命中(Hittable) + 提供位置(AI aim) + 受傷。 */
  private guardTarget:
    | (import('@/systems/hitDetection').Hittable & {
        getPosition(): import('@/systems/hitDetection').Vec2;
        takeDamage(dmg: number): void;
      })
    | null = null;

  /** 設定/清除守護目標（守護波開始設雕像、結束清）。同時把場上敵人的 AI 目標覆蓋一起切。 */
  setGuardTarget(
    target:
      | (import('@/systems/hitDetection').Hittable & {
          getPosition(): import('@/systems/hitDetection').Vec2;
          takeDamage(dmg: number): void;
        })
      | null,
  ): void {
    // 換目標：先釋放場上敵人在「舊目標」manager 的槽（Unity 換目標 release 舊槽），並清舊 manager 註冊表。
    const prev = this.guardTarget;
    if (prev !== target) {
      for (const e of this.enemies) this.releaseSurroundFor(e);
      if (prev) SurroundSlotManager.remove(this.guardAsSurroundTarget(prev));
    }
    this.guardTarget = target;
    for (const e of this.enemies) e.setGuardTarget(target);
  }

  /** 對當前攻擊目標套傷害：守護波→雕像 takeDamage；否則→玩家 takeHit。 */
  private applyAttackDamage(dmg: number, sourceName: string): void {
    if (this.guardTarget) {
      this.guardTarget.takeDamage(dmg);
    } else {
      this.player.takeHit(dmg, sourceName);
    }
  }

  /** 敵人出手：近戰→對當前目標(玩家/雕像)做圓判定；射彈→生成可重用 Projectile。 */
  private handleEnemyAttack(ev: EnemyAttackEvent): void {
    if (ev.kind === 'melee' && ev.meleeCircle) {
      const target = this.guardTarget ?? this.player;
      const hit = circleIntersectsCircle(
        { center: ev.meleeCircle.center, radius: ev.meleeCircle.radius },
        target.getHitCenter(),
        target.getHitRadius(),
      );
      if (hit) {
        this.applyAttackDamage(ev.damage, ev.sourceName);
        // 用戶 #7：命中玩家瞬間播命中爆閃（生在受擊點；打雕像不播）。純視覺。
        if (!this.guardTarget) {
          const hc = this.player.getHitCenter();
          this.hitFeelFx?.enemyImpact?.(hc.x, hc.y);
        }
      }
      this.lastMeleeCircle = ev.meleeCircle;
      this.meleeCircleFlash = 0.15;
    } else if (ev.kind === 'projectile' && ev.projectile) {
      this.projectiles.push(
        new Projectile(this.scene, {
          x: ev.projectile.x,
          y: ev.projectile.y,
          dir: ev.projectile.dir,
          speedUnits: ev.projectile.speedUnits,
          radiusUnits: ev.projectile.radiusUnits,
          damage: ev.damage,
          knockback: ev.knockback,
          sourceLabel: ev.sourceName,
        }),
      );
    }
  }

  /** 給 debug 用：最近敵人近戰判定圓（閃現中才回傳）。 */
  getDebugMeleeCircle(): { center: { x: number; y: number }; radius: number } | null {
    return this.meleeCircleFlash > 0 ? this.lastMeleeCircle : null;
  }
}
