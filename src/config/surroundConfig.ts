/**
 * surroundConfig.ts — 環繞/推擠實驗開關（征騎，ContactSolver 接線階段①）。
 *
 * 兩組執行期可切換的開關，供用戶 A/B 比較（可從 console 或編輯器改，無需重編譯）：
 *
 *  1. overlapSolver：怪-怪解重疊用哪套。
 *     - 'contactSolver'：Unity 移植的 solveContacts（slop 容忍/jacobiRelaxation 每幀推一半/count 取平均/
 *        質量比例分攤）。★升級版。
 *     - 'legacy'：原本的 resolveEnemyOverlap（全量頂/movable 布林）。★一鍵回退用，保留不刪。
 *
 *  2. surroundMode：怪怎麼包圍玩家。
 *     - 'slots'：SurroundSlotManager 槽位同心圓環繞（現有 A 法）。
 *     - 'emergent'：純湧現法（B 法，瓢蟲原版精神）——旁路槽位、目標直接指玩家，
 *        圍圈是「分離力 + 解重疊擠出來」的副產品。EnemySpawner 對每隻設 slotPos=null，
 *        Enemy.moveChase 自動走 fallback（朝玩家直線追 + 分離力）。
 *
 * ★階段①只做怪-怪 solver + A/B 開關；玩家 PaceMove（動操作手感的高風險點）階段②再做，本檔不含。
 * 純資料模組、零 Phaser 依賴（可測）。狀態為 module-level 單例（全域遊戲唯一一組設定）。
 */

export type OverlapSolver = 'contactSolver' | 'legacy';
export type SurroundMode = 'slots' | 'emergent';
export type PlayerSolver = 'contactSolver' | 'legacy';

export interface SurroundRuntimeConfig {
  overlapSolver: OverlapSolver;
  surroundMode: SurroundMode;
  /**
   * 階段②：玩家 paceMove 推擠用哪套（玩家 vs 怪 / 玩家 vs 玩家）。
   * ★預設 'legacy'——不動現有玩家操作手感（既有 pushOutOfPlayer/resolvePenetration/pushLoad 不變）。
   * 'contactSolver'＝玩家移動前先過 paceMove 速度層預減速（唯一動手感的高風險點，用戶實機試再定去留）。
   */
  playerSolver: PlayerSolver;
}

/** 預設：新 solver + 槽位法 + ★玩家 legacy（怪-怪升級、玩家手感不動）。 */
export const DEFAULT_SURROUND_RUNTIME_CONFIG: SurroundRuntimeConfig = {
  overlapSolver: 'contactSolver',
  surroundMode: 'slots',
  playerSolver: 'legacy',
};

// module-level 可變單例（執行期切換）。以淺拷貝初始化，避免共享參照被外部改到 DEFAULT。
const state: SurroundRuntimeConfig = { ...DEFAULT_SURROUND_RUNTIME_CONFIG };

export function getSurroundRuntimeConfig(): Readonly<SurroundRuntimeConfig> {
  return state;
}

export function getOverlapSolver(): OverlapSolver {
  return state.overlapSolver;
}

export function getSurroundMode(): SurroundMode {
  return state.surroundMode;
}

export function getPlayerSolver(): PlayerSolver {
  return state.playerSolver;
}

export function setOverlapSolver(solver: OverlapSolver): void {
  state.overlapSolver = solver;
}

export function setSurroundMode(mode: SurroundMode): void {
  state.surroundMode = mode;
}

export function setPlayerSolver(solver: PlayerSolver): void {
  state.playerSolver = solver;
}

/** 一次覆寫（缺欄不動）。 */
export function setSurroundRuntimeConfig(patch: Partial<SurroundRuntimeConfig>): void {
  if (patch.overlapSolver !== undefined) state.overlapSolver = patch.overlapSolver;
  if (patch.surroundMode !== undefined) state.surroundMode = patch.surroundMode;
  if (patch.playerSolver !== undefined) state.playerSolver = patch.playerSolver;
}

/** 重置回預設（測試/回退用）。 */
export function resetSurroundRuntimeConfig(): void {
  state.overlapSolver = DEFAULT_SURROUND_RUNTIME_CONFIG.overlapSolver;
  state.surroundMode = DEFAULT_SURROUND_RUNTIME_CONFIG.surroundMode;
  state.playerSolver = DEFAULT_SURROUND_RUNTIME_CONFIG.playerSolver;
}
