import { GAME_HEIGHT, GAME_WIDTH, PPU } from '@/config/gameConfig';
import { PLAYER_CONFIG } from '@/config/combatConfig';
import { scriptedMoveStep, allScriptedArrived, type Vec2 } from '@/systems/guardIntro';
import { towerGatherTargets, towerSpotlightTarget } from '@/systems/towerIntro';
import type { GameContext } from '@/systems/GameContext';

/** 塔波開場階段：玩家聚集中央走位 → 聚焦壓黑+定格 → 生塔 → 完成（交給 combat）。 */
type TowerIntroPhase = 'gather' | 'focus' | 'done';

/**
 * TowerIntroSequence — 魔尖塔波開場演出序列（game-side，決策：塔波照搬守護波 GuardEvent 的 intro）。
 *
 * 平移 GuardEvent 的 introMove→focus 那套（用守護波現成元件 timedEventText/guardText/guardSpotlight/
 * guardFocusPause/scriptedMoveStep），差異：走位目標改「玩家聚集中央/塔陣中心」（towerGatherTargets）、
 * 聚焦結束不生守護怪而是呼叫 onCombatStart（GameScene 生 towerCount 座塔+發亮）。
 *
 * 由 GameScene 在 onTowerWave 收到時 new + 每幀 tick（update）。完成（done）後 GameScene 停止 tick。
 * 資料層（訊息文字/聚焦秒數/spotlight 半徑/聚集半徑）由波騎 preset 給、GameScene 傳入（欄位未到前用預設）。
 */
export class TowerIntroSequence {
  private readonly ctx: GameContext;
  private phase: TowerIntroPhase = 'gather';

  // 走位（聚集中央）
  private readonly center: Vec2;
  private moveTargets: Vec2[] = [];
  private moveArrived: boolean[] = [];
  private moveElapsed = 0;
  private readonly maxWalkSec: number;

  // 聚焦
  private focusElapsed = 0;
  private readonly introFocusSec: number;
  private readonly spotlightRadiusPx: number;
  private readonly towerMessageText: string;
  /** Bug2：聚焦聚光燈打在「塔」上（塔位包圍盒中心+框整組半徑），非玩家聚集點 this.center。 */
  private readonly towerPositions: readonly Vec2[];
  private spotlight: { fadeOut: () => void } | null = null;
  private guardTextHandle: { fadeOut: () => void } | null = null;

  // 生塔（聚焦結束一次性觸發）
  private readonly onCombatStart: () => void;
  private finished = false;

  constructor(
    ctx: GameContext,
    opts: {
      /** 聚集中心（省略＝畫面中央）。塔陣中心＝各塔位置平均。 */
      center?: Vec2;
      /** 玩家離中心聚集半徑（px）。 */
      gatherOffsetPx?: number;
      /** 走位逾時保底秒數（防卡）。 */
      maxWalkSec?: number;
      /** 聚焦壓黑定格秒數。 */
      introFocusSec?: number;
      /** spotlight 亮圈半徑（px）。 */
      spotlightRadiusPx?: number;
      /** 開場大字（第一段）；空字串＝不顯。 */
      introEventText?: string;
      /** 顯示秒數（第一段大字）。 */
      eventTextDurationSec?: number;
      /** 第二段聚焦提示文字（滑進，比照守護波 guardText）。 */
      towerMessageText?: string;
      /** Bug2：塔位（場景座標）——聚焦聚光燈打在塔上（包圍盒中心+框整組），非玩家聚集點。 */
      towerPositions?: readonly Vec2[];
      /** 聚焦結束 → 生塔+發亮（GameScene 提供）。 */
      onCombatStart: () => void;
    },
  ) {
    this.ctx = ctx;
    this.center = opts.center ?? { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
    this.maxWalkSec = opts.maxWalkSec ?? 2.5;
    this.introFocusSec = opts.introFocusSec ?? 1.2;
    this.spotlightRadiusPx = opts.spotlightRadiusPx ?? 260;
    this.towerMessageText = opts.towerMessageText ?? '打掉所有尖塔！';
    this.towerPositions = opts.towerPositions ?? [];
    this.onCombatStart = opts.onCombatStart;

    // ①鎖操作 + 導引走位到中央聚集 + 開場大字（比照 GuardEvent constructor）。
    this.ctx.scriptedControl = true;
    const players = this.ctx.players ?? [];
    this.moveTargets = towerGatherTargets(this.center.x, this.center.y, players.length, opts.gatherOffsetPx ?? 120);
    this.moveArrived = players.map(() => false);
    const introText = opts.introEventText ?? '';
    if (introText !== '') {
      this.ctx.effects?.timedEventText?.(opts.eventTextDurationSec ?? 3, introText);
    }
    // 走位（自動移動）期間暫關搜索圈（footGlow），聚焦時恢復（比照守護波）。
    players.forEach((p) => p.setFootGlowVisible?.(false));
  }

  isDone(): boolean {
    return this.finished;
  }

  /** 每幀推進。回傳 true 表示 intro 已完成（GameScene 停止 tick）。 */
  update(dt: number): boolean {
    if (this.finished) return true;
    if (this.phase === 'gather') {
      this.updateGather(dt);
      return false;
    }
    if (this.phase === 'focus') {
      this.focusElapsed += dt;
      if (this.focusElapsed >= this.introFocusSec) this.endFocus();
      return false;
    }
    return this.finished;
  }

  /** 保險：外部強制結束（skip/波結束）→ 解鎖/清聚焦，別卡死。 */
  forceFinish(): void {
    if (this.finished) return;
    this.cleanupFocus();
    this.ctx.scriptedControl = false;
    (this.ctx.players ?? []).forEach((p) => p.setFootGlowVisible?.(true));
    this.finished = true;
    this.phase = 'done';
  }

  /** ①聚集走位：每幀把各玩家朝中央聚集點移動，全到位 or 逾時 → 進聚焦。 */
  private updateGather(dt: number): void {
    this.moveElapsed += dt;
    const speedPx = PLAYER_CONFIG.moveSpeed * PPU;
    const timedOut = this.moveElapsed >= this.maxWalkSec;
    const players = this.ctx.players ?? [];
    players.forEach((p, i) => {
      if (this.moveArrived[i]) {
        p.move({ x: 0, y: 0 }, dt);
        return;
      }
      const cur = p.getPosition();
      const tgt = this.moveTargets[i] ?? { x: cur.x, y: cur.y };
      if (timedOut) {
        p.setPosition(tgt.x, tgt.y);
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
        p.move(step.dir, dt);
      }
    });
    if (allScriptedArrived(this.moveArrived) || timedOut) {
      this.moveArrived = this.moveArrived.map(() => true);
      players.forEach((p) => p.setFootGlowVisible?.(true)); // 就定位 → 恢復搜索圈
      this.beginFocus();
    }
  }

  /** ②聚焦壓黑 spotlight（★打在塔上：塔位包圍盒中心+框整組半徑，Bug2 修）+ 第二段提示滑進 + 定格凍結（比照 GuardEvent.beginFocus 用雕像位置）。 */
  private beginFocus(): void {
    // Bug2：聚光燈中心＝塔位（非玩家聚集點 this.center）。塔波該聚焦「塔」。
    //   有塔位→包圍盒中心+框整組半徑（max(半對角線+邊距, preset spotlightRadiusPx)）；無塔位保底用 this.center。
    const spot = this.towerPositions.length > 0
      ? towerSpotlightTarget(this.towerPositions, this.spotlightRadiusPx)
      : { center: this.center, radiusPx: this.spotlightRadiusPx };
    this.spotlight = this.ctx.effects?.guardSpotlight?.(spot.center.x, spot.center.y, spot.radiusPx) ?? null;
    this.guardTextHandle = this.ctx.effects?.guardText?.(this.towerMessageText) ?? null;
    this.ctx.guardFocusPause = true; // 定格：玩法系統凍結（dt=0），聚焦 UI tween 照播
    this.phase = 'focus';
    this.focusElapsed = 0;
  }

  /** ③聚焦結束 → 淡出 + 解除定格/鎖操作 → 生塔+發亮（combat 開始）。 */
  private endFocus(): void {
    this.cleanupFocus();
    this.ctx.scriptedControl = false;
    this.phase = 'done';
    this.finished = true;
    this.onCombatStart(); // GameScene 生 towerCount 座塔 + playTowerAppear
  }

  private cleanupFocus(): void {
    this.spotlight?.fadeOut();
    this.spotlight = null;
    this.guardTextHandle?.fadeOut();
    this.guardTextHandle = null;
    this.ctx.guardFocusPause = false;
  }
}
