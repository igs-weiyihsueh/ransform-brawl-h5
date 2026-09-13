import { tickDashCharge } from '@/systems/dashChargeMath';
import type { IPlayerControlStrategy } from '@/systems/control/IPlayerControlStrategy';
import type { PlayerControlSystem } from '@/systems/PlayerControlSystem';

/**
 * NormalControlStrategy — 現有《變身大亂鬥》操控策略。
 *
 * ★update body 逐字搬自原 PlayerControlSystem.update（一字不改、byte 級同現況）；
 *   所有 state/helper 留在 PlayerControlSystem，本策略持 sys ref 委派呼叫（applyBuffState/updatePlayer 等已放寬 @internal）。
 * ★變身-leader byte-gate：normal 路徑邏輯逐行原封，僅 this.xxx → this.sys.xxx（委派同一份實作）。
 */
export class NormalControlStrategy implements IPlayerControlStrategy {
  constructor(private readonly sys: PlayerControlSystem) {}

  update(dt: number): void {
    // buff 倍率/護盾每幀套（目前只影響 P1 玩家實體；per-player buff 之後 S5 再細分）。
    this.sys.applyBuffState();
    // S4：對每個 player（P1 人類 + P2-P4 AI）各自跑操控結算。
    for (const player of this.sys.ctxRef.players) {
      // 十六輪：衝刺充能逐格回充（每幀推進，不受待機/進場影響）。
      this.sys.dashChargeMap.set(player.playerId, tickDashCharge(this.sys.dashChargeOf(player.playerId), dt, this.sys.dashMaxChargesOf(), this.sys.dashCooldownDurationOf()));
      this.sys.updatePlayer(player, dt);
    }
    if (this.sys.shapeFlashRef > 0) this.sys.decShapeFlash(dt);
  }
}
