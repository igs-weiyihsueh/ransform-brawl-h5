import { STAT_MULT_CLAMP, type BuffId, type StatTag } from '@/config/buffConfig';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/** 一個 buff 定義（顧問 confirm 形狀）。 */
export interface BuffDef {
  id: BuffId;
  /** 影響哪個 stat（可選；純 hook 效果可省）。 */
  statTag?: StatTag;
  /** 對該 stat 的倍率（statTag 有值時使用）。 */
  magnitude?: number;
  duration: number;
  onApply?: () => void;
  onExpire?: () => void;
}

interface ActiveBuff {
  def: BuffDef;
  remaining: number;
}

/**
 * BuffSystem — 統一計時 buff 框架（頭盔能力 + 寶盒坐騎/二段變身共用）。顧問 confirm 形狀。
 *
 * - 同 id 重套 = refresh 計時（重置 duration），不疊加 magnitude、不重跑 onApply。
 * - 不同 buff 各自獨立共存。
 * - 同 stat 多來源聚合 = magnitude 相乘（getStatMultiplier，順序無關）；
 *   clamp 套在「聚合後」結果（[0.1,5] placeholder）。
 * - 只有一個 buff 影響該 stat 時，積 = 單一 mult = 等同 Unity base×mult。
 * - 到期自動移除 + onExpire 還原。
 */
export class BuffSystem implements GameSystem {
  readonly name = 'BuffSystem';
  private _ctx!: GameContext;

  private active = new Map<BuffId, ActiveBuff>();

  init(ctx: GameContext): void {
    this._ctx = ctx;
    void this._ctx;
  }

  update(dt: number): void {
    for (const [id, b] of this.active) {
      b.remaining -= dt;
      if (b.remaining <= 0) {
        this.active.delete(id);
        b.def.onExpire?.();
      }
    }
  }

  /** 套用 buff。同 id 已存在 → refresh 計時（不重跑 onApply、不疊 magnitude）；否則 onApply + 加入。 */
  apply(def: BuffDef): void {
    const existing = this.active.get(def.id);
    if (existing) {
      existing.remaining = def.duration; // refresh
      return;
    }
    def.onApply?.();
    this.active.set(def.id, { def, remaining: def.duration });
  }

  /**
   * 聚合某 stat 的倍率：所有 active buff 中 statTag 命中者的 magnitude 相乘（順序無關），
   * 再對「聚合後結果」clamp（[0.1,5] placeholder）。無命中回 1（等同無效果）。
   */
  getStatMultiplier(stat: StatTag): number {
    let mult = 1;
    for (const [, b] of this.active) {
      if (b.def.statTag === stat && b.def.magnitude !== undefined) {
        mult *= b.def.magnitude;
      }
    }
    const [lo, hi] = STAT_MULT_CLAMP;
    return Math.min(hi, Math.max(lo, mult));
  }

  isActive(id: BuffId): boolean {
    return this.active.has(id);
  }

  getRemaining(id: BuffId): number {
    return this.active.get(id)?.remaining ?? 0;
  }

  getActiveIds(): BuffId[] {
    return [...this.active.keys()];
  }

  remove(id: BuffId): void {
    const b = this.active.get(id);
    if (!b) return;
    this.active.delete(id);
    b.def.onExpire?.();
  }

  destroy(): void {
    for (const [, b] of this.active) b.def.onExpire?.();
    this.active.clear();
  }
}
