import type { Vec2 } from '@/systems/hitDetection';
import {
  DEFAULT_SURROUND_PARAMS,
  chooseNearestSlot,
  decodeSlotId,
  slotWorldPos,
  tryClaimInnerSlot,
  tryClaimBalanceSlot,
  type SurroundParams,
} from '@/systems/surroundSlots';

/**
 * ISurroundTarget — 可被環繞的目標（對應 Unity ISurroundTarget 4 成員）。
 * H5 對應：
 *  - getVacuumCenter() → 環中心（Unity SurroundTransform + VacuumVisualOffsetY；footGlowCenter 含腳部 offset，跟真空圈同心）。
 *  - getVacuumRadius() → 真空圈半徑（Unity VacuumRadius；最內層槽半徑基準參考）。
 *  - isSurroundActive() → 當前可否被環繞（Unity IsSurroundActive；玩家待機/出局 false、守護目標存活 true）。
 */
export interface ISurroundTarget {
  getVacuumCenter(): Vec2;
  getVacuumRadius(): number;
  isSurroundActive(): boolean;
}

/**
 * SurroundSlotManager — 單一環繞目標的槽位佔用管理（對應 Unity 每目標一組 manager）。
 *
 * 職責：持有 target、維護 slot 佔用表（slotId → enemyId）與反查（enemyId → slotId），
 * 提供 claim（就近入位）/ release（離場/換目標）/ tryClaimInner（往內遞補）/ getSlotPos（每幀讀 target 位置重算世界座標）。
 *
 * 狀態機接線（讀 sprite 位置、每幀協調）由 EnemySpawner 驅動；此 class 只管佔用與座標，
 * 幾何/選擇邏輯全委派 surroundSlots.ts 純函式（可測）。
 *
 * 靜態註冊表 registry（對應 Unity static Dictionary<target, manager>）：
 *  - getOrCreate(target)：lazy 建（首個要環繞此目標的敵人觸發）。
 *  - release(target)：目標離場（守護波結束/玩家出局）清掉，避免殘留。
 */
export class SurroundSlotManager {
  private readonly slotToEnemy = new Map<number, number>();
  private readonly enemyToSlot = new Map<number, number>();

  constructor(
    private readonly target: ISurroundTarget,
    private readonly params: SurroundParams = DEFAULT_SURROUND_PARAMS,
  ) {}

  /** 環中心（像素）：每幀讀 target 真空圈中心（跟視覺真空圈同心）。 */
  getRingCenter(): Vec2 {
    return this.target.getVacuumCenter();
  }

  /** 目標當前可否被環繞（玩家非待機/守護存活）。 */
  isActive(): boolean {
    return this.target.isSurroundActive();
  }

  /** 敵人目前持有的 slotId（未持有回 -1）。 */
  getEnemySlot(enemyId: number): number {
    return this.enemyToSlot.get(enemyId) ?? -1;
  }

  /** 某 slotId 的世界座標（像素）；每幀依 target 位置重算（玩家跑動槽跟著動）。 */
  getSlotPos(slotId: number): Vec2 {
    const { layer, index } = decodeSlotId(slotId);
    return slotWorldPos(this.getRingCenter(), layer, index, this.params);
  }

  /** slotId 所在層（供菁英 minLayer 判斷 / 遞補比較）。 */
  getSlotLayer(slotId: number): number {
    return decodeSlotId(slotId).layer;
  }

  /**
   * 敵人 claim 一個槽（就近、內層優先）。已持有槽則直接回原槽（不重 claim，對應 Unity claim 後持有）。
   * @param enemyId 敵人唯一 id。
   * @param enemyPos 敵人當前位置（像素）——同層挑最近空槽依此。
   * @param minLayer 起始層（小怪 0、菁英 eliteMinLayer=2）。
   * @returns 分到的 slotId，或 -1（全滿，呼叫端 fallback 一般追擊）。
   */
  claim(enemyId: number, enemyPos: Vec2, minLayer: number): number {
    const existing = this.enemyToSlot.get(enemyId);
    if (existing !== undefined) return existing; // 已持有 → 不重 claim

    const occupied = this.occupiedSet();
    const slotId = chooseNearestSlot(enemyPos, this.getRingCenter(), occupied, this.params, minLayer);
    if (slotId < 0) return -1; // 全滿
    this.assign(enemyId, slotId);
    return slotId;
  }

  /**
   * 主動往更內層遞補（前排死→內圈空→外層怪補進來）。原子：釋放舊槽 + claim 更內層最近空槽。
   * 只往內、找不到就不動（回 -1，保留原槽），避免抖動。
   * @returns 遞補後的新 slotId，或 -1（無更內空槽、原槽不變）。
   */
  tryClaimInner(enemyId: number, enemyPos: Vec2, minLayer: number): number {
    const cur = this.enemyToSlot.get(enemyId);
    if (cur === undefined) return -1; // 尚未持槽，不遞補（走 claim）
    const currentLayer = decodeSlotId(cur).layer;

    // 排除自己當前槽再判斷（否則自己那格會擋住 occupied）。
    const occupied = this.occupiedSet();
    occupied.delete(cur);

    const innerId = tryClaimInnerSlot(
      enemyPos,
      this.getRingCenter(),
      currentLayer,
      occupied,
      this.params,
      minLayer,
    );
    if (innerId < 0) return -1; // 無更內空槽 → 保留原槽
    // 原子遞補：釋放舊、佔新。
    this.slotToEnemy.delete(cur);
    this.assign(enemyId, innerId);
    return innerId;
  }

  /**
   * 十六輪③：橫向失衡矯正（明顯失衡才遷移、抗抖）——把堆在最擠象限的怪遷到明顯較空象限的同層空槽。
   * 原子：釋放舊槽 + 佔新槽。呼叫端須以冷卻 gate（遷移後一段時間不再遷）避免抖動。
   * @returns 遷移後新 slotId，或 -1（未失衡/無較空象限空槽/未持槽，原槽不變）。
   */
  tryClaimBalance(enemyId: number, enemyPos: Vec2, minLayer: number): number {
    const cur = this.enemyToSlot.get(enemyId);
    if (cur === undefined) return -1; // 未持槽不遷
    const occupied = this.occupiedSet(); // ★含自己（象限擁擠統計需含）
    const balanceId = tryClaimBalanceSlot(enemyPos, this.getRingCenter(), cur, occupied, this.params, minLayer);
    if (balanceId < 0) return -1;
    // 原子遷移：釋放舊、佔新。
    this.slotToEnemy.delete(cur);
    this.assign(enemyId, balanceId);
    return balanceId;
  }

  /** 釋放敵人持有的槽（死亡/離開 chase/換目標）。無槽則 no-op。 */
  release(enemyId: number): void {
    const slotId = this.enemyToSlot.get(enemyId);
    if (slotId === undefined) return;
    this.enemyToSlot.delete(enemyId);
    this.slotToEnemy.delete(slotId);
  }

  /** 目前佔用的槽數（debug/測試查詢）。 */
  occupiedCount(): number {
    return this.slotToEnemy.size;
  }

  private assign(enemyId: number, slotId: number): void {
    this.slotToEnemy.set(slotId, enemyId);
    this.enemyToSlot.set(enemyId, slotId);
  }

  private occupiedSet(): Set<number> {
    return new Set(this.slotToEnemy.keys());
  }

  // --- 靜態註冊表（對應 Unity static Dictionary<target, manager>） ---

  private static readonly registry = new Map<ISurroundTarget, SurroundSlotManager>();

  /** lazy 取得/建立某目標的 manager（首個要環繞此目標的敵人觸發）。 */
  static getOrCreate(
    target: ISurroundTarget,
    params: SurroundParams = DEFAULT_SURROUND_PARAMS,
  ): SurroundSlotManager {
    let mgr = SurroundSlotManager.registry.get(target);
    if (!mgr) {
      mgr = new SurroundSlotManager(target, params);
      SurroundSlotManager.registry.set(target, mgr);
    }
    return mgr;
  }

  /** 取得已存在的 manager（無則 null，不建立）。 */
  static get(target: ISurroundTarget): SurroundSlotManager | null {
    return SurroundSlotManager.registry.get(target) ?? null;
  }

  /** 目標離場清除（守護波結束/玩家出局），避免註冊表殘留。 */
  static remove(target: ISurroundTarget): void {
    SurroundSlotManager.registry.delete(target);
  }

  /** 清空全部（場景重啟/測試隔離用）。 */
  static clearAll(): void {
    SurroundSlotManager.registry.clear();
  }
}
