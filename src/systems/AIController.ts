import { AI_CONFIG } from '@/config/aiConfig';
import { PPU } from '@/config/gameConfig';
import type { Enemy } from '@/entities/Enemy';
import type { Player } from '@/entities/Player';
import type { GameContext } from '@/systems/GameContext';
import type { InputSource } from '@/systems/InputSource';
import type { Vec2 } from '@/systems/hitDetection';

/**
 * AIController — AI 玩家的 InputSource 實作（移植 Unity AIController「行為邏輯」，非結構）。
 *
 * 🔴 這是「產意圖」(getMoveVector/justPressedAttack)，PlayerControl pull-based 讀，不在乎人/AI。
 * 🔴 目標選擇是「AI 自己要打哪隻」= per-AI 內部狀態（this.currentTarget），**絕不碰 Enemy 的
 *    目標 override 單槽**（那是守護波重導敵人用，兩系統各管各）。
 *
 * 邏輯（參數照抄 Unity）：
 *  - FindTargetEnemy：存活敵人依距離排序（極近用穩定 key 破平手）→ 依 playerIndex 選第 N 近
 *    （offset=max(0,playerIndex-1)，不足退最近）→ 分散各 AI 目標。
 *  - ResolveTarget（黏著）：新目標近超過 targetSwitchMargin 才換。
 *  - 攻擊態遲滯（Schmitt）：dist<=attackRange 進攻擊態；dist>attackRange+hysteresis 才回追擊態。
 *  - 移動：非攻擊態→朝目標 normalized；攻擊態→停(zero)+面向目標。
 *  - 攻擊：攻擊態 attackInterval 到 → justPressedAttack 回 true（一次性 edge，讀後清）。
 *  - 不碰 Credit/變身/衝刺。
 *
 * dt：InputSource 無 dt 參數 → 用 scene.game.loop.delta 於每幀第一次 getMoveVector 時推進計時。
 */
export class AIController implements InputSource {
  private readonly ctx: GameContext;
  private readonly self: Player;

  private currentTarget: Enemy | null = null;
  private inAttackState = false;
  private attackTimer = 0;
  private pendingAttack = false;
  /** 本幀是否已 think（避免 getMoveVector/justPressedAttack 重複推進計時）。 */
  private lastThinkFrame = -1;

  constructor(ctx: GameContext, self: Player) {
    this.ctx = ctx;
    this.self = self;
    this.attackTimer = AI_CONFIG.attackInterval;
  }

  // --- InputSource ---
  getMoveVector(): { x: number; y: number } {
    this.thinkIfNeeded();
    if (this.inAttackState || !this.currentTarget) return { x: 0, y: 0 };
    const pos = this.self.getPosition();
    const t = this.currentTarget.getHitCenter();
    const dx = t.x - pos.x;
    const dy = t.y - pos.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { x: 0, y: 0 };
    return { x: dx / len, y: dy / len };
  }

  justPressedAttack(): boolean {
    this.thinkIfNeeded();
    if (this.pendingAttack) {
      this.pendingAttack = false; // 消耗 edge
      return true;
    }
    return false;
  }

  justPressedDash(): boolean {
    return false; // AI 不衝刺
  }

  // --- AI 邏輯 ---
  private thinkIfNeeded(): void {
    // 一幀只 think 一次（getMoveVector 與 justPressedAttack 同幀都會呼叫）。
    const frame = this.ctx.scene.game.getFrame();
    if (frame === this.lastThinkFrame) return;
    this.lastThinkFrame = frame;
    const dt = this.ctx.scene.game.loop.delta / 1000;
    this.think(dt);
  }

  private think(dt: number): void {
    // 目標選擇 + 黏著。
    const desired = this.findTargetEnemy();
    this.currentTarget = this.resolveTarget(desired);

    if (!this.currentTarget || this.currentTarget.isDead()) {
      this.inAttackState = false;
      this.pendingAttack = false;
      return;
    }

    const pos = this.self.getPosition();
    const t = this.currentTarget.getHitCenter();
    const dist = Math.hypot(t.x - pos.x, t.y - pos.y);
    const attackPx = AI_CONFIG.attackRange * PPU;
    const exitPx = (AI_CONFIG.attackRange + AI_CONFIG.attackRangeHysteresis) * PPU;

    // 面向目標（水平）。
    this.self.faceTowards(t.x);

    // Schmitt trigger 攻擊態遲滯。
    if (!this.inAttackState) {
      if (dist <= attackPx) this.inAttackState = true;
    } else if (dist > exitPx) {
      this.inAttackState = false;
    }

    // 攻擊計時（攻擊態才推進；到期且搆得到 → 產一次攻擊意圖）。
    if (this.inAttackState) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        if (dist <= attackPx) {
          this.pendingAttack = true; // 揮（形狀確認近似：在攻擊距離內才揮，防空揮）
          this.attackTimer = AI_CONFIG.attackInterval;
        }
        // 搆不到不揮不重置（保持 <=0，靠近立即可揮）。
      }
    } else {
      this.attackTimer = AI_CONFIG.attackInterval; // 追擊態重置攻擊計時
    }
  }

  /** 蒐集存活敵人 → 依距離排序（極近破平手）→ 依 playerIndex 選第 N 近。 */
  private findTargetEnemy(): Enemy | null {
    const pos = this.self.getPosition();
    const alive = this.ctx.getEnemies().filter((e) => !e.isDead());
    if (alive.length === 0) return null;
    const sorted = [...alive].sort((a, b) => {
      const da = this.dist2(pos, a.getHitCenter());
      const db = this.dist2(pos, b.getHitCenter());
      if (Math.abs(da - db) < 0.01) {
        // 穩定 key 破平手（用 hitCenter x,y 排序）。
        const ca = a.getHitCenter();
        const cb = b.getHitCenter();
        return ca.x - cb.x || ca.y - cb.y;
      }
      return da - db;
    });
    // 依 playerIndex 選第 N 近：P1(0)→最近；P2(1)→offset0=最近... Unity offset=max(0,idx-1)。
    const offset = Math.min(sorted.length - 1, Math.max(0, this.self.playerId - 1));
    return sorted[offset] ?? sorted[0];
  }

  /** 目標黏著：新目標要比當前近超過 targetSwitchMargin(px) 才換。 */
  private resolveTarget(desired: Enemy | null): Enemy | null {
    if (!desired) return null;
    const cur = this.currentTarget;
    if (!cur || cur.isDead()) return desired;
    if (cur === desired) return cur;
    const pos = this.self.getPosition();
    const curD = Math.hypot(cur.getHitCenter().x - pos.x, cur.getHitCenter().y - pos.y);
    const newD = Math.hypot(desired.getHitCenter().x - pos.x, desired.getHitCenter().y - pos.y);
    const marginPx = AI_CONFIG.targetSwitchMargin * PPU;
    return newD < curD - marginPx ? desired : cur;
  }

  private dist2(a: Vec2, b: Vec2): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
}
