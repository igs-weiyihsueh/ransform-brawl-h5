import type Phaser from 'phaser';
import type { IPlayerControlStrategy } from '@/systems/control/IPlayerControlStrategy';
import type { PlayerControlSystem } from '@/systems/PlayerControlSystem';
import type { GameContext } from '@/systems/GameContext';
import type { Enemy } from '@/entities/Enemy';
import { DOUQI_CONTROL_CONFIG } from '@/config/douqiConfig';
import { effectivePlayerBounds } from '@/config/mapConfig';
import { selectFusionTarget, type AimCandidate } from '@/systems/fusionAimMath';

/** 衝刺目標種類（v45 模型）：鎖怪 / 指空地走位 / 朝道具（階段 1 道具走位未啟用，保留列舉）。 */
type DashMode = 'enemy' | 'empty' | 'item';

/** 單一玩家（pid）的鬥氣衝刺狀態（策略內部追蹤，不污染 PlayerControlSystem）。 */
interface DouqiPlayerState {
  /** 是否正在衝刺中（true→每幀朝 dashTarget 推進）。 */
  dashing: boolean;
  /** 本次衝刺落點（世界座標 px）。 */
  dashTarget: { x: number; y: number };
  /** 衝刺目標種類。 */
  dashMode: DashMode;
  /** 鎖定的敵人參照（dashMode==='enemy' 時有效；到達→揮擊）。 */
  lockedEnemy: Enemy | null;
  /** 下次允許攻擊（＝觸發衝刺）的時間戳（performance.now() 基準，ms）。唯一移動節流。 */
  nextAttackAllowedAt: number;
  /** 本次衝刺已推進距離（px）；用於 empty/item 走位到達 dashDistancePx 收尾。 */
  dashTraveledPx: number;
  /** ★視覺：融合鎖定框 handle（跟鎖定敵；瞄準/衝刺中顯示，無鎖定/收尾時收）。 */
  lockMarker: Phaser.GameObjects.Graphics | null;
  /** ★視覺：鎖定框當前跟的敵人（供偵測鎖定目標切換→更新/重建框）。 */
  markedEnemy: Enemy | null;
  /** ★視覺：衝刺護盾特效 handle（衝刺起手播、收尾停）。 */
  dashShield: Phaser.GameObjects.Image | null;
}

/**
 * DouqiControlStrategy — 鬥氣模式操控策略（衝刺代移動 / 融合瞄準 / 衝刺攻擊）。
 *
 * ★v45 核心模型（移動＋攻擊合一）：
 *  - 普通走路速度＝0；「所有位移都靠衝刺」。每按一次攻擊＝觸發一次衝刺。
 *  - 唯一節流＝attackCooldownMs（防連點瞬移），以 performance.now() 記 per-player nextAttackAllowedAt。
 *  - 融合瞄準：讀滑鼠世界座標算 aimAngle，於 aimConeHalfAngleDeg 錐內、searchRadiusPx 內用
 *    selectFusionTarget 選「加權角度差最小」的敵人鎖定；錐內無怪→朝滑鼠方向走位 dashDistancePx。
 *  - 衝刺期間護盾無敵（dashShieldInvuln）：dash 起手 setShielded(true)、收尾 setShielded(false)。
 *  - 命中不自造：到達鎖定敵人 attackReachPx + hitRadius 內→呼 sys.applyDouqiSwingHit（走現有 takeHit/ContactSolver）。
 *
 * ★邊界／非戰鬥守衛一律「委派 sys.updatePlayer」不重寫：
 *  - AI player（無 getPointerWorld 滑鼠來源）：整幀走普通路徑（鬥氣只作用於人類滑鼠操控）。
 *  - 待機（isWaiting）/ 被暈（isStunned）/ 被抓（isGrabbed）：委派 sys.updatePlayer，
 *    讓投幣進場、變身、被抓掙脫、暈眩全部照舊運作。
 *
 * ★策略只負責「每幀操控主迴圈」；state 於本策略內以 Map<pid> 追蹤，命中/傷害在 PlayerControlSystem。
 */
export class DouqiControlStrategy implements IPlayerControlStrategy {
  private readonly cfg = DOUQI_CONTROL_CONFIG;
  /** per-pid 鬥氣衝刺狀態。 */
  private readonly state = new Map<number, DouqiPlayerState>();

  constructor(private readonly sys: PlayerControlSystem) {}

  update(dt: number): void {
    const now = performance.now();
    for (const player of this.sys.ctxRef.players) {
      // 1) AI（無滑鼠瞄準來源）→ 整幀委派普通路徑，鬥氣不作用於 AI。
      const src = player.inputSource;
      const canAim = typeof src?.getPointerWorld === 'function';
      if (player.kind === 'ai' || src == null || !canAim) {
        this.sys.updatePlayer(player, dt);
        continue;
      }

      // 2) ★白名單守衛（變身-leader 架構建議，根治同型 bug）：只有「明確完全可操作」才跑鬥氣 tickPlayer；
      //    否則一律委派 sys.updatePlayer 走既有路徑。★這樣任何 updatePlayer 的 early-return 型態
      //    （待機/變身浮起/降臨/被暈/被抓/導引鎖操作/credit 耗盡回待機，含未來新增）都自動委派，
      //    不用再一個個列黑名單（原黑名單已漏兩次同型：先漏 float/entering、又漏 credit justExpired）。
      const credit = this.sys.ctxRef.credit;
      const operable =
        !this.sys.ctxRef.scriptedControl &&
        !(player.isWaiting?.() ?? false) &&
        !(player.isTransformFloating?.() ?? false) &&
        !(player.isEntering?.() ?? false) &&
        !(player.isStunned?.() ?? false) &&
        !(player.isGrabbed?.() ?? false) &&
        credit.canAct(player.playerId) && // 耗盡倒數中不可操作（走待機/耗盡表演）
        !credit.isJustExpired(player.playerId); // ★本幀剛過期→委派 updatePlayer 由它 consume 並 ReturnToWaiting（非消耗窺看，不搶消耗）
      if (!operable) {
        // 若此幀正處於衝刺，先安全收尾（關護盾、停視覺）；並收鎖定框（委派期間不顯鬥氣鎖定 UI）。
        this.endDash(player);
        this.setLockMarker(this.stateOf(player.playerId), null);
        this.sys.updatePlayer(player, dt);
        continue;
      }

      this.tickPlayer(player, dt, now);
    }
  }

  /** 單一人類玩家的鬥氣結算（衝刺推進 or 觸發新衝刺）。 */
  private tickPlayer(player: GameContext['player'], dt: number, now: number): void {
    const st = this.stateOf(player.playerId);

    // A) 衝刺推進中：朝 dashTarget 移動；沿途鎖怪到達→揮擊；空地/道具到達或超距→收尾。
    if (st.dashing) {
      this.advanceDash(player, st, dt);
      return;
    }

    // B) 未在衝刺：按攻擊 + 冷卻好 + ★credit 可攻擊（比照 normal，credit 見底不能衝刺攻擊、走投幣經濟）→ 觸發一次衝刺。
    const src = player.inputSource;
    if (src == null) { this.setLockMarker(st, null); return; }

    // ★視覺：不衝刺時也算「當前滑鼠瞄準的融合目標」→ 面向它 + 顯示鎖定框（用戶第一痛點：一眼看出鎖誰、按攻擊會衝去打它）。
    const pointerNow = src.getPointerWorld?.();
    if (pointerNow != null) {
      const originNow = player.getPosition();
      const aimNow = Math.atan2(pointerNow.y - originNow.y, pointerNow.x - originNow.x);
      const preview = this.pickFusionEnemy(originNow, aimNow);
      // 面向：有鎖定敵→面向敵；否則面向滑鼠方向。
      player.faceDouqiAim?.(preview ? preview.getHitCenter().x : pointerNow.x);
      this.setLockMarker(st, preview);
    }

    if (!src.justPressedAttack() || now < st.nextAttackAllowedAt) return;
    if (!this.sys.ctxRef.credit.canAttack(player.playerId)) return; // ★credit 守：見底不可衝刺攻擊

    const pointer = src.getPointerWorld?.();
    // canAim 已在 update 保證 getPointerWorld 存在；此處 pointer 可能為 null（尚無指標）→ 不動。
    if (pointer == null) return;

    const origin = player.getPosition();
    const aimAngle = Math.atan2(pointer.y - origin.y, pointer.x - origin.x);
    const selected = this.pickFusionEnemy(origin, aimAngle);

    if (selected != null) {
      // 鎖到敵人：衝向其 hitCenter，到達 attackReach 內揮擊。★終點先 clamp 到場地內（主防線）。
      const c = selected.getHitCenter();
      st.dashTarget = this.clampToArena(c.x, c.y);
      st.dashMode = 'enemy';
      st.lockedEnemy = selected;
    } else {
      // 錐內無怪：朝滑鼠方向走位 dashDistancePx。★終點先 clamp（滑鼠指場外→夾到邊緣、衝到邊停不出界/不進面板）。
      st.dashTarget = this.clampToArena(
        origin.x + Math.cos(aimAngle) * this.cfg.dashDistancePx,
        origin.y + Math.sin(aimAngle) * this.cfg.dashDistancePx,
      );
      st.dashMode = 'empty';
      st.lockedEnemy = null;
    }

    // 起手：設冷卻、開衝刺、開護盾無敵 + ★視覺（朝向+move 動畫+殘影 + 護盾 fx）。
    st.nextAttackAllowedAt = now + this.cfg.attackCooldownMs;
    st.dashing = true;
    st.dashTraveledPx = 0;
    player.setShielded?.(true);
    player.setDashThrough?.(true); // ★衝刺穿透旗標：吃 EnemySpawner 現有穿透豁免，穿過菁英/塔進 reach 揮擊（v45 dashThrough）
    // ★視覺回饋③：衝刺起手朝向+move 動畫+殘影。
    const dir = { x: st.dashTarget.x - origin.x, y: st.dashTarget.y - origin.y };
    player.beginDouqiDashVisual?.(dir);
    this.setLockMarker(st, st.lockedEnemy);
    // ★護盾 fx（衝刺無敵視覺）：起手播，跟本體+朝向。
    const angle = Math.atan2(dir.y, dir.x);
    st.dashShield = this.sys.ctxRef.effects?.playerDash?.(origin.x, origin.y, angle) ?? null;
  }

  /** 融合瞄準選當前鎖定敵（純選擇，錐內加權角度差最小；供瞄準預覽+起手共用）。 */
  private pickFusionEnemy(origin: { x: number; y: number }, aimAngle: number): Enemy | null {
    const enemies = this.sys.ctxRef.getEnemies();
    const candidates: AimCandidate[] = [];
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.isDead() || e.isTower()) continue;
      const c = e.getHitCenter();
      candidates.push({ id: i, x: c.x, y: c.y, isItem: false });
    }
    const id = selectFusionTarget(origin, aimAngle, candidates, {
      coneHalfAngleDeg: this.cfg.aimConeHalfAngleDeg,
      itemWeight: this.cfg.itemAimPriorityMult,
      maxRangePx: this.cfg.searchRadiusPx,
    });
    return id != null ? enemies[id] : null;
  }

  /** ★視覺回饋①：設鎖定框跟隨（target 變化→更新位置；null→收框）。 */
  private setLockMarker(st: DouqiPlayerState, target: Enemy | null): void {
    const fx = this.sys.ctxRef.effects;
    if (target == null || (typeof target.isDead === 'function' && target.isDead())) {
      if (st.lockMarker) { fx?.endDouqiLockMarker?.(st.lockMarker); st.lockMarker = null; }
      st.markedEnemy = null;
      return;
    }
    const c = target.getHitCenter();
    if (st.lockMarker == null || st.markedEnemy !== target) {
      // 新鎖定/切換目標：收舊框、建新框。
      if (st.lockMarker) fx?.endDouqiLockMarker?.(st.lockMarker);
      st.lockMarker = fx?.douqiLockMarker?.(c.x, c.y) ?? null;
      st.markedEnemy = target;
    } else {
      fx?.updateDouqiLockMarker?.(st.lockMarker, c.x, c.y);
    }
  }

  /** 衝刺推進一幀：移動、鎖怪到達判定、★邊界 clamp + 防震盪（v45 三重處理）+ ★視覺（殘影/護盾/鎖定框跟隨）。 */
  private advanceDash(player: GameContext['player'], st: DouqiPlayerState, dt: number): void {
    const pos = player.getPosition();

    // ★視覺：衝刺期間持續生殘影（比照普通 updateDash 節奏）。
    player.tickDouqiDashVisual?.(dt);

    // enemy 模式：目標會移動 → 每幀重取鎖定敵人 hitCenter（★同樣 clamp 到場內）；敵人死亡→轉空走收尾。
    if (st.dashMode === 'enemy') {
      const enemy = st.lockedEnemy;
      if (enemy == null || enemy.isDead()) {
        st.dashMode = 'empty';
        st.lockedEnemy = null;
        this.setLockMarker(st, null); // 鎖定敵死亡→收框
      } else {
        const c = enemy.getHitCenter();
        st.dashTarget = this.clampToArena(c.x, c.y);
        this.setLockMarker(st, enemy); // ★鎖定框跟鎖定敵
      }
    }

    const dx = st.dashTarget.x - pos.x;
    const dy = st.dashTarget.y - pos.y;
    const distToTarget = Math.hypot(dx, dy);

    // 鎖怪：到達 attackReach + enemy hitRadius 內 → 停衝、揮擊、收尾（不因其他敵人中斷）。
    if (st.dashMode === 'enemy' && st.lockedEnemy != null) {
      const reach = this.cfg.attackReachPx + st.lockedEnemy.getHitRadius();
      if (distToTarget <= reach) {
        this.performAttackOn(player, st.lockedEnemy);
        this.endDash(player);
        return;
      }
    }

    // 本幀步進距離。
    const step = this.cfg.dashSpeedPxPerSec * dt;

    // ★防震盪②：結束門檻隨速度放大（stopDist = max(12, dashSpeed×0.032)）——剩餘距離 < 這一步會走的量
    //   就直接停+收尾，不設反向速度（否則高速貼牆會來回抖）。
    const stopDist = Math.max(12, this.cfg.dashSpeedPxPerSec * 0.032);
    if (distToTarget <= stopDist || distToTarget < 1e-6) {
      const snap = this.clampToArena(st.dashTarget.x, st.dashTarget.y);
      player.setPosition(snap.x, snap.y);
      st.dashTraveledPx += distToTarget;
      if (st.dashMode === 'enemy' && st.lockedEnemy != null && !st.lockedEnemy.isDead()) {
        this.performAttackOn(player, st.lockedEnemy);
      }
      this.endDash(player);
      return;
    }

    // 正常推進：朝目標移動 step。
    const inv = 1 / distToTarget;
    const rawX = pos.x + dx * inv * step;
    const rawY = pos.y + dy * inv * step;

    // ★每幀位置 clamp②：即使高速一幀 overshoot 過界，夾回場內。
    const clamped = this.clampToArena(rawX, rawY);
    player.setPosition(clamped.x, clamped.y);
    st.dashTraveledPx += step;

    // ★視覺：護盾 fx 跟本體+朝向。
    if (st.dashShield) {
      const ang = Math.atan2(dy, dx);
      this.sys.ctxRef.effects?.updatePlayerDashShield?.(st.dashShield, clamped.x, clamped.y, ang);
    }

    // ★★防震盪①：若這一幀被邊界夾回（撞界）→ 直接 endDashState（速度歸零、撞牆立即停、
    //   不再反向外衝、不卡 isDashing 導致「貼牆一直晃、能瞄不能衝」的 v41 血淚 bug）。
    if (clamped.x !== rawX || clamped.y !== rawY) {
      this.endDash(player);
      return;
    }

    // 空地/道具走位：累計超過 dashDistancePx → 收尾（鎖怪不受此限，追到為止）。
    if ((st.dashMode === 'empty' || st.dashMode === 'item') && st.dashTraveledPx >= this.cfg.dashDistancePx) {
      this.endDash(player);
    }
  }

  /**
   * ★衝刺邊界 clamp（v45 主防線）：把座標夾到 playfield 內（含角色半徑 inset）。
   *   arena＝effectivePlayerBounds()（offset-aware 現成；maxY 已是 playfield 底＝下方 UI 面板上緣，衝刺不進面板區）。
   */
  private clampToArena(x: number, y: number): { x: number; y: number } {
    const b = effectivePlayerBounds();
    const r = this.cfg.bodyRadiusPx;
    const cx = Math.min(Math.max(x, b.minX + r), b.maxX - r);
    const cy = Math.min(Math.max(y, b.minY + r), b.maxY - r);
    return { x: cx, y: cy };
  }

  /** 揮擊命中：走 PlayerControlSystem 的 helper（用現有 takeHit/ContactSolver，不自造傷害）。 */
  private performAttackOn(player: GameContext['player'], enemy: Enemy): void {
    this.sys.applyDouqiSwingHit(player, enemy, this.cfg.attackDamage, this.cfg.knockback);
  }

  /** 收尾一次衝刺：關護盾無敵、清狀態旗標 + ★收視覺（idle 動畫、停護盾 fx）。鎖定框留給下幀 tick 重判。 */
  private endDash(player: GameContext['player']): void {
    const st = this.state.get(player.playerId);
    if (st == null || !st.dashing) return;
    st.dashing = false;
    st.lockedEnemy = null;
    st.dashTraveledPx = 0;
    player.setShielded?.(false);
    player.setDashThrough?.(false); // ★收尾清穿透旗標（衝刺結束不再穿透，恢復被 immovable 擋）
    // ★視覺收尾：回 idle 動畫、停護盾 fx。鎖定框不在此收（下幀瞄準 tick 會依當前滑鼠重判顯示/收）。
    player.endDouqiDashVisual?.();
    if (st.dashShield) { this.sys.ctxRef.effects?.endPlayerDashShield?.(st.dashShield); st.dashShield = null; }
  }

  /** 取（或初始化）某 pid 的鬥氣狀態。 */
  private stateOf(pid: number): DouqiPlayerState {
    let st = this.state.get(pid);
    if (st == null) {
      st = {
        dashing: false,
        dashTarget: { x: 0, y: 0 },
        dashMode: 'empty',
        lockedEnemy: null,
        nextAttackAllowedAt: 0,
        dashTraveledPx: 0,
        lockMarker: null,
        markedEnemy: null,
        dashShield: null,
      };
      this.state.set(pid, st);
    }
    return st;
  }
}
