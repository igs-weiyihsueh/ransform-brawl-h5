import type Phaser from 'phaser';
import type { IPlayerControlStrategy } from '@/systems/control/IPlayerControlStrategy';
import type { PlayerControlSystem } from '@/systems/PlayerControlSystem';
import type { GameContext } from '@/systems/GameContext';
import type { Enemy } from '@/entities/Enemy';
import { DOUQI_CONTROL_CONFIG, DOUQI_COMBO_CONFIG, DOUQI_LEVEL_CONFIG } from '@/config/douqiConfig';
import { effectivePlayerBounds } from '@/config/mapConfig';
import { bumpCombo, comboSkillReady, comboSkillEdgeTriggered, pointInCircle, pointInOrientedRect } from '@/systems/comboSkillMath';
import { expForKill, applyKillExp, levelScale, expToNextLevel } from '@/systems/douqiLevelMath';
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
  /** ★階段 2 連段：per-pid combo 計數（普攻揮擊命中 +1，無時間衰減，cap maxCombo；empower 觸發後歸零）。 */
  combo: number;
  /** ★階段 2 強化：剩餘強化時間（ms，real dt 倒數；>0＝強化中）。 */
  empowerRemainingMs: number;
  /** ★階段 2 強化：金色光環 handle（強化期間持續跟本體、收尾停）。 */
  empowerAura: Phaser.GameObjects.Graphics | null;
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
  /** ★階段 3：全隊共用一條 teamLevel（多人共享，非各自）+ 當前等級內累積經驗。 */
  private teamLevelValue = 1;
  private teamExp = 0;

  constructor(private readonly sys: PlayerControlSystem) {}

  /** ★階段 3：擊殺給經驗（GameScene onEnemyKilled hook 於 douqi 時呼）。跨門檻自動升級（cap 10）。 */
  grantKillExp(enemyKey: string): void {
    const lv = DOUQI_LEVEL_CONFIG;
    const gained = expForKill(enemyKey, lv.expPerKillBase, lv.killExpMult);
    if (gained <= 0) return;
    const r = applyKillExp(this.teamLevelValue, this.teamExp, gained, lv.expToNext, lv.cap);
    this.teamLevelValue = r.level;
    this.teamExp = r.exp;
  }

  /** ★階段 3：當前 teamLevel（全隊共用；連段技解鎖/雙軌 scale/UI 讀）。 */
  getTeamLevel(): number {
    return this.teamLevelValue;
  }
  /** ★階段 3：當前等級內累積經驗（經驗條 UI 用）。 */
  getTeamExp(): number {
    return this.teamExp;
  }
  /** ★階段 3 commit4：當前等級升下一級所需經驗（經驗條 UI 進度；滿級回 0）。 */
  getExpToNext(): number {
    return expToNextLevel(this.teamLevelValue, DOUQI_LEVEL_CONFIG.expToNext, DOUQI_LEVEL_CONFIG.cap);
  }

  /**
   * ★階段 3 commit2 / 實機修：鬥氣模式生怪後套 teamLevel 難度 scale（DouqiSpawnSystem 生怪後直接呼）。
   *   ★base HP/傷害用**鬥氣專屬 DOUQI_ENEMY_STATS**（90/200/45… + attackDamage），非 enemy 的 normal config hp(3/2/10)——
   *     修「敵人恆 1~3 HP 秒殺」病根（原乘到 normal 平衡極小值）。呼叫端(DouqiSpawnSystem)已知邏輯怪種 → 傳 base 進來。
   *   敵 HP = baseHp(douqi) × curEnemyHpScale(Lv1×0.35→Lv10 滿)；敵傷 = baseDamage(douqi) × curEnemyDamageScale(×0.55→滿)，
   *     用 setDamageMult 相對 enemy 自身攻擊值換算（damageMult = 目標傷/enemy 原攻擊，讓實際輸出＝douqi 傷×scale）。
   *   ★只 douqi 生的怪套；normal 不呼＝維持原樣 byte 不變。
   * @param baseHp 鬥氣該怪 base HP（DOUQI_ENEMY_STATS.maxHp）。
   * @param baseDamage 鬥氣該怪 base 攻擊（DOUQI_ENEMY_STATS 對應攻擊值）；<=0 表用 enemy 原攻擊只套 scale。
   */
  scaleSpawnedEnemy(
    enemy: {
      getMaxHp?: () => number;
      setMaxHp?: (hp: number) => void;
      setDamageMult?: (m: number) => void;
      getBaseAttackDamage?: () => number;
    },
    baseHp: number,
    baseDamage = 0,
  ): void {
    const cap = DOUQI_LEVEL_CONFIG.cap;
    const lv = this.teamLevelValue;
    const hpScale = levelScale(DOUQI_LEVEL_CONFIG.difficultyLv1.enemyHp, lv, cap);
    const dmgScale = levelScale(DOUQI_LEVEL_CONFIG.difficultyLv1.enemyDamage, lv, cap);
    // HP：鬥氣 base × 等級 scale（前期脆是 v45 設計正回饋；Lv1 90×0.35≈31 dmg36 一兩下有打擊感、Lv10 滿）。
    if (baseHp > 0) enemy.setMaxHp?.(Math.max(1, Math.round(baseHp * hpScale)));
    // 傷害：目標 = 鬥氣 base 傷 × scale；damageMult = 目標 / enemy 原攻擊（讓 enemy 攻擊實際輸出＝鬥氣傷）。
    if (baseDamage > 0) {
      const enemyBaseAtk = enemy.getBaseAttackDamage?.() ?? 0;
      const targetDmg = baseDamage * dmgScale;
      const mult = enemyBaseAtk > 0 ? targetDmg / enemyBaseAtk : dmgScale;
      enemy.setDamageMult?.(Math.max(0.01, mult));
    } else {
      enemy.setDamageMult?.(dmgScale); // 無 douqi base 傷→只套 scale（保守回退）
    }
  }

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

    // ★階段 2 強化 buff 倒數（real dt；>0 期間無敵+傷/範圍/移速/衝速提升，角色仍可操控）。歸零→收 buff/視覺/光環。
    if (st.empowerRemainingMs > 0) {
      st.empowerRemainingMs -= dt * 1000;
      const pos = player.getPosition();
      this.sys.ctxRef.effects?.updateDouqiEmpowerAura?.(st.empowerAura, pos.x, pos.y);
      if (st.empowerRemainingMs <= 0) {
        st.empowerRemainingMs = 0;
        player.setShielded?.(false);
        player.setEmpowerVisual?.(false);
        if (st.empowerAura) { this.sys.ctxRef.effects?.endDouqiEmpowerAura?.(st.empowerAura); st.empowerAura = null; }
      }
    }

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
      // 錐內無怪：朝滑鼠方向走位 dashDistancePx（★強化 ×moveMult1.4）。★終點先 clamp（滑鼠指場外→夾到邊緣、衝到邊停不出界/不進面板）。
      const dist = this.cfg.dashDistancePx * this.empowerMoveMult(player);
      st.dashTarget = this.clampToArena(
        origin.x + Math.cos(aimAngle) * dist,
        origin.y + Math.sin(aimAngle) * dist,
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
      // ★階段 1 小補：塔(isTower) 納入候選（用戶選 b：鬥氣能鎖定+衝刺打塔）。塔也 immovable→dashThrough 穿透通用、
      //   塔本有 hp→takeHit 扣血（跟菁英同路徑）。塔完整攻擊/預警/定身＝階段 4 三事件才做。只排除已死。
      if (e.isDead()) continue;
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

    // 鎖怪：到達 attackReach + enemy hitRadius 內 → 停衝、揮擊、收尾（不因其他敵人中斷）。★attackReach ×角色成長 scale。
    if (st.dashMode === 'enemy' && st.lockedEnemy != null) {
      const reach = this.cfg.attackReachPx * this.charDashHitScale() + st.lockedEnemy.getHitRadius();
      if (distToTarget <= reach) {
        this.performAttackOn(player, st.lockedEnemy);
        this.endDash(player);
        return;
      }
    }

    // 本幀步進距離（★強化 ×dashSpeedMult1.5＝衝速 2100）。
    const dashSpeed = this.cfg.dashSpeedPxPerSec * this.empowerDashSpeedMult(player);
    const step = dashSpeed * dt;

    // ★防震盪②：結束門檻隨速度放大（stopDist = max(12, dashSpeed×0.032)）——剩餘距離 < 這一步會走的量
    //   就直接停+收尾，不設反向速度（否則高速貼牆會來回抖）。
    const stopDist = Math.max(12, dashSpeed * 0.032);
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

    // 空地/道具走位：累計超過 dashDistancePx（★強化 ×moveMult）→ 收尾（鎖怪不受此限，追到為止）。
    if ((st.dashMode === 'empty' || st.dashMode === 'item') && st.dashTraveledPx >= this.cfg.dashDistancePx * this.empowerMoveMult(player)) {
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

  /** 揮擊命中：走 PlayerControlSystem 的 helper（用現有 takeHit/ContactSolver，不自造傷害）+ combo 累積 + 連段技觸發。 */
  private performAttackOn(player: GameContext['player'], enemy: Enemy): void {
    this.sys.applyDouqiSwingHit(player, enemy, this.empoweredDamage(player), this.cfg.knockback);
    // ★階段 2 連段：普攻【揮擊命中】+1 combo（命中次數計，一次揮擊+1；無時間衰減、cap maxCombo）。
    //   連段技 AOE 命中【不】累積（只此普攻揮擊 hook 累積，避免無限疊放）。
    const st = this.stateOf(player.playerId);
    st.combo = bumpCombo(st.combo, DOUQI_COMBO_CONFIG.maxCombo);
    // ★連段技自動疊放（普攻命中的附帶疊放、不按鍵、不取代普攻衝刺揮擊）：達門檻+teamLevel 雙條件即觸發。
    //   ★階段 2 (D)：teamLevel 先餵恆滿足高值（保留雙條件結構，階段 3 接真 teamLevel 直接換值）。
    this.tryComboSkills(player, st, enemy);
  }

  /** ★階段 3：接真 teamLevel（取代階段 2 的 (D) 全解鎖 999）——連段技依真等級解鎖（Lv1 只強化、Lv2 圓、Lv4 氣波、Lv6 爆發）。 */
  private teamLevel(_player: GameContext['player']): number {
    return this.teamLevelValue;
  }

  /**
   * 檢查並自動疊放連段技（圓形斬/氣波/爆發/強化）。普攻命中的附帶疊放。
   * ★修觸發 bug（照海牛 v45 GameScene.onComboHit）：圓/氣波/爆發用「門檻邊緣觸發 combo===threshold」——combo 連續爬 1→10，
   *   只在「命中到剛好那個門檻」的那一擊放該招一次（不再 >= 每擊重放氣波、不再蓋掉圓/跳過爆發）。強化用 >=10 於 cap 邊界，放完 combo 歸零。
   *   一輪 10 擊依序：3→圓、6→氣波、9→爆發、10→強化(歸零)，各放一次；歸零後下輪重爬再依序各放一次。
   */
  private tryComboSkills(player: GameContext['player'], st: DouqiPlayerState, lockedEnemy: Enemy): void {
    const cfg = DOUQI_COMBO_CONFIG;
    const lvl = this.teamLevel(player);
    const combo = st.combo;
    const origin = player.getPosition();
    // ①圓形斬 combo===3 且 Lv≥2（邊緣觸發，只在剛到 3 那擊放一次）。
    if (comboSkillEdgeTriggered(combo, lvl, cfg.thresholds.circle, cfg.unlockLevel.circle)) {
      this.triggerCircleSlash(player, origin);
    }
    // ②直線氣波 combo===6 且 Lv≥4：朝鎖定目標/鎖定敵方向（只在剛到 6 那擊放一次，不再每擊重放）。
    if (comboSkillEdgeTriggered(combo, lvl, cfg.thresholds.line, cfg.unlockLevel.line)) {
      const c = lockedEnemy.getHitCenter();
      const aimAngle = Math.atan2(c.y - origin.y, c.x - origin.x);
      this.triggerLineWave(player, origin, aimAngle);
    }
    // ③爆發 combo===9 且 Lv≥6（邊緣觸發，只在剛到 9 那擊放一次）。
    if (comboSkillEdgeTriggered(combo, lvl, cfg.thresholds.burst, cfg.unlockLevel.burst)) {
      this.triggerBurst(player, origin);
    }
    // ④滿連段強化 combo≥10 且 Lv≥1：觸發後 combo 歸零（>= 於 cap 邊界，與 v45 一致）。
    if (comboSkillReady(combo, lvl, cfg.thresholds.empower, cfg.unlockLevel.empower)) {
      this.triggerEmpower(player, st);
    }
  }

  /** ①圓形斬：以玩家為心的圓 AOE，對全場可傷怪一次性結算（走 applyDouqiAoeHit takeHit）+青環 VFX。 */
  private triggerCircleSlash(player: GameContext['player'], origin: { x: number; y: number }): void {
    const cfg = DOUQI_COMBO_CONFIG.circle;
    const radius = cfg.radiusPx * this.charSkillRangeScale() * this.empowerRangeMult(player);
    const dmg = Math.round(cfg.damage * this.charSkillDamageScale() * this.empowerDamageMult(player));
    const juice = DOUQI_COMBO_CONFIG.juice;
    for (const e of this.sys.ctxRef.getEnemies()) {
      if (e.isDead()) continue; // 可傷怪（含菁英/塔）
      const c = e.getHitCenter();
      if (pointInCircle(c.x, c.y, origin.x, origin.y, radius + e.getHitRadius())) {
        this.sys.applyDouqiAoeHit(player, e, dmg, cfg.knockback, origin); // fromPos=玩家心→向外推
        e.flashWhite?.(juice.hitFlashColor, juice.hitFlashDurationMs / 1000); // 命中閃白
      }
    }
    this.sys.ctxRef.effects?.douqiCircleSlash?.(origin.x, origin.y, radius, cfg.ringColor, cfg.ringDurationMs);
    this.sys.ctxRef.effects?.shakeOnce?.(juice.skillShakeIntensity, juice.skillShakeDurationMs); // 招式中震
  }

  /** ②直線氣波：朝 aimAngle 矩形貫穿，pointInOrientedRect 對全場可傷怪一次性結算+紅斬帶 VFX。 */
  private triggerLineWave(player: GameContext['player'], origin: { x: number; y: number }, aimAngle: number): void {
    const cfg = DOUQI_COMBO_CONFIG.line;
    const juice = DOUQI_COMBO_CONFIG.juice;
    const rmult = this.charSkillRangeScale() * this.empowerRangeMult(player);
    const length = cfg.lengthPx * rmult;
    const halfWidth = (cfg.widthPx * rmult) / 2;
    const dmg = Math.round(cfg.damage * this.charSkillDamageScale() * this.empowerDamageMult(player));
    for (const e of this.sys.ctxRef.getEnemies()) {
      if (e.isDead()) continue;
      const c = e.getHitCenter();
      if (pointInOrientedRect(c.x, c.y, origin.x, origin.y, aimAngle, length + e.getHitRadius(), halfWidth + e.getHitRadius())) {
        this.sys.applyDouqiAoeHit(player, e, dmg, cfg.knockback, origin);
        e.flashWhite?.(juice.hitFlashColor, juice.hitFlashDurationMs / 1000); // 命中閃白
      }
    }
    this.sys.ctxRef.effects?.douqiLineWave?.(origin.x, origin.y, aimAngle, length, cfg.widthPx * rmult, cfg.beamColor, cfg.beamDurationMs);
    this.sys.ctxRef.effects?.shakeOnce?.(juice.skillShakeIntensity, juice.skillShakeDurationMs); // 招式中震
  }

  /**
   * ③爆發：★v45 割草「時間軸 16 段連打」（非一瞬結算）——原地無敵 ~invulnMs、每 intervalMs 一段共 hits 段，
   *   每段對 radiusPx 內怪 damagePerHit（擊退0 原地狂斬不推）+命中→頓幀 hitstopMs+閃白+小震+**隨機位置斬光**（douqiSlashSwing 橙 tint，
   *   不再沿用圓形斬青環＝解決撞臉）。開場大震。角色 setShielded 無敵全程。★用戶要的割草連斬打擊感。
   */
  private triggerBurst(player: GameContext['player'], _origin: { x: number; y: number }): void {
    const cfg = DOUQI_COMBO_CONFIG.burst;
    const juice = DOUQI_COMBO_CONFIG.juice;
    const fx = this.sys.ctxRef.effects;
    const scene = this.sys.ctxRef.scene;
    const rmult = this.charSkillRangeScale() * this.empowerRangeMult(player);
    const radius = cfg.radiusPx * rmult;
    const perHit = Math.round(cfg.damagePerHit * this.charSkillDamageScale() * this.empowerDamageMult(player));
    // 開場大震 + 原地無敵全程（用既有衝刺護盾機制 setShielded；invulnMs 後若非強化中才關）。
    fx?.shakeOnce?.(juice.burstOpenShakeIntensity, juice.burstOpenShakeDurationMs);
    player.setShielded?.(true);
    scene.time.delayedCall(cfg.invulnMs, () => {
      // 無敵到期：非強化中才收護盾（強化本身給無敵，別誤關）。
      if ((this.state.get(player.playerId)?.empowerRemainingMs ?? 0) <= 0) player.setShielded?.(false);
    });
    // 時間軸 16 段：每 intervalMs 一段 burstTick（Phaser timer 逐段展開，非一瞬）。
    scene.time.addEvent({
      delay: cfg.intervalMs,
      repeat: cfg.hits - 1,
      callback: () => this.burstTick(player, radius, perHit, cfg, juice, fx),
    });
  }

  /** 爆發單段：對範圍內怪傷 + 命中頓幀/閃白/小震 + 隨機位置斬光（橙）。 */
  private burstTick(
    player: GameContext['player'],
    radius: number,
    perHit: number,
    cfg: typeof DOUQI_COMBO_CONFIG.burst,
    juice: typeof DOUQI_COMBO_CONFIG.juice,
    fx: GameContext['effects'] | undefined,
  ): void {
    const origin = player.getPosition(); // 每段讀當前位置（原地無敵故大致不動）
    let hitAny = false;
    for (const e of this.sys.ctxRef.getEnemies()) {
      if (e.isDead()) continue;
      const c = e.getHitCenter();
      if (pointInCircle(c.x, c.y, origin.x, origin.y, radius + e.getHitRadius())) {
        this.sys.applyDouqiAoeHit(player, e, perHit, cfg.knockback, origin);
        e.flashWhite?.(juice.hitFlashColor, juice.hitFlashDurationMs / 1000);
        hitAny = true;
      }
    }
    // 命中→破頓 + 小震（有打到才頓，避免空砍卡幀）。
    if (hitAny) {
      fx?.triggerHitstop?.(cfg.hitstopMs);
      fx?.shakeOnce?.(juice.burstTickShakeIntensity, juice.burstTickShakeDurationMs);
    }
    // 每段隨機位置斬光（橙 tint、角度隨機）——連續多段散佈＝割草連斬視覺，明顯區別於圓形斬青環。
    const ox = origin.x + (Math.random() * 2 - 1) * cfg.slashScatterPx;
    const oy = origin.y + (Math.random() * 2 - 1) * cfg.slashScatterPx;
    fx?.douqiSlashSwing?.(ox, oy, Math.random() * Math.PI * 2, 1.2, 0xffa500);
  }

  /** ④滿連段強化：limited buff（無敵+傷/範圍/移速/衝速提升，角色仍可操控）+視覺放大(僅顯示)+金環。觸發後 combo 歸零。 */
  private triggerEmpower(player: GameContext['player'], st: DouqiPlayerState): void {
    const cfg = DOUQI_COMBO_CONFIG.empower;
    st.empowerRemainingMs = cfg.durationMs;
    st.combo = 0; // ★觸發後 spirit 歸零
    player.setShielded?.(true); // 強化期間無敵
    player.setEmpowerVisual?.(true, 1.35); // ★純顯示放大+金 tint（body 不放大，海牛血淚）
    const pos = player.getPosition();
    if (st.empowerAura == null) st.empowerAura = this.sys.ctxRef.effects?.douqiEmpowerAura?.(pos.x, pos.y) ?? null;
  }

  // --- 強化 buff 倍率（強化中回 mult，否則 1.0）---
  private isEmpowered(player: GameContext['player']): boolean {
    return (this.state.get(player.playerId)?.empowerRemainingMs ?? 0) > 0;
  }

  // --- ★階段 3 commit3：角色成長 scale（curXxxScale by teamLevel；Lv1×lv1Scale→Lv10 滿值 1.0）。強化倍率在其之上再乘。---
  /** 普攻傷 scale（×0.6→滿）。 */
  private charAttackDamageScale(): number {
    return levelScale(DOUQI_LEVEL_CONFIG.characterLv1.attackDamage, this.teamLevelValue, DOUQI_LEVEL_CONFIG.cap);
  }
  /** 招傷 scale（×0.55→滿）。 */
  private charSkillDamageScale(): number {
    return levelScale(DOUQI_LEVEL_CONFIG.characterLv1.skillDamage, this.teamLevelValue, DOUQI_LEVEL_CONFIG.cap);
  }
  /** 招範圍 scale（×0.6→滿）。 */
  private charSkillRangeScale(): number {
    return levelScale(DOUQI_LEVEL_CONFIG.characterLv1.skillRange, this.teamLevelValue, DOUQI_LEVEL_CONFIG.cap);
  }
  /** 衝撞命中半徑 scale（×0.6→滿）。 */
  private charDashHitScale(): number {
    return levelScale(DOUQI_LEVEL_CONFIG.characterLv1.dashHitRadius, this.teamLevelValue, DOUQI_LEVEL_CONFIG.cap);
  }

  private empowerDamageMult(player: GameContext['player']): number {
    return this.isEmpowered(player) ? DOUQI_COMBO_CONFIG.empower.damageMult : 1;
  }
  private empowerRangeMult(player: GameContext['player']): number {
    return this.isEmpowered(player) ? DOUQI_COMBO_CONFIG.empower.rangeMult : 1;
  }
  private empowerMoveMult(player: GameContext['player']): number {
    return this.isEmpowered(player) ? DOUQI_COMBO_CONFIG.empower.moveMult : 1;
  }
  private empowerDashSpeedMult(player: GameContext['player']): number {
    return this.isEmpowered(player) ? DOUQI_COMBO_CONFIG.empower.dashSpeedMult : 1;
  }
  private empoweredDamage(player: GameContext['player']): number {
    // ★普攻傷＝base × 角色成長 scale(×0.6→滿) × 強化倍率(×1.8)。
    return Math.round(this.cfg.attackDamage * this.charAttackDamageScale() * this.empowerDamageMult(player));
  }

  /** 收尾一次衝刺：關護盾無敵、清狀態旗標 + ★收視覺（idle 動畫、停護盾 fx）。鎖定框留給下幀 tick 重判。 */
  private endDash(player: GameContext['player']): void {
    const st = this.state.get(player.playerId);
    if (st == null || !st.dashing) return;
    st.dashing = false;
    st.lockedEnemy = null;
    st.dashTraveledPx = 0;
    // ★強化中不關護盾（強化本身給無敵）；非強化才依衝刺結束關護盾。
    if (st.empowerRemainingMs <= 0) player.setShielded?.(false);
    player.setDashThrough?.(false); // ★收尾清穿透旗標（衝刺結束不再穿透，恢復被 immovable 擋）
    // ★視覺收尾：回 idle 動畫、停護盾 fx。鎖定框不在此收（下幀瞄準 tick 會依當前滑鼠重判顯示/收）。
    player.endDouqiDashVisual?.();
    if (st.dashShield) { this.sys.ctxRef.effects?.endPlayerDashShield?.(st.dashShield); st.dashShield = null; }
  }

  /** probe/測試用：讀某 pid 當前 combo（階段 2 headed 驗）。 */
  debugCombo(pid: number): number {
    return this.state.get(pid)?.combo ?? 0;
  }

  /** probe/測試用：讀某 pid 強化剩餘 ms（>0＝強化中）。 */
  debugEmpowerMs(pid: number): number {
    return this.state.get(pid)?.empowerRemainingMs ?? 0;
  }

  /**
   * ★連段 HUD 資料源（每幀餵 DouqiComboHud）：讀現有 per-pid combo 內部計數 + teamLevel + 強化剩餘。
   *   純讀，不改連段邏輯。門檻/解鎖等級 HUD 直接讀 DOUQI_COMBO_CONFIG（單一真源）。
   */
  getComboHudData(pid: number): { combo: number; comboMax: number; teamLevel: number; empowerRemainMs: number } {
    return {
      combo: this.state.get(pid)?.combo ?? 0,
      comboMax: DOUQI_COMBO_CONFIG.maxCombo,
      teamLevel: this.teamLevelValue,
      empowerRemainMs: this.state.get(pid)?.empowerRemainingMs ?? 0,
    };
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
        combo: 0,
        empowerRemainingMs: 0,
        empowerAura: null,
      };
      this.state.set(pid, st);
    }
    return st;
  }
}
