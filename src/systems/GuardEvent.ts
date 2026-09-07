import { GAME_HEIGHT, GAME_WIDTH } from '@/config/gameConfig';
import { PPU } from '@/config/gameConfig';
import { getResolvedChest } from '@/config/chestSchema';
import { PLAYER_CONFIG } from '@/config/combatConfig';
import { pickGuardEnemy, guardSideSpawnPoint, resolveGuardDrip, resolveGuardStatueUi, resolveGuardMessages, type GuardPreset, type GuardDrip, type GuardSpawnEntry, type GuardMessages } from '@/config/guardConfig';
import { getResolvedGuardPreset } from '@/config/guardSchema';
import { GuardTarget } from '@/entities/GuardTarget';
import { guardCornerTargets, scriptedMoveStep, allScriptedArrived } from '@/systems/guardIntro';
import { MAP_BOUNDS } from '@/config/mapConfig';
import type { GameContext } from '@/systems/GameContext';
/**
 * 守護波開場常數已搬進 GuardPreset（七輪#2，支援單獨編輯）：
 * cornerOffset→preset.cornerOffsetXPx/YPx、走位逾時→preset.maxWalkSec、聚焦→preset.introFocusSec、spotlight→preset.spotlightRadiusPx。
 * 打包預設值（Guard60/fallback）= 原常數值，行為不變。
 */

/** 守護波階段：開場導引走位 → 雕像顯現 → 聚焦壓暗 → 守護戰 → 結束。 */
type GuardPhase = 'introMove' | 'reveal' | 'focus' | 'combat';


/**
 * GuardEvent — 一場守護波（Guard Event）的執行狀態機（決策 76f235e4）。
 *
 * 由 WaveSystem 在 Event 節點建立並每幀 tick。守護的敵人 drip 配置全在 guardPreset
 * （不動凍結的 levelSchema）。流程：生 GuardTarget（場中央）+ 敵人目標切雕像 →
 *   drip 維持 maxAlive → 倒數 timeLimit（量條由時間扣）→ 勝/敗 → cleanup → 結算獎券。
 */
export class GuardEvent {
  private readonly ctx: GameContext;
  private readonly preset: GuardPreset;

  private target: GuardTarget;
  private remaining: number;
  private spawnCooldown = 0;
  private finished = false;
  private won = false;
  /** 三輪#9：守護波側邊生成左右交替 flag（每次生成後翻轉，兩側數量平均）。 */
  private guardSpawnNextLeft = true;

  // --- 開場演出（用戶 #4）狀態 ---
  private phase: GuardPhase = 'introMove';
  private moveTargets: { x: number; y: number }[] = [];
  private moveArrived: boolean[] = [];
  private moveElapsed = 0;
  private focusElapsed = 0;
  /** 第十四輪③ 嚴格接續：限時事件文字自 show 起經過秒數；達 introTextTotalSec（滑進+顯+滑出）才允許守護訊息滑進，不重疊。 */
  private introTextElapsed = 0;
  private readonly introTextTotalSec: number;
  /** 第十四輪：守護波訊息（introEventText/guardMessageText/eventTextDurationSec，resolveGuardMessages 解析）。 */
  private readonly msgs: GuardMessages;
  private spotlight: { fadeOut: () => void } | null = null;
  /** 七輪#5：「協力合作，守護雕像」大字 handle（聚焦時滑進、解聚焦時滑出，對齊 Unity GuardTextUI）。 */
  private guardTextHandle: { fadeOut: () => void } | null = null;
  /** 七輪：有效補怪 drip = node per-node 覆蓋 preset（resolveGuardDrip）。 */
  private readonly drip: GuardDrip;

  constructor(
    ctx: GameContext,
    presetName: string,
    dripOverride?: { maxAlive?: number; spawnThreshold?: number; spawnInterval?: number; spawns?: GuardSpawnEntry[] },
  ) {
    this.ctx = ctx;
    this.preset = getResolvedGuardPreset(presetName);
    this.drip = resolveGuardDrip(dripOverride, this.preset); // 七輪：node.X ?? preset.X（0-nullish 安全）
    this.remaining = this.preset.timeLimit;
    // 第十四輪：守護波訊息（文字/時長可編，override 優先）。
    this.msgs = resolveGuardMessages(this.preset);
    // ③嚴格接續：限時事件文字全程 = 滑進 0.4s + 顯 eventTextDurationSec + 滑出 0.4s（對齊 EffectSystem.timedEventText）。
    //   守護訊息要等此全程結束才滑進（不重疊）。文字空('' →不顯) → 全程視為 0（不擋守護訊息）。
    this.introTextTotalSec = this.msgs.introEventText === '' ? 0 : 0.4 + this.msgs.eventTextDurationSec + 0.4;

    // 生雕像於場中央（先隱藏，開場玩家就定位後才 reveal 顯現）。敵人攻擊改打雕像（在 combat 階段前不 drip）。
    const sx = GAME_WIDTH / 2;
    const sy = GAME_HEIGHT / 2;
    this.target = new GuardTarget(ctx.scene, sx, sy, this.preset.targetHP, resolveGuardStatueUi(this.preset));
    this.target.setVisible(false);
    ctx.spawner.setGuardTarget(this.target);

    // 用戶 #4 開場序列：①鎖操作 + 導引走位到四角 + ②「限時事件」大字。
    ctx.scriptedControl = true; // 鎖玩家操作（PlayerControlSystem 跳過輸入）
    this.moveTargets = guardCornerTargets(sx, sy, this.preset.cornerOffsetXPx, this.preset.cornerOffsetYPx);
    this.moveArrived = (ctx.players ?? []).map(() => false);
    ctx.effects?.timedEventText?.(this.msgs.eventTextDurationSec, this.msgs.introEventText); // 走位同時滑進大字（文字/時長 override，非阻塞）
  }

  isFinished(): boolean {
    return this.finished;
  }

  /** 每幀推進。回傳 true 表示本守護波已結束（WaveSystem 據此前進節點）。 */
  update(dt: number): boolean {
    if (this.finished) return true;

    // 第十四輪③：累積限時事件文字經過時間（開場起算），供 beginFocus 嚴格接續 gate。
    if (this.phase === 'introMove' || this.phase === 'reveal') this.introTextElapsed += dt;

    // --- 用戶 #4 開場序列（combat 前）---
    if (this.phase === 'introMove') {
      this.updateIntroMove(dt);
      return false; // 開場中不前進節點
    }
    if (this.phase === 'reveal') {
      // 雕像已 reveal（進 reveal 當幀觸發），短暫等顯現動畫後進聚焦。
      this.focusElapsed += dt;
      // ③嚴格接續：等「限時事件文字全程滑出完成」+ reveal 動畫(0.45s) 才進聚焦滑進守護訊息（不重疊）。
      if (this.focusElapsed >= 0.45 && this.introTextElapsed >= this.introTextTotalSec) {
        this.focusElapsed = 0;
        this.beginFocus();
      }
      return false;
    }
    if (this.phase === 'focus') {
      this.focusElapsed += dt;
      if (this.focusElapsed >= this.preset.introFocusSec) {
        this.endFocus();
      }
      return false;
    }

    // --- combat（守護戰，原本邏輯）---
    // 敗：雕像 HP 歸 0 → 提早結束。
    if (this.target.isDefeated()) {
      this.finish(false);
      return true;
    }

    // 倒數（量條由時間扣）。
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.remaining = 0;
      this.finish(true); // 撐過時間且 HP>0 → 勝
      return true;
    }

    // drip：維持場上敵人數（無 killQuota）。存活 < spawnThreshold 時補到 maxAlive。
    this.spawnCooldown -= dt;
    const alive = this.ctx.getEnemies().length;
    if (
      alive < this.drip.spawnThreshold &&
      this.spawnCooldown <= 0 &&
      alive < this.drip.maxAlive
    ) {
      this.spawnAroundTarget();
      this.spawnCooldown = this.drip.spawnInterval;
    }
    return false;
  }

  /** ①導引走位：每幀把各玩家朝四角移動（走路動畫+面向），全到位 or 逾時 snap → 進 reveal。 */
  private updateIntroMove(dt: number): void {
    this.moveElapsed += dt;
    const speedPx = PLAYER_CONFIG.moveSpeed * PPU;
    const timedOut = this.moveElapsed >= this.preset.maxWalkSec;
    (this.ctx.players ?? []).forEach((p, i) => {
      if (this.moveArrived[i]) {
        p.move({ x: 0, y: 0 }, dt); // 到位站定播 idle
        return;
      }
      const cur = p.getPosition();
      const tgt = this.moveTargets[i] ?? { x: cur.x, y: cur.y };
      if (timedOut) {
        p.setPosition(tgt.x, tgt.y); // 逾時保底 snap 到位防卡
        this.moveArrived[i] = true;
        p.move({ x: 0, y: 0 }, dt);
        return;
      }
      const step = scriptedMoveStep(cur, tgt, speedPx, dt);
      if (step.arrived) {
        p.setPosition(tgt.x, tgt.y);
        this.moveArrived[i] = true;
        p.move({ x: 0, y: 0 }, dt);
      } else {
        p.move(step.dir, dt); // 單位方向 → player.move 走該速度 + 走路動畫 + 面向
      }
    });
    if (allScriptedArrived(this.moveArrived) || timedOut) {
      // ②玩家就定位 → 雕像顯現（進度條收/守護量條由 ProgressBarSystem 依 guard active 自動切）。
      this.moveArrived = this.moveArrived.map(() => true);
      this.target.reveal(this.ctx.scene);
      this.phase = 'reveal';
      this.focusElapsed = 0;
    }
  }

  /** ③聚焦壓暗 spotlight（雕像位置亮圈；雕像 depth 提到遮罩之上＝聚焦不被壓暗）。 */
  private beginFocus(): void {
    const c = this.target.getPosition();
    this.target.setDepth(972); // 遮罩(960)+亮環(962) 之上 → 雕像在 spotlight 中被聚焦、不壓暗
    this.spotlight = this.ctx.effects?.guardSpotlight?.(c.x, c.y, this.preset.spotlightRadiusPx) ?? null;
    // 七輪#5：聚焦壓黑同時「協力合作，守護雕像」從左滑進（對齊 Unity 序列 4：聚焦+GuardTextUI）。
    //   第十四輪③：此時限時事件文字已全程滑出（reveal gate 保證不重疊）；文字讀 override guardMessageText。
    this.guardTextHandle = this.ctx.effects?.guardText?.(this.msgs.guardMessageText) ?? null;
    this.phase = 'focus';
    this.focusElapsed = 0;
  }

  /** ④聚焦結束 → 淡出 + 還原雕像 depth + 解鎖操作 → 守護戰開始（combat）。 */
  private endFocus(): void {
    this.spotlight?.fadeOut();
    this.spotlight = null;
    // 七輪#5：解聚焦同時「協力守護雕像」滑出（對齊 Unity：解聚焦→GuardText 滑出→守護開始）。
    this.guardTextHandle?.fadeOut();
    this.guardTextHandle = null;
    this.target.setDepth(15); // 還原一般 depth
    this.ctx.scriptedControl = false; // 解鎖玩家操作
    this.spawnCooldown = 0; // combat 立即第一批 drip
    this.phase = 'combat';
  }

  private spawnAroundTarget(): void {
    // 三輪#9：守護波怪從左右兩側場地邊緣交替生成（往雕像靠攏包圍感，對照 Unity FindGuardSideSpawnPos）。
    const pos = guardSideSpawnPoint(this.guardSpawnNextLeft, MAP_BOUNDS);
    this.guardSpawnNextLeft = !this.guardSpawnNextLeft; // 翻轉 → 下隻另一側（兩側平均）
    const type = pickGuardEnemy(this.drip.spawns);
    this.ctx.spawner.spawn(type, pos.x, pos.y);
  }

  /** 結束：cleanup + 結算獎券。 */
  private finish(won: boolean): void {
    this.finished = true;
    this.won = won;
    // 用戶 #4：保險——結束時確保解鎖操作 + 清 spotlight（避免開場中意外結束殘留鎖定/遮罩）。
    this.ctx.scriptedControl = false;
    this.spotlight?.fadeOut();
    this.spotlight = null;
    this.guardTextHandle?.fadeOut(); // 七輪#5：保險——開場中意外結束不殘留守護大字
    this.guardTextHandle = null;

    const hpRatio = this.target.getHpRatio();
    // cleanup：清回玩家目標、清全部敵人、destroy 雕像。
    this.ctx.spawner.setGuardTarget(null);
    this.ctx.spawner.clearAllEnemies();
    this.target.destroy();

    if (won) {
      // 守護成功獎勵：佔位用寶盒進度（用戶決策 76f07f64，之後換正式 JP 燈號/彩金）。
      // 滿血=給一箱門檻(165)、半血=半箱。
      const chargeReward = Math.round(getResolvedChest().openThreshold * hpRatio);
      // 守護獎勵無個別歸屬 → 給本地 P1（多人守護獎勵分配之後另議）。
      this.ctx.chest.addCharge(this.ctx.player.playerId, chargeReward);
      console.info(
        `[Guard] 勝利！寶盒進度 +${chargeReward}（hpRatio ${hpRatio.toFixed(2)}，佔位）`,
      );
    } else {
      console.info('[Guard] 失敗，無獎勵（不 GameOver、關卡續行）');
    }
  }

  // --- UI / debug 查詢 ---
  getRemaining(): number {
    return Math.ceil(this.remaining);
  }

  /** 守護波時間上限（秒），倒數量條分母（#7 進度條用）。 */
  getTimeLimit(): number {
    return this.preset.timeLimit;
  }

  /** 量條 fill = (timeLimit - remaining)/timeLimit（隨時間填滿）。 */
  getGaugeFill(): number {
    return (this.preset.timeLimit - this.remaining) / this.preset.timeLimit;
  }

  getTargetHp(): number {
    return this.target.getHp();
  }

  getTargetMaxHp(): number {
    return this.target.getMaxHp();
  }

  didWin(): boolean {
    return this.won;
  }
}
