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

      // 2) 非戰鬥守衛（待機/被暈/被抓）→ 委派普通路徑（投幣/變身/掙脫/暈眩照舊），不套鬥氣。
      if (player.isWaiting?.() || player.isStunned?.() || player.isGrabbed?.()) {
        // 若此幀正處於衝刺，先安全收尾（關護盾），避免守衛期間留著無敵旗標。
        this.endDash(player);
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

    // B) 未在衝刺：按攻擊 + 冷卻好 → 觸發一次衝刺（融合瞄準決定落點）。
    const src = player.inputSource;
    if (src == null) return;
    if (!src.justPressedAttack() || now < st.nextAttackAllowedAt) return;

    const pointer = src.getPointerWorld?.();
    // canAim 已在 update 保證 getPointerWorld 存在；此處 pointer 可能為 null（尚無指標）→ 不動。
    if (pointer == null) return;

    const origin = player.getPosition();
    const aimAngle = Math.atan2(pointer.y - origin.y, pointer.x - origin.x);

    // 候選：敵人（跳過已死；階段 1 跳過塔 isTower 以保單純）。
    // TODO（階段 2）：納入道具候選（isItem:true，itemAimPriorityMult 略優先），需道具清單 API 明確後再加。
    const enemies = this.sys.ctxRef.getEnemies();
    const candidates: AimCandidate[] = [];
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.isDead() || e.isTower()) continue;
      const c = e.getHitCenter();
      candidates.push({ id: i, x: c.x, y: c.y, isItem: false });
    }

    const selectedId = selectFusionTarget(origin, aimAngle, candidates, {
      coneHalfAngleDeg: this.cfg.aimConeHalfAngleDeg,
      itemWeight: this.cfg.itemAimPriorityMult,
      maxRangePx: this.cfg.searchRadiusPx,
    });

    if (selectedId != null) {
      // 鎖到敵人：衝向其 hitCenter，到達 attackReach 內揮擊。★終點先 clamp 到場地內（主防線）。
      const enemy = enemies[selectedId];
      const c = enemy.getHitCenter();
      st.dashTarget = this.clampToArena(c.x, c.y);
      st.dashMode = 'enemy';
      st.lockedEnemy = enemy;
    } else {
      // 錐內無怪：朝滑鼠方向走位 dashDistancePx。★終點先 clamp（滑鼠指場外→夾到邊緣、衝到邊停不出界/不進面板）。
      st.dashTarget = this.clampToArena(
        origin.x + Math.cos(aimAngle) * this.cfg.dashDistancePx,
        origin.y + Math.sin(aimAngle) * this.cfg.dashDistancePx,
      );
      st.dashMode = 'empty';
      st.lockedEnemy = null;
    }

    // 起手：設冷卻、開衝刺、開護盾無敵（setFacing 為 private → 不呼叫，略過朝向）。
    st.nextAttackAllowedAt = now + this.cfg.attackCooldownMs;
    st.dashing = true;
    st.dashTraveledPx = 0;
    player.setShielded?.(true);
  }

  /** 衝刺推進一幀：移動、鎖怪到達判定、★邊界 clamp + 防震盪（v45 三重處理，dashSpeed1400 必備）。 */
  private advanceDash(player: GameContext['player'], st: DouqiPlayerState, dt: number): void {
    const pos = player.getPosition();

    // enemy 模式：目標會移動 → 每幀重取鎖定敵人 hitCenter（★同樣 clamp 到場內）；敵人死亡→轉空走收尾。
    if (st.dashMode === 'enemy') {
      const enemy = st.lockedEnemy;
      if (enemy == null || enemy.isDead()) {
        st.dashMode = 'empty';
        st.lockedEnemy = null;
      } else {
        const c = enemy.getHitCenter();
        st.dashTarget = this.clampToArena(c.x, c.y);
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

  /** 收尾一次衝刺：關護盾無敵、清狀態旗標。 */
  private endDash(player: GameContext['player']): void {
    const st = this.state.get(player.playerId);
    if (st == null || !st.dashing) return;
    st.dashing = false;
    st.lockedEnemy = null;
    st.dashTraveledPx = 0;
    player.setShielded?.(false);
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
      };
      this.state.set(pid, st);
    }
    return st;
  }
}
