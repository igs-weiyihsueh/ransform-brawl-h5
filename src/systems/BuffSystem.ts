import type { BuffId } from '@/config/buffConfig';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/** 一個 buff 定義：id + 持續秒數 + 生命週期 hook。 */
export interface BuffDef {
  id: BuffId;
  duration: number;
  onApply?: () => void;
  onExpire?: () => void;
}

interface ActiveBuff {
  def: BuffDef;
  remaining: number;
}

/**
 * BuffSystem — 通用計時 buff 框架（頭盔能力 + 寶盒坐騎/二段變身共用）。
 *
 * apply(def)：套用 → onApply → 計時；到期自動 onExpire + 移除。
 * 可同時多個；同 id 重套 = 覆蓋（重置計時、不重複 onApply）。
 * isActive(id) 查詢；getRemaining(id) 給 UI 倒數。
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

  /** 套用 buff。同 id 已存在 → 覆蓋重置計時（不重跑 onApply）；否則 onApply + 加入。 */
  apply(def: BuffDef): void {
    const existing = this.active.get(def.id);
    if (existing) {
      existing.remaining = def.duration; // 重套覆蓋：重置計時
      return;
    }
    def.onApply?.();
    this.active.set(def.id, { def, remaining: def.duration });
  }

  /** 是否啟用中。 */
  isActive(id: BuffId): boolean {
    return this.active.has(id);
  }

  /** 剩餘秒數（未啟用回 0）。 */
  getRemaining(id: BuffId): number {
    return this.active.get(id)?.remaining ?? 0;
  }

  /** 目前啟用中的 buff id 清單（debug/UI）。 */
  getActiveIds(): BuffId[] {
    return [...this.active.keys()];
  }

  /** 立即移除某 buff（觸發 onExpire）。 */
  remove(id: BuffId): void {
    const b = this.active.get(id);
    if (!b) return;
    this.active.delete(id);
    b.def.onExpire?.();
  }

  destroy(): void {
    // 場景關閉：觸發所有 onExpire 還原（避免殘留視覺/狀態）。
    for (const [, b] of this.active) b.def.onExpire?.();
    this.active.clear();
  }
}
