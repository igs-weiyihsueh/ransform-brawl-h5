import type Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import type { MinePreset } from '@/config/mineConfig';
import { STUN_DEFAULT_SEC } from '@/config/eventsConfig';
import { isInBlastRange, tickMineDelay } from '@/systems/mineTrapMath';
import { pickFireRainPoint } from '@/systems/fireRainMath';
import type { Vec2 } from '@/systems/hitDetection';

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
 * MineTrapSystem — 地雷陷阱（2 新事件·單一架構重構：★附加類、讀取式，比照 FireRainSystem）。
 *
 * 觸發＝讀取式（非回呼）：每幀讀 WaveSystem.getActiveMinePreset()：
 *  - 有 preset 且本節點還沒撒過 → 用 pickFireRainPoint 全場撒 count 顆 → 逐點鋪雷（一批，鋪下即延遲爆）。
 *  - preset 變 null（離開節點）→ 重置「已撒」旗標，下次進地雷節點可再撒。
 * 鋪雷後：顯預警圈（脈動 delaySec）→ 延遲爆炸（mineExplosion VFX）→ radiusPx 範圍內「玩家+怪」applyStun(paralyzeSec)。
 * ★不分敵我（怪也麻痺）、★不扣血（麻痺＝定住，角色無血量）。撒點責任在 game-side（比照火雨 FireRainSystem 自撒）。
 *
 * 走 decision a655c53d：碰共用 gameplay 契約（Enemy.applyStun/麻痺）→ 變身-leader review。
 */
export class MineTrapSystem implements GameSystem {
  readonly name = 'MineTrapSystem';
  private ctx!: GameContext;
  private mines: ActiveMine[] = [];
  /** 本次地雷節點是否已撒過（讀取式防每幀重撒；preset 變 null 時重置）。 */
  private deployedThisNode = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  /**
   * 用 pickFireRainPoint 全場撒 preset.count 顆 → 逐點鋪雷（顯預警圈、起 delaySec 倒數）。
   * 撒點比照火雨（全場隨機+縮邊+不重疊）；撒不出（太擠）的略過。
   */
  private scatterMines(preset: MinePreset): void {
    const delay = preset.delaySec > 0 ? preset.delaySec : 3;
    const paralyze = preset.paralyzeSec > 0 ? preset.paralyzeSec : STUN_DEFAULT_SEC;
    const radius = Math.max(0, preset.radiusPx);
    const edge = preset.edgeMarginPx ?? 0;
    const placed: Vec2[] = [];
    for (let i = 0; i < preset.count; i += 1) {
      // maxConcurrent 用 count（本批要撒 count 顆，不受火雨並發上限限制）。
      const p = pickFireRainPoint(placed, Math.random, radius, edge, preset.count);
      if (!p) continue; // 太擠撒不下 → 略過這顆
      placed.push(p);
      const warning = this.ctx.effects?.mineWarningStart?.(p.x, p.y, radius) ?? null;
      this.mines.push({ x: p.x, y: p.y, remaining: delay, radiusPx: radius, paralyzeSec: paralyze, warning });
    }
  }

  update(dt: number): void {
    // 讀取式觸發（比照 FireRainSystem）：每幀讀 getActiveMinePreset。
    //   有 preset 且本節點還沒撒 → 撒一批；preset 變 null（離開節點）→ 重置旗標供下個地雷節點再撒。
    //   ★boot 安全：ctx/wave 未就緒（boot 早期幀）→ 早退，不撒不 throw（不影響 ctx wiring）。
    const preset = this.ctx?.wave?.getActiveMinePreset?.() ?? null;
    if (preset !== null) {
      if (!this.deployedThisNode) {
        this.scatterMines(preset);
        this.deployedThisNode = true;
      }
    } else {
      this.deployedThisNode = false;
    }

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
