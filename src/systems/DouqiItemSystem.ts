import type { GameSystem } from '@/systems/GameSystem';
import type { GameContext } from '@/systems/GameContext';
import { DouqiItem } from '@/entities/DouqiItem';
import { DOUQI_ITEM_CONFIG, type DouqiItemSkill } from '@/config/douqiItemConfig';
import { rollDrop, pickWeightedDropSkill, overlapPickup } from '@/systems/douqiItemMath';

/**
 * DouqiItemSystem — 鬥氣道具系統（v45 階段1：生成/掉落/場上/lifespan/blink/maxAlive + 單人碰到即拾框架）。
 *
 * ★只 douqi（GameScene 依 gameMode==='douqi' 才 init/註冊）；normal 完全不生道具、byte 不變、WaveSystem 不碰。
 * ★階段1 選 b 簡化：忽略護盾（碰到即拾）；護盾破盾+融合瞄準鎖道具+命中分流留階段1.5（集中動 DouqiControlStrategy 一顆）。
 * ★階段1 拾取只呼 onPickup hook（log/佔位），各道具效果階段2 接；多人近者原子結算階段3（階段1 單人碰即拾）。
 * 純函式（掉落 roll/加權挑選/lifespan/blink/overlap）抽 douqiItemMath 交測騎。
 */
export class DouqiItemSystem implements GameSystem {
  readonly name = 'DouqiItemSystem';
  private ctx!: GameContext;
  private readonly cfg = DOUQI_ITEM_CONFIG;
  private items: DouqiItem[] = [];
  /**
   * 拾取觸發 hook（階段2c：回 boolean＝是否消耗道具）。
   * ★回 true＝消耗（移除道具，A/B/C/E/F 及 T 有觸發時）；回 false＝不消耗（T 時停空放 spreadRadius 內無敵→道具留著避免浪費）。
   */
  onPickup: (skill: DouqiItemSkill, playerId: number) => boolean = (skill, pid) => {
    // 預設佔位：log + 消耗（真效果由 GameScene 綁 DouqiItemEffects.trigger）。
    // eslint-disable-next-line no-console
    console.log(`[DouqiItem] P${pid + 1} 撿到道具 ${skill}`);
    return true;
  };

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  /**
   * ★掉落 hook（GameScene.onEnemyKilled douqi 分支呼）：擲 dropChance→加權挑 skill→生道具（未達 maxAlive）。
   * @param pos 掉落位置（怪死亡點）。
   */
  rollDropAt(pos: { x: number; y: number }): void {
    if (this.items.length >= this.cfg.maxAlive) return; // ★滿了不生
    if (!rollDrop(this.cfg.dropChance)) return;
    const skill = pickWeightedDropSkill(this.cfg.entries);
    if (skill == null) return;
    const entry = this.cfg.entries.find((e) => e.skill === skill);
    if (!entry) return;
    this.items.push(new DouqiItem(this.ctx.scene, skill, entry.color, pos.x, pos.y, entry.label));
  }

  update(dt: number): void {
    if (this.items.length === 0) return;
    const dtMs = dt * 1000;
    // 場上 lifespan/blink 推進 + 逾時回收。
    for (const item of this.items) {
      if (!item.update(dtMs)) item.destroy();
    }
    this.items = this.items.filter((i) => i.isAlive());
    // 拾取：單人碰到即拾（階段1 忽略盾）。★多人近者原子結算階段3。
    this.tickPickup();
  }

  private tickPickup(): void {
    if (this.items.length === 0) return;
    const remaining: DouqiItem[] = [];
    for (const item of this.items) {
      const c = item.getHitCenter();
      let pickedBy = -1;
      for (const player of this.ctx.players) {
        const pos = player.getPosition();
        const pr = (player as unknown as { getHitRadius?: () => number }).getHitRadius?.() ?? 20;
        if (overlapPickup(c.x, c.y, pos.x, pos.y, item.getPickupRadiusPx(), pr)) {
          pickedBy = player.playerId;
          break;
        }
      }
      if (pickedBy >= 0) {
        const consumed = this.onPickup(item.skill, pickedBy); // 回 boolean＝是否消耗
        if (consumed) {
          item.destroy();
        } else {
          remaining.push(item); // ★T 空放不消耗→道具留著
        }
      } else {
        remaining.push(item);
      }
    }
    this.items = remaining;
  }

  /** 供融合瞄準/攻擊查詢（階段1.5 鎖道具用；階段1 未接）。 */
  getItems(): readonly DouqiItem[] {
    return this.items;
  }

  destroy(): void {
    for (const item of this.items) item.destroy();
    this.items = [];
  }
}
