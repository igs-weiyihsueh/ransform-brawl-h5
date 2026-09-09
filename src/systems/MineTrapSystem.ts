import type Phaser from 'phaser';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';
import type { MinePreset } from '@/config/mineConfig';
import { STUN_DEFAULT_SEC } from '@/config/eventsConfig';
import { isInBlastRange, tickMineDelay } from '@/systems/mineTrapMath';
import { pickFireRainPoint } from '@/systems/fireRainMath';
import type { Vec2 } from '@/systems/hitDetection';

/** 場上一顆地雷的執行期狀態（踩雷式）。 */
interface ActiveMine {
  x: number;
  y: number;
  radiusPx: number;
  paralyzeSec: number;
  /** 觸發後倒數爆炸秒數（撒下時存起，踩到才啟用）。 */
  delaySec: number;
  /** 是否已被玩家踩到觸發倒數。false＝靜置等踩（不倒數不爆）。 */
  triggered: boolean;
  /** 觸發後的剩餘倒數秒（<=0 爆）；未觸發時不動。 */
  remaining: number;
  /** 撒下時的靜置標記 handle（未觸發時顯，觸發時收）。 */
  marker: Phaser.GameObjects.Image | null;
  /** 觸發後的閃爍預警圈 handle（觸發時起、爆炸時收）。 */
  warning: Phaser.GameObjects.Image | null;
}

/**
 * MineTrapSystem — 地雷陷阱（★踩雷式重設計；附加類、讀取式，比照 FireRainSystem 自撒/自宣告）。
 *
 * 觸發＝讀取式（非回呼）：每幀讀 WaveSystem.getActiveMinePreset()（波騎 mineGateSec：波次宣告顯示中回 null）：
 *  - null → non-null（波次宣告顯完、開放撒雷）：發「小心地雷！」宣告 + 用 pickFireRainPoint 全場撒 count 顆
 *    （★撒下不倒數、只顯靜置標記，等玩家踩）。
 *  - non-null 期間：場上存活地雷 < maintainCount → 補撒到 maintainCount（踩爆少了補回）。
 *  - non-null → null（離開節點）：清乾淨、重置旗標，下個地雷節點再撒。
 *
 * 踩雷行為（每幀）：
 *  1) 未觸發的地雷：檢查任一在場非待機玩家 footPosition 進入 radiusPx → 觸發該顆（起閃爍預警圈 + 啟動 delaySec 倒數）。
 *     ★只玩家踩觸發，怪走過不觸發。
 *  2) 已觸發的地雷：倒數 remaining，<=0 → explode（mineExplosion VFX + radiusPx 內「玩家+怪」applyStun(paralyzeSec)）。
 * ★爆炸不分敵我（怪也麻痺）、★不扣血（麻痺＝定住，角色無血量）。撒點責任在 game-side（比照火雨自撒）。
 *
 * 走 decision a655c53d：碰共用 gameplay 契約（Enemy.applyStun/麻痺）→ 變身-leader review。
 */
export class MineTrapSystem implements GameSystem {
  readonly name = 'MineTrapSystem';
  private ctx!: GameContext;
  private mines: ActiveMine[] = [];
  /** 目前是否在地雷節點的「開放撒雷」狀態（preset non-null）。用來偵測 null→non-null 起始撒+宣告。 */
  private active = false;
  /** 本節點是否已發過「小心地雷！」宣告（一節點只宣告一次）。 */
  private announced = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  /**
   * 撒 n 顆地雷（★踩雷式：撒下不倒數、只顯靜置標記，等玩家踩）。
   * 撒點比照火雨（全場隨機+縮邊+不重疊，已在場的地雷也算佔位避免重疊）；撒不出（太擠）的略過。
   */
  private scatterMines(preset: MinePreset, n: number): void {
    const delay = preset.delaySec >= 0 ? preset.delaySec : 3;
    const paralyze = preset.paralyzeSec > 0 ? preset.paralyzeSec : STUN_DEFAULT_SEC;
    const radius = Math.max(0, preset.radiusPx);
    const edge = preset.edgeMarginPx ?? 0;
    // 已在場地雷的位置也納入佔位，避免補撒時跟現有地雷重疊。
    const placed: Vec2[] = this.mines.map((m) => ({ x: m.x, y: m.y }));
    const targetTotal = placed.length + Math.max(0, n);
    for (let i = 0; i < n; i += 1) {
      // maxConcurrent 用 targetTotal（含既有），讓 pickFireRainPoint 以總數為並發上限鋪點。
      const p = pickFireRainPoint(placed, Math.random, radius, edge, targetTotal);
      if (!p) continue; // 太擠撒不下 → 略過這顆
      placed.push(p);
      const marker = this.ctx.effects?.mineMarkerStart?.(p.x, p.y, radius) ?? null;
      this.mines.push({
        x: p.x,
        y: p.y,
        radiusPx: radius,
        paralyzeSec: paralyze,
        delaySec: delay,
        triggered: false,
        remaining: delay,
        marker,
        warning: null,
      });
    }
  }

  update(dt: number): void {
    // 讀取式觸發（比照 FireRainSystem）：每幀讀 getActiveMinePreset（波騎 mineGate：波次宣告中回 null）。
    //   ★boot 安全：ctx/wave 未就緒（boot 早期幀）→ 早退，不撒不 throw（不影響 ctx wiring）。
    const preset = this.ctx?.wave?.getActiveMinePreset?.() ?? null;

    if (preset !== null) {
      if (!this.active) {
        // null → non-null：波次宣告顯完、開放撒雷 → 發「小心地雷！」宣告 + 撒初始 count 顆。
        this.active = true;
        if (!this.announced) {
          this.announced = true;
          this.ctx.effects?.mineAnnounce?.();
        }
        this.scatterMines(preset, Math.max(1, preset.count));
      } else {
        // 開放期間：維持場上數量（存活地雷 < maintainCount → 補撒到 maintainCount）。
        const target = Math.max(preset.count, preset.maintainCount);
        const missing = target - this.mines.length;
        if (missing > 0) this.scatterMines(preset, missing);
      }
    } else if (this.active) {
      // non-null → null：離開地雷節點 → 清乾淨、重置旗標供下個地雷節點再撒+再宣告。
      this.clearAll();
      this.active = false;
      this.announced = false;
    }

    if (this.mines.length === 0) return;

    // 踩雷 + 倒數：未觸發的檢查玩家踩到 → 觸發；已觸發的倒數 → 爆。
    const still: ActiveMine[] = [];
    for (const m of this.mines) {
      if (!m.triggered) {
        if (this.playerSteppedOn(m)) this.triggerMine(m);
        still.push(m);
        continue;
      }
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

  /** 是否有「在場、非待機」玩家的 footPosition 進入這顆地雷的 radiusPx（★只玩家、怪不算）。 */
  private playerSteppedOn(m: ActiveMine): boolean {
    const center = { x: m.x, y: m.y };
    for (const p of this.ctx.players) {
      if (typeof p.isWaiting === 'function' && p.isWaiting()) continue; // 待機（面板上）不踩雷
      const pos = p.getFootPosition?.() ?? p.getPosition?.();
      if (pos && isInBlastRange(pos, center, m.radiusPx)) return true;
    }
    return false;
  }

  /** 觸發一顆地雷：收靜置標記 → 起閃爍預警圈 → 啟動 delaySec 倒數。 */
  private triggerMine(m: ActiveMine): void {
    m.triggered = true;
    m.remaining = m.delaySec;
    this.ctx.effects?.mineMarkerEnd?.(m.marker);
    m.marker = null;
    m.warning = this.ctx.effects?.mineWarningStart?.(m.x, m.y, m.radiusPx) ?? null;
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

  /** 清掉場上所有地雷的視覺（標記/預警圈）並清空清單（離開節點/銷毀時）。 */
  private clearAll(): void {
    for (const m of this.mines) {
      this.ctx?.effects?.mineMarkerEnd?.(m.marker);
      this.ctx?.effects?.mineWarningEnd?.(m.warning);
    }
    this.mines = [];
  }

  destroy(): void {
    this.clearAll();
  }
}
