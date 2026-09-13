/**
 * IPlayerControlStrategy — 玩家操控策略介面（鬥氣模式階段 1）。
 *
 * PlayerControlSystem 依 ctx.gameMode 選策略、每幀委派 update(dt)：
 *  - NormalControlStrategy：現有《變身大亂鬥》操控（update body 逐字搬、byte 級同現況）。
 *  - DouqiControlStrategy：鬥氣模式操控（衝刺代移動/融合瞄準/衝刺攻擊）；階段 1 commit1 先委派 Normal 佔位。
 *
 * ★策略只負責「每幀操控主迴圈」；所有 state/helper/對外接口留在 PlayerControlSystem（策略持 sys ref 委派呼叫）。
 */
export interface IPlayerControlStrategy {
  /** 每幀操控結算（由 PlayerControlSystem.update 委派）。 */
  update(dt: number): void;
}
