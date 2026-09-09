import type Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import type { ResolvedMineTrap } from '@/systems/WaveSystem';
import { STUN_DEFAULT_SEC } from '@/config/eventsConfig';
import { isInBlastRange, tickMineDelay } from '@/systems/mineTrapMath';

/** 場上一顆地雷的執行期狀態。 */
interface ActiveMine {
  x: number;
  y: number;
  remaining: number; // 剩餘延遲秒（<=0 爆）
  radiusPx: number;
  paralyzeSec: number;
  warning: Phaser.GameObjects.Image | null; // 預警圈 handle
}

/**
 * MineTrapSystem — 地雷陷阱實體（2 新事件階段 B）。
 *
 * 接波騎 WaveSystem.onMineTrap(ResolvedMineTrap) 觸發鉤子 → 依 WaveSystem 火雨式撒好的 resolved.points 逐點鋪雷
 * → 顯預警圈（脈動 delaySec）→ 延遲到爆炸（mineExplosion VFX）→ radiusPx 範圍內「玩家+怪」呼叫 applyStun(paralyzeSec) 麻痺。
 * ★不分敵我（怪也麻痺）、★不扣血（麻痺＝定住，角色無血量）。
 *
 * 走 decision a655c53d：碰共用 gameplay 契約（Enemy.applyStun/麻痺）→ 變身-leader review。
 * 觸發方式：本階段採「鋪下即延遲爆」（定點佈置＋delaySec 倒數）；碰觸觸發之後可加。
 */
export class MineTrapSystem implements GameSystem {
  readonly name = 'MineTrapSystem';
  private ctx!: GameContext;
  private mines: ActiveMine[] = [];

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  /**
   * 接 onMineTrap 鉤子（★火雨式自動撒）：直接用 WaveSystem 已全場撒好的 resolved.points 逐點鋪雷
   * （不自算落點），顯預警圈、起 delaySec 倒數。points 空 → 不鋪（合法）。
   */
  deployMines(resolved: ResolvedMineTrap): void {
    const delay = resolved.delaySec > 0 ? resolved.delaySec : 3;
    const paralyze = resolved.paralyzeSec > 0 ? resolved.paralyzeSec : STUN_DEFAULT_SEC;
    const radius = Math.max(0, resolved.radiusPx);
    for (const p of resolved.points ?? []) {
      const warning = this.ctx.effects?.mineWarningStart?.(p.x, p.y, radius) ?? null;
      this.mines.push({ x: p.x, y: p.y, remaining: delay, radiusPx: radius, paralyzeSec: paralyze, warning });
    }
  }

  update(dt: number): void {
    if (this.mines.length === 0) return;
    const still: ActiveMine[] = [];
    for (const m of this.mines) {
      const t = tickMineDelay(m.remaining, dt);
      m.remaining = t.remaining;
      if (t.exploded) {
        this.explode(m);
      } else {
        still.push(m);
      }
    }
    this.mines = still;
  }

  /** 爆炸：收預警圈 + 播爆炸 VFX + 範圍內玩家/怪麻痺（不分敵我、不扣血）。 */
  private explode(m: ActiveMine): void {
    this.ctx.effects?.mineWarningEnd?.(m.warning);
    this.ctx.effects?.mineExplosion?.(m.x, m.y, m.radiusPx);
    const center = { x: m.x, y: m.y };
    // 玩家（在場、非待機）在範圍內 → 麻痺。
    for (const p of this.ctx.players) {
      if (typeof p.isWaiting === 'function' && p.isWaiting()) continue; // 待機（面板上）不受場上地雷影響
      const pos = p.getFootPosition?.() ?? p.getPosition?.();
      if (pos && isInBlastRange(pos, center, m.radiusPx)) p.applyStun?.(m.paralyzeSec);
    }
    // 怪在範圍內 → 麻痺（★不分敵我）。
    for (const e of this.ctx.getEnemies?.() ?? []) {
      if (e.isDead?.()) continue;
      const c = e.getHitCenter?.();
      if (c && isInBlastRange(c, center, m.radiusPx)) e.applyStun?.(m.paralyzeSec);
    }
  }

  destroy(): void {
    for (const m of this.mines) this.ctx?.effects?.mineWarningEnd?.(m.warning);
    this.mines = [];
  }
}
