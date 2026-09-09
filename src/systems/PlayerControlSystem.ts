import { PLAYER_CONFIG, SECOND_TRANSFORM_CONFIG } from '@/config/combatConfig';
import { getResolvedDash } from '@/config/dashSchema';
import {
  type DashChargeState,
  makeDashChargeState,
  canDash as canDashCharge,
  consumeDashCharge,
  tickDashCharge,
  dashCooldownProgress,
} from '@/systems/dashChargeMath';
import {
  FREEZE_SEC,
  LIGHTNING_CHAIN_COUNT,
  LIGHTNING_CHAIN_DAMAGE,
  LIGHTNING_CHAIN_RANGE,
  LIGHTNING_PARALYZE_SEC,
  MOUNT_DASH_EXTRA_HITS,
} from '@/config/buffConfig';
import { COIN_INSERT_AMOUNT } from '@/config/creditConfig';
import { getResolvedHitFeel } from '@/config/hitFeelSchema';
import { getResolvedAttackSpeedFor } from '@/config/attackSpeedSchema';
import { pushLoadFactor } from '@/systems/enemySeparation';
import {
  paceMove,
  DEFAULT_CONTACT_SOLVER_PARAMS,
  type ContactBody,
} from '@/systems/contactSolver';
import { getPlayerSolver } from '@/config/surroundConfig';
import { GAME_HEIGHT, GAME_WIDTH, PPU } from '@/config/gameConfig';
import { PLAYER_BOUNDS, clampToBounds } from '@/config/mapConfig';
import { playerColor } from '@/config/playerConfig';
import { WAITING_PLATFORM_LIFT } from '@/config/playerConfig';
import { landingX } from '@/systems/entranceMath';
import {
  ENTRANCE_KNOCKBACK_RADIUS_PX,
  floatOffsetY,
  isFloatDone,
  shouldTransformDuringFloat,
  isInKnockbackRange,
} from '@/systems/entranceTransformMath';
import type { AttackData } from '@/systems/AttackData';
import { lateralKnockbackDir } from '@/systems/dashMath';
import { EnergySystem, type AttackIntent } from '@/systems/EnergySystem';
import type { Enemy } from '@/entities/Enemy';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import {
  buildAttackCircle,
  buildAttackFan,
  buildAttackOBB,
  queryHits,
  queryHitsCircle,
  queryHitsFan,
  type AttackCircle,
  type AttackFan,
  type OBB,
  type Vec2,
} from '@/systems/hitDetection';
import { nearestPoint } from '@/systems/targetingMath';

/**
 * PlayerControlSystem — 玩家操控主迴圈。
 *
 * 輸入 → 移動 → 攻擊前搖 → hitDelay 到期做命中判定（對敵人套傷害/擊退）+ 播斬擊特效。
 * 攻擊用哪組 AttackData（普攻/招式）由 EnergySystem 決定（能量招式系統）：
 *  - 攻擊鍵按下 → ctx.energy.resolveAttackIntent() 取這次的 AttackData/倍率/isSkill。
 *  - 命中結算後 → ctx.energy.reportHit(isSkill, hitAny)（普攻打到人才充能）。
 * 支援 rectangle / circle / fan 三種判定形狀（走同一套 hitDetection）。
 * 只透過 context 取共用服務（input/player/effects/enemies/energy），不碰 GameScene 內部。
 */
export class PlayerControlSystem implements GameSystem {
  readonly name = 'PlayerControlSystem';
  private ctx!: GameContext;
  /** 用戶#3：per-player 變身進場浮起已經過秒（投幣起算）；-1=非浮起中。變身觸發旗（避免重複抽）。 */
  private floatElapsed = new Map<number, number>();
  private floatTransformed = new Set<number>();
  /** 用戶#3 VFX：per-player 浮起光 handle（浮起起手→跟隨→變身時收）。 */
  private riseGlowHandle = new Map<number, Phaser.GameObjects.Image | null>();

  /** 每玩家本次攻擊意圖（按鍵當下決定，hitDelay 到期據此結算）。 */
  private pendingIntent = new Map<number, AttackIntent | null>();

  /** 每玩家本次衝刺是否已扣過 Credit（一次衝刺最多扣 1）。 */
  private dashConsumedCredit = new Map<number, boolean>();

  /** 十六輪：每玩家衝刺充能格狀態（充能式衝刺——3 格、消耗 1/次、逐格回充）。 */
  private dashCharge = new Map<number, DashChargeState>();

  /** 十一輪#3：每玩家衝刺防護罩特效 handle（起手建、衝刺期間跟本體、結束淡出銷毀）。 */
  private dashShield = new Map<number, Phaser.GameObjects.Image | null>();
  /** 十六輪(追加)：被抓掙脫成功那刻請求「強制真攻擊」的 pid 集合（GrabSystem escape 觸發，下一幀 updatePlayer 消費揮擊）。 */
  private forcedAttackPids = new Set<number>();

  /** 十六輪(追加)：GrabSystem 掙脫成功呼叫 → 該玩家下一幀強制揮一次真攻擊（揮開打退 grabber，非只解除被抓）。 */
  requestForcedAttack(playerId: number): void {
    this.forcedAttackPids.add(playerId);
  }

  // ---- 十六輪：充能式衝刺 -------------------------------------------------

  /** 取某玩家衝刺充能狀態（惰性建立，初始滿格）。 */
  private dashChargeOf(playerId: number): DashChargeState {
    let s = this.dashCharge.get(playerId);
    if (!s) {
      s = makeDashChargeState(this.dashMaxChargesOf());
      this.dashCharge.set(playerId, s);
    }
    return s;
  }

  /** 衝刺最大充能格數（讀已解析 dash 參數；override 優先）。 */
  private dashMaxChargesOf(): number {
    return getResolvedDash().maxCharges;
  }

  /** 每格衝刺回充時間（秒）。 */
  private dashCooldownDurationOf(): number {
    return getResolvedDash().cooldownDuration;
  }

  /** 界騎 UI 接口：目前可用衝刺充能格數（0 ~ maxCharges）。 */
  getDashCharges(playerId: number): number {
    return this.dashChargeOf(playerId).currentCharges;
  }

  /** 界騎 UI 接口：衝刺最大充能格數（=3）。 */
  getDashMaxCharges(_playerId: number): number {
    return this.dashMaxChargesOf();
  }

  /** 界騎 UI 接口：當前正在回充那一格的冷卻進度 0~1（滿格回 0）。供逆時針壓黑動畫。 */
  getDashCooldownProgress(playerId: number): number {
    return dashCooldownProgress(this.dashChargeOf(playerId), this.dashMaxChargesOf(), this.dashCooldownDurationOf());
  }

  /** 十一輪#2：每玩家本次攻擊的 auto-aim 目標點（按攻擊當下算最近怪；resolveAttack 用它建 shape 朝向）。 */
  private pendingAim = new Map<number, Vec2 | null>();

  /** debug 繪製用：最近判定形狀（P1）。 */
  private lastOBB: OBB | null = null;
  private lastCircle: AttackCircle | null = null;
  private lastFan: AttackFan | null = null;
  private shapeFlash = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  update(dt: number): void {
    // buff 倍率/護盾每幀套（目前只影響 P1 玩家實體；per-player buff 之後 S5 再細分）。
    this.applyBuffState();
    // S4：對每個 player（P1 人類 + P2-P4 AI）各自跑操控結算。
    for (const player of this.ctx.players) {
      // 十六輪：衝刺充能逐格回充（每幀推進，不受待機/進場影響）。
      this.dashCharge.set(player.playerId, tickDashCharge(this.dashChargeOf(player.playerId), dt, this.dashMaxChargesOf(), this.dashCooldownDurationOf()));
      this.updatePlayer(player, dt);
    }
    if (this.shapeFlash > 0) this.shapeFlash -= dt;
  }

  /** 單一 player 的操控主迴圈（人類/AI 皆同，只差 InputSource）。 */
  private updatePlayer(player: GameContext['player'], dt: number): void {
    const { energy, credit } = this.ctx;
    const pid = player.playerId;

    // 投幣（C 鍵，Unity: 最先判斷不被任何狀態擋）：若在待機則進場。
    // Credit +100 由 CreditSystem.update 處理（順序在本系統前）；此處只負責 waiting→EnterGame。
    // C 綁本地 P1；AI 加入即自動投幣進場。
    if (typeof player.isWaiting === 'function' && player.isWaiting()) {
      const coinPressed = pid === this.ctx.player.playerId && this.ctx.input.justPressedCoin();
      const aiAutoCoin = player.kind === 'ai'; // AI 加入即自動投幣進場
      if (coinPressed || aiAutoCoin) {
        if (aiAutoCoin) credit.addCredit(pid, COIN_INSERT_AMOUNT); // AI 自投幣(P1 由 CreditSystem 加)
        // 用戶#3：投幣→先在待機區「變身浮起表演」（浮起→發光變身→降臨），非直接進場。
        player.startTransformFloat?.(); // 內含離開待機態；表演中由 isTransformFloating gate 不吃操控
        this.floatElapsed.set(pid, 0);
        this.floatTransformed.delete(pid);
        // VFX：浮起光起手（貼角色，跟隨到變身時收）。
        const gp = player.getPosition?.();
        this.riseGlowHandle.set(pid, gp ? (this.ctx.effects?.riseGlowStart?.(gp.x, gp.y) ?? null) : null);
      }
      return; // 待機中不可移動/攻擊
    }

    // 用戶#3：變身浮起表演中（待機區）——浮起位移 + 到時機發光變身 + 浮完→降臨(enterGame)。不吃操控。
    if (typeof player.isTransformFloating === 'function' && player.isTransformFloating()) {
      const elapsed = (this.floatElapsed.get(pid) ?? 0) + dt;
      this.floatElapsed.set(pid, elapsed);
      player.updateTransformFloat?.(floatOffsetY(elapsed));
      // VFX：浮起光跟隨角色（浮起中）。
      const fp = player.getPosition?.();
      if (fp) this.ctx.effects?.riseGlowUpdate?.(this.riseGlowHandle.get(pid) ?? null, fp.x, fp.y);
      // 浮到時機 → 發光變身（隨機抽英雄）+ 變身閃 VFX + 收浮起光。旗標避免重複抽。
      if (!this.floatTransformed.has(pid) && shouldTransformDuringFloat(elapsed)) {
        this.floatTransformed.add(pid);
        this.ctx.transform?.transformToRandomHero?.(pid);
        if (fp) this.ctx.effects?.transformFlash?.(fp.x, fp.y); // 發光變身瞬間閃
        this.ctx.effects?.riseGlowEnd?.(this.riseGlowHandle.get(pid) ?? null); // 收浮起光
        this.riseGlowHandle.delete(pid);
      }
      // 浮完 → 結束浮起、降臨（沿用既有拋物線進場到場上落點）。
      if (isFloatDone(elapsed)) {
        player.endTransformFloat?.();
        this.floatElapsed.delete(pid);
        // 保底：若變身時機沒觸發到（極短 floatSec）也收掉浮起光。
        this.ctx.effects?.riseGlowEnd?.(this.riseGlowHandle.get(pid) ?? null);
        this.riseGlowHandle.delete(pid);
        this.enterGame(player); // 降臨（拋物線進場）
      }
      return;
    }

    // 降臨中（拋物線）：推進進場動畫；落地當幀→震退周圍敵人（用戶#3 ④）。變身已在浮起階段完成。
    if (typeof player.isEntering === 'function' && player.isEntering()) {
      const stillEntering = player.updateEntrance(dt);
      if (!stillEntering) this.landingKnockback(player); // 剛落地 → 震退周圍敵人
      return;
    }

    // 用戶 #4：守護波開場導引走位期間鎖操作——不吃玩家輸入（走位由 GuardEvent 驅動 player.move）。
    if (this.ctx.scriptedControl) return;

    // Credit 耗盡倒數歸零 → 回下方面板待機（投幣循環）。投幣可中途解除耗盡（在 CreditSystem）。
    if (typeof credit.consumeJustExpired === 'function' && credit.consumeJustExpired(pid)) {
      // 十五輪④：回待機解除變身（變回凡人，對齊 Unity 回待機 revert transform）。
      this.ctx.transform?.revertToHuman?.(pid);
      // 十五輪⑤：待機 Y 套 WAITING_PLATFORM_LIFT（站台座頂面），與 GameScene 開場待機一致（原本沒減 lift→位置偏低壓面板）。
      const w = this.ctx.getWaitingAnchor(pid);
      player.setWaiting(w.x, w.y - WAITING_PLATFORM_LIFT);
      return;
    }

    const src = player.inputSource;
    if (!src) return; // 無 InputSource → 不操控

    // ★2 新事件：麻痺（stun）中 → 不吃任何輸入（移動/攻擊/衝刺），倒數自動解除。★不扣血、純定住。
    //   放在被抓 gate 前後皆可（互斥狀態）；tickStun 推進倒數+閃爍視覺；仍麻痺則 early-return。
    if (typeof player.isStunned === 'function' && player.isStunned()) {
      player.tickStun?.(dt);
      this.clearDashShield(pid); // 麻痺打斷衝刺→防護罩不殘留
      if (player.isStunned()) return; // 仍麻痺：這幀不操控
    }

    // 十五輪 bug①：被抓中 → 不吃輸入（GrabSystem.setGrabbed 已強制 idle 待機動畫；此 gate 防 PlayerControl 每幀用輸入 move/attack 覆蓋掉 grab idle）。
    //   同時清 dash 防護罩（被抓打斷衝刺→防護罩不殘留，見 bug④）。
    if (typeof player.isGrabbed === 'function' && player.isGrabbed()) {
      this.clearDashShield(pid);
      // 十六輪 bug1：被抓時放行「掙脫攻擊輸入偵測」——按攻擊登記掙脫輸入(不實際普攻/保持 idle)，
      //   GrabSystem consume 當掙脫 edge。修 bug①(0019b49 return 把掙脫攻擊也擋掉→被抓連按打不出去無法掙脫)。
      if (src.justPressedAttack()) player.registerStruggleInput?.();
      return;
    }


    // hitFeel 玩家 hitlag 推進：計時歸零 or 攻擊結束 → 恢復（在移動/衝刺前 tick，isInHitlag 期間 move/dash 自會凍結）。
    if (typeof player.tickHitlag === 'function') player.tickHitlag(dt);

    // 衝刺觸發（edge；需可攻擊、非衝刺中、且有充能格）。
    if (src.justPressedDash() && !player.isDashing() && credit.canAttack(pid) && canDashCharge(this.dashChargeOf(pid))) {
      // 十六輪：消耗一格衝刺充能（滿格→掉格則起算該格冷卻）。
      const consumed = consumeDashCharge(this.dashChargeOf(pid), this.dashMaxChargesOf());
      this.dashCharge.set(pid, consumed.state);
      this.clearDashShield(pid); // 十五輪 bug④：重新衝刺前先清前一個防護罩 handle（防反覆 dash 舊 fx 殘留/洩漏）
      player.startDash(src.getMoveVector());
      this.dashConsumedCredit.set(pid, false);
      // 十一輪#3：衝刺起手建防護罩特效 handle（持續整個衝刺、跟本體移動）。純視覺。
      const dd = player.getDashDir?.() ?? { x: player.getFacing?.() ?? 1, y: 0 };
      const dpos = player.getPosition?.();
      if (dpos) {
        const handle = this.ctx.effects?.playerDash?.(dpos.x, dpos.y, Math.atan2(dd.y, dd.x), playerColor(pid)) ?? null;
        this.dashShield.set(pid, handle);
      }
    }

    if (player.isDashing()) {
      player.updateDash(dt);
      this.resolveDashHits(player);
      // 十一輪#3：防護罩每幀跟當前本體位置 + 朝衝刺方向（修「停起始點、貼殘影」bug）。
      const handle = this.dashShield.get(pid) ?? null;
      if (handle) {
        const dd = player.getDashDir?.() ?? { x: player.getFacing?.() ?? 1, y: 0 };
        const dpos = player.getPosition?.();
        if (dpos) this.ctx.effects?.updatePlayerDashShield?.(handle, dpos.x, dpos.y, Math.atan2(dd.y, dd.x));
      }
    } else {
      // 十一輪#3：衝刺結束（非 dashing）→ 若有防護罩 handle，淡出銷毀（bug④：統一走 clearDashShield）。
      this.clearDashShield(pid);
      if (credit.canAct(pid)) {
        const mv = src.getMoveVector();
        // 推怪負重（用戶）：有移動意圖才算——數真空圈內可推敵人(非菁英/非grabber)→降速。
        const moving = mv.x !== 0 || mv.y !== 0;
        player.setPushLoadMultiplier?.(moving ? this.computePushLoad(player) : 1);
        // ContactSolver 階段②：playerSolver==='contactSolver' → 移動前先過 paceMove（速度層預減速，
        //   玩家 vs 怪/玩家 vs 玩家，撞進去前先削掉超出質量份額的接近分量）。★預設 legacy 不動手感。
        const adjustedMv = getPlayerSolver() === 'contactSolver'
          ? this.applyPlayerPaceMove(player, mv, dt)
          : mv;
        player.move(adjustedMv, dt);
      }
      if ((src.justPressedAttack() || this.forcedAttackPids.delete(pid)) && credit.canAttack(pid)) {
        const intent = energy.resolveAttackIntent(pid);
        // 第十一輪#1：攻擊速度 override（per-character）→ 冷卻/前搖/動畫倍率。
        const as = getResolvedAttackSpeedFor(
          typeof player.getCharacterKey === 'function' ? player.getCharacterKey() : '',
        );
        // 十三輪軟鎖修（用戶釐清：讓角色往怪方向去，含斜角）：
        //   lunge 位移「往怪的實際方向（斜向 dx,dy）」前撲靠近——玩家有推方向→往玩家推的方向（含斜角，意志優先）；
        //   無推→往最近怪的實際方向（斜向）。面向仍只取左右（sign dx）驅動 attack 揮動畫（角色只左右揮，動畫限制）。
        //   位移斜向靠近 + 面向左右揮 兩者分開。
        const ppos = typeof player.getPosition === 'function' ? player.getPosition() : null;
        const mvNow = src.getMoveVector();
        let lungeDX = 0;
        let lungeDY = 0;
        if (Math.abs(mvNow.x) > 1e-6 || Math.abs(mvNow.y) > 1e-6) {
          // 軟鎖：玩家有推方向 → lunge 往玩家推的方向（含斜角，玩家意志優先，即使背對怪）。
          lungeDX = mvNow.x;
          lungeDY = mvNow.y;
        } else if (ppos) {
          // 無輸入 → lunge 往最近怪的實際方向（斜向前撲靠近）。
          const nearest = nearestPoint(ppos, this.enemyHitCenters());
          if (nearest) { lungeDX = nearest.x - ppos.x; lungeDY = nearest.y - ppos.y; }
        }
        // 面向只取左右（sign dx）→ attack 揮動畫（無左右分量 fallback 現有 facing）。
        const sideDirX = Math.abs(lungeDX) > 1e-6 ? Math.sign(lungeDX) : (player.getFacing?.() ?? 1);
        if (ppos && typeof player.faceTowards === 'function') {
          player.faceTowards(ppos.x + sideDirX); // 依左右側轉向（揮動畫左右）
        }
        // 十三輪#1 徹底解：斬光特效「綁揮擊幀」——動畫播到揮出幀(ATTACK_SWING_FRAME)才觸發（非計時），
        //   嚴格對齊動作：動畫沒揮到→不出特效；連打 restart→重播到揮擊幀才出。傷害判定仍走 hitDelay（解耦、手感準）。
        const swingVfx = intent.attack.vfxKey ? () => {
          const p = typeof player.getPosition === 'function' ? player.getPosition() : { x: 0, y: 0 };
          const fac = player.getFacing?.() ?? 1;
          const vfxKey = intent.attack.vfxKey!;
          // 攻擊 shape 中心（水平 facing，無 aim）當特效位置；scale/alpha 讓位（不蓋角色）。
          const off = (intent.attack.offsetX ?? 0) * PPU * (this.ctx.energy.getAttackScale?.() ?? 1);
          const ex = p.x + fac * off;
          const ey = p.y + (intent.attack.offsetY ?? 0) * PPU;
          const baseScale = (this.ctx.effects.getEffectScale?.(vfxKey) ?? 1) * 0.72;
          this.ctx.effects.play(vfxKey, ex, ey, fac, baseScale, undefined, 0.7);
        } : undefined;
        if (player.tryStartAttack(intent.attack.hitDelay / as.mult, as.cooldown, as.animTimeScale, swingVfx)) {
          this.pendingIntent.set(pid, intent);
          this.pendingAim.set(pid, null); // ★攻擊判定走水平 facing（動畫左右）；lunge 位移往怪斜向。
          // 軟鎖 lunge 前撲：往怪/玩家輸入的實際方向（含斜角）靠近；都無→用 facing 水平 fallback。
          if (Math.abs(lungeDX) > 1e-6 || Math.abs(lungeDY) > 1e-6) {
            player.startLunge?.(lungeDX, lungeDY);
          } else {
            player.startLunge?.(player.getFacing?.() ?? 1, 0);
          }
        }
      }
    }

    // 十一輪#2：每幀推進 lunge 位移（攻擊前戳，衰減不回彈）。衝刺中也讓 lunge 收尾（updateLunge 內部凍結由 hitlag/grabbed 管）。
    player.updateLunge?.(dt);

    // 計時器；hitDelay 到期做命中判定（衝刺中仍讓在途攻擊結算）。
    const pending = this.pendingIntent.get(pid) ?? null;
    if (player.updateTimers(dt) && pending) {
      this.resolveAttack(player, pending, this.pendingAim.get(pid) ?? null);
      this.pendingIntent.set(pid, null);
      this.pendingAim.set(pid, null);
    }

    // 地圖邊界夾限（LateUpdate 性質：移動/衝刺後才修正）。
    // 進場中(isJumping)不夾限（從場外跳進來，項目 3 待機區進場鉤子）；只在真超界才寫回。
    // 防呆：若 player 未提供 getPosition/setPosition（如精簡測試 stub）則跳過（對應 Unity 的 null-guard）。
    if (
      !player.isJumping &&
      typeof player.getPosition === 'function' &&
      typeof player.setPosition === 'function'
    ) {
      const pos = player.getPosition();
      const c = clampToBounds(pos.x, pos.y, PLAYER_BOUNDS); // 下界收到面板上緣之上（不進下方面板）
      if (c.changed) player.setPosition(c.x, c.y);
    }

    // 腳下真空環（搜索圈）跟隨玩家位置（夾限後才同步，環中心=玩家 y-offset）。
    if (typeof player.syncFootGlow === 'function') player.syncFootGlow();
  }

  /**
   * 十五輪 bug④：清除某玩家的衝刺防護罩特效 handle（淡出銷毀 + 從 map 移除）。冪等。
   * 統一入口：dash 結束 / 重新 dash 前 / 被抓打斷衝刺，都走此清（防反覆 dash 舊 fx 殘留/洩漏）。
   */
  private clearDashShield(pid: number): void {
    const handle = this.dashShield.get(pid);
    if (handle) {
      this.ctx.effects?.endPlayerDashShield?.(handle);
    }
    this.dashShield.delete(pid);
  }

  /**
   * EnterGame（投幣進場）：從待機點（下方面板）拋物線跳進場落點。
   * setFootGlowVisible(true) 在 startEntrance 內；isJumping 進場中免夾限；落地顯頭上 UI。
   */
  private enterGame(player: GameContext['player']): void {
    const start = this.ctx.getWaitingAnchor(player.playerId);
    const endX = landingX(player.playerId, GAME_WIDTH * 0.5);
    const endY = GAME_HEIGHT * 0.5;
    player.startEntrance(start.x, start.y, endX, endY);
  }

  /**
   * 用戶#3 ④：變身降臨落地 → 以落點為中心震退範圍內敵人（衝擊波）+ 落地衝擊/震退波 VFX。
   * 讀 ctx.getEnemies，範圍內非菁英/非蓄力怪 applyLandingKnockback。
   */
  private landingKnockback(player: GameContext['player']): void {
    const land = player.getPosition?.();
    if (!land) return;
    // ★用戶#1 bug 修：落地光效（降臨/震退）貼「腳下落地點」而非 getPosition()（=sprite 中心→會偏頭上）。
    //   getFootPosition() = 中心往下偏腳部（同真空環）；fallback 用 land（無 getFootPosition 時）。
    const foot = player.getFootPosition?.() ?? land;
    this.ctx.effects?.descendImpact?.(foot.x, foot.y);
    this.ctx.effects?.shockwaveRing?.(foot.x, foot.y);
    // 震退判定仍以腳下落地點為圓心（衝擊波從地面擴散，對齊視覺）。
    const enemies = this.ctx.getEnemies?.() ?? [];
    for (const e of enemies) {
      const c = e.getHitCenter?.();
      if (!c) continue;
      if (isInKnockbackRange(c, foot, ENTRANCE_KNOCKBACK_RADIUS_PX)) e.applyLandingKnockback?.(foot);
    }
  }

  /** 依 BuffSystem 聚合倍率設定玩家 stat 倍率/護盾（同 stat 多來源已相乘+clamp）。 */
  private applyBuffState(): void {
    const { buff, player } = this.ctx;
    // 移速 / 衝刺速度：用聚合倍率（單點 getStatMultiplier，含 clamp）。
    player.setSpeedMultiplier(buff.getStatMultiplier('moveSpeed'));
    player.setDashSpeedMultiplier(buff.getStatMultiplier('dashSpeed'));
    // 護盾：頭盔 Shield（純狀態，非 stat 倍率）。
    player.setShielded(buff.isActive('Shield'));
  }

  /** 命中敵人後的 buff 附加效果：Lightning(麻痺+連鎖) / Freeze(凍結)。 */
  private applyOnHitBuffs(hitEnemies: { getHitCenter(): { x: number; y: number }; applyStun(s: number): void }[]): void {
    const { buff } = this.ctx;
    if (hitEnemies.length === 0) return;

    if (buff.isActive('Freeze')) {
      for (const e of hitEnemies) e.applyStun(FREEZE_SEC);
    }
    if (buff.isActive('Lightning')) {
      // 主目標麻痺 + 連鎖最近 N 隻（範圍內）各傷 + 麻痺。
      const main = hitEnemies[0];
      main.applyStun(LIGHTNING_PARALYZE_SEC);
      const center = main.getHitCenter();
      const rangePx = LIGHTNING_CHAIN_RANGE * PPU;
      const others = this.ctx
        .getEnemies()
        .filter((e) => !hitEnemies.includes(e as never))
        .map((e) => ({ e, d: this.dist2(center, e.getHitCenter()) }))
        .filter((o) => o.d <= rangePx * rangePx)
        .sort((a, b) => a.d - b.d)
        .slice(0, LIGHTNING_CHAIN_COUNT);
      const from = this.ctx.player.getPosition();
      for (const o of others) {
        o.e.takeHit(LIGHTNING_CHAIN_DAMAGE, getResolvedDash().knockback, from);
        o.e.applyStun(LIGHTNING_PARALYZE_SEC);
      }
    }
  }

  private dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  /**
   * ContactSolver 階段②：玩家 paceMove（速度層預減速）。playerSolver==='contactSolver' 才呼叫。
   *   把玩家「本幀想走的世界位移」丟給 paceMove，對照場上障礙（可推的敵人 + 其他玩家）削掉
   *   超出質量份額的接近分量 → 回傳調整後的 moveVec（方向 sign 不變、facing/動畫仍正確）。
   *   ★不改 Player.move 內部（clamp/facing/動畫不動）；玩家 vs 不可推者(菁英牆/grabber)＝無限質量推不動。
   *   時序：本道在 move 之前（速度層）；邊界 clamp 仍在最後（LateUpdate），不變量不破。
   */
  private applyPlayerPaceMove(
    player: GameContext['player'],
    mv: { x: number; y: number },
    dt: number,
  ): { x: number; y: number } {
    if (mv.x === 0 && mv.y === 0) return mv;
    const speedPx = player.getMoveSpeedPx?.() ?? 0;
    const step = speedPx * dt;
    if (step <= 0) return mv;
    const center = player.getVacuumCenter?.() ?? player.getHitCenter();
    const selfRadius = player.getBodyRadius?.() ?? player.getVacuumRadius?.() ?? player.getHitRadius();
    const selfId = `player${player.playerId}`;
    const self: ContactBody = { id: selfId, x: center.x, y: center.y, radius: selfRadius, mass: selfRadius, canBePushed: true };
    // 障礙：可推的敵人（菁英immovable/grabber/dead → canBePushed=false 或跳過）+ 其他玩家。
    const bodies: ContactBody[] = [self];
    for (const e of this.ctx.getEnemies()) {
      if (e.isDead() || e.isGrabber()) continue;
      const ec = e.getHitCenter();
      const r = e.getBodyRadius();
      bodies.push({ id: `enemy${e.id}`, x: ec.x, y: ec.y, radius: r, mass: r, canBePushed: !e.isImmovable() });
    }
    for (const other of this.ctx.players) {
      if (other === player) continue;
      const oc = other.getVacuumCenter?.() ?? other.getHitCenter();
      const or = other.getBodyRadius?.() ?? other.getVacuumRadius?.() ?? other.getHitRadius();
      bodies.push({ id: `player${other.playerId}`, x: oc.x, y: oc.y, radius: or, mass: or, canBePushed: true });
    }
    // 想走的世界位移 = 方向 × 本幀步長。
    const desired = { x: mv.x * step, y: mv.y * step };
    const { move } = paceMove(self, desired, bodies, DEFAULT_CONTACT_SOLVER_PARAMS);
    // 反算回 moveVec（÷step）：方向可能因削掉接近分量而改，但 magnitude<=原、sign 一致 → facing/動畫正確。
    return { x: move.x / step, y: move.y / step };
  }

  /**
   * 推怪負重降速倍率（用戶：敵人越多推越有阻力）：數玩家真空圈內「可推敵人」（非菁英immovable/非grabber）
   * = pushedCount → pushLoadFactor(count, pushResistance, pushMinSpeedFactor)。推越多越慢、下限 0.3。
   */
  private computePushLoad(player: GameContext['player']): number {
    const center = player.getVacuumCenter?.() ?? player.getHitCenter();
    const vac = player.getVacuumRadius?.() ?? player.getHitRadius();
    let pushed = 0;
    for (const e of this.ctx.getEnemies()) {
      if (e.isDead() || e.isImmovable() || e.isGrabber()) continue; // 菁英/grabber 不算負重
      const ec = e.getHitCenter();
      const r = vac + e.getBodyRadius();
      if (this.dist2(center, ec) <= r * r) pushed += 1;
    }
    return pushLoadFactor(pushed, PLAYER_CONFIG.pushResistance, PLAYER_CONFIG.pushMinSpeedFactor);
  }

  /**
   * 衝刺命中：每幀以半徑 dashRadius 的圓抓範圍內敵人，每隻本次衝刺只打一次（去重），
   * 造成 dashDamage + 側向擊退（垂直於衝刺方向、依敵人在哪側決定左右）。不充能。
   */
  private resolveDashHits(player: GameContext['player']): void {
    const pos = player.getPosition();
    const dir = player.getDashDir();
    // 坐騎：範圍放大（命中數 3→5 近似）＝半徑 × (1 + extraHits/基準)。
    const mountMult = this.ctx.buff.isActive('mount')
      ? 1 + MOUNT_DASH_EXTRA_HITS / 3
      : 1;
    const dash = getResolvedDash(); // 衝刺可調：override 優先 + cache
    const radiusPx = dash.radius * PPU * mountMult;

    for (const e of this.ctx.getEnemies()) {
      const c = e.getHitCenter();
      const dx = c.x - pos.x;
      const dy = c.y - pos.y;
      // 圓範圍：把敵人碰撞半徑納入。
      const reach = radiusPx + e.getHitRadius();
      if (dx * dx + dy * dy > reach * reach) continue;
      if (!player.tryDashHit(e)) continue; // 一隻一次

      // 側向擊退：垂直於衝刺方向，依敵人在衝刺線哪側決定左右（純函式 lateralKnockbackDir）。
      const lat = lateralKnockbackDir(dir, { x: dx, y: dy });
      // Enemy.takeHit 以 (enemy - fromPos) 為擊退方向：令 fromPos = enemy - lat → 沿 lat 推。
      const fromPos = { x: c.x - lat.x, y: c.y - lat.y };
      e.takeHit(dash.damage, dash.knockback, fromPos);
      const attackerId = player.playerId;
      e.recordDamageFrom(attackerId, dash.damage); // per-enemy 傷害歸屬
      // 衝刺傷害貢獻（per-player，additive）；衝刺命中不充能（不呼叫 energy.reportHit）。
      this.ctx.jp.recordDamage(attackerId, dash.damage);
      // Credit 扣 + COMBO + JP 共享池：一次衝刺最多一次。
      if (!this.dashConsumedCredit.get(attackerId)) {
        this.dashConsumedCredit.set(attackerId, true);
        this.ctx.credit.consumeOnHit(attackerId);
        this.ctx.combo.onHit(attackerId);
        this.ctx.jp.notifyCreditSpent(1);
      }
    }
  }

  /** 十一輪#2：存活敵人 hitCenter 清單（auto-aim 找最近怪用）。dead 排除。 */
  private enemyHitCenters(): Vec2[] {
    const out: Vec2[] = [];
    for (const e of this.ctx.getEnemies()) {
      if (typeof e.isDead === 'function' && e.isDead()) continue;
      out.push(e.getHitCenter());
    }
    return out;
  }

  /** 依 intent 的 AttackData 形狀建立判定、查命中、套傷害；回報 EnergySystem 充能。aim=auto-aim 目標（十一輪#2，null→水平 facing）。 */
  private resolveAttack(player: GameContext['player'], intent: AttackIntent, aim: Vec2 | null): void {
    const { energy } = this.ctx;
    const attack: AttackData = intent.attack;
    const pos = player.getPosition();
    const facing = player.getFacing();
    // 用戶新大功能：二段變身攻擊範圍加成——把攻擊 shape 整體 scale ×二段倍率（★flag 關/非二段 → ×1 不變）。
    const scale = energy.getAttackScale() * this.ctx.transform.getSecondTransformAttackRangeMult(player.playerId);
    // 十一輪#2 auto-aim：aim 非空 → 攻擊 shape 朝 aim；null → 水平 facing（十三輪#1#2 起玩家攻擊 aim 恆 null=只左右）。
    const aimArg = aim ?? undefined;
    // 傷害 = 基礎 × 能量倍率 × damage stat 聚合倍率（二段變身等，含 clamp）。
    const buffDmgMult = this.ctx.buff.getStatMultiplier('damage');
    const dmg = EnergySystem.applyMultiplier(attack.damage, intent.multiplier * buffDmgMult);

    const hits: Enemy[] = [];

    if (attack.shapeType === 'circle') {
      const circle = buildAttackCircle(attack, pos, facing, scale, aimArg);
      hits.push(...queryHitsCircle(circle, this.ctx.getEnemies()));
      this.lastCircle = circle;
      this.lastOBB = null;
      this.lastFan = null;
    } else if (attack.shapeType === 'fan') {
      const fan = buildAttackFan(attack, pos, facing, scale, aimArg);
      hits.push(...queryHitsFan(fan, this.ctx.getEnemies()));
      this.lastFan = fan;
      this.lastOBB = null;
      this.lastCircle = null;
    } else {
      const obb = buildAttackOBB(attack, pos, facing, scale, aimArg);
      hits.push(...queryHits(obb, this.ctx.getEnemies()));
      this.lastOBB = obb;
      this.lastCircle = null;
      this.lastFan = null;
    }

    const attackerId = player.playerId;
    let dealt = 0;
    for (const e of hits) {
      e.takeHit(dmg, attack.knockback, pos); // takeHit 契約不變
      e.recordDamageFrom(attackerId, dmg); // per-enemy 傷害歸屬（寶盒擊殺分）
      dealt += dmg;
    }
    const hitAny = hits.length > 0;

    // 頭盔命中效果：Lightning(麻痺+連鎖) / Freeze(凍結)。
    this.applyOnHitBuffs(hits);

    this.shapeFlash = 0.12;
    // 十三輪#1 徹底解：斬光特效已改「綁 attack 揮擊幀」（tryStartAttack 的 onSwingFrame 於攻擊觸發時註冊），
    //   非在此 hitDelay 計時播（移除原 90ms delayedCall）。此處只做傷害判定/充能（判定準時，與特效視覺解耦）。

    // 充能回報：普攻打到人才 +1（招式命中不充）。
    energy.reportHit(attackerId, intent.isSkill, hitAny);
    // 用戶新大功能：二段變身能量累積（★flag 關/未一段變身 → no-op）。
    // ★用戶調整：①按實際命中隻數累加（打中 N 隻 → +N 份 energyPerHit，非一次揮擊只 1 份）
    //   ②普攻+技能命中都累（移除 !intent.isSkill 限制）。energyPerHit/fillThreshold 數值先不動（實機試集滿速度）。
    if (hits.length > 0) {
      this.ctx.transform?.accumulateSecondTransform?.(
        attackerId,
        SECOND_TRANSFORM_CONFIG.energyPerHit * hits.length,
      );
    }
    if (hitAny) {
      this.ctx.credit.consumeOnHit(attackerId);
      this.ctx.combo.onHit(attackerId);
      this.ctx.jp.notifyCreditSpent(1); // ← 共享池，不加 playerId
      this.ctx.jp.recordDamage(attackerId, dealt); // ← per-player 貢獻（傷害總和）
      // hitFeel 玩家側 hitlag：命中敵人瞬間凍結玩家自身動畫+位移（"砍進肉卡住"）。
      // 同幀多命中只觸發一次（startHitlag 內建 inHitlag 去重）；純表演不動數值。第十一輪：讀 resolved override。
      const hf = getResolvedHitFeel();
      if (hf.enabled && typeof player.startHitlag === 'function') {
        player.startHitlag(hf.playerHitlagDuration);
      }
    }
  }

  // --- debug 繪製取用 ---
  getDebugOBB(): OBB | null {
    return this.shapeFlash > 0 ? this.lastOBB : null;
  }

  getDebugCircle(): AttackCircle | null {
    return this.shapeFlash > 0 ? this.lastCircle : null;
  }

  getDebugFan(): AttackFan | null {
    return this.shapeFlash > 0 ? this.lastFan : null;
  }
}
