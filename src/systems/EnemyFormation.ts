import { PPU } from '@/config/gameConfig';
import { computeFormationSlots, type FormationConfig } from '@/config/formationConfig';
import { advanceAnchor, splinePoint } from '@/systems/formationMath';
import type { Enemy } from '@/entities/Enemy';
import type { Vec2 } from '@/systems/hitDetection';

/**
 * EnemyFormation — 整隊移動執行系統（怪物 AI 移植第 2 塊，鬥破規格第 6 節）。
 *
 * 定隊形 → computeFormationSlots 算成員相對偏移 → 綁成員到 slot → 每幀算節點世界座標
 * (anchor + slot×PPU；★anchor 由呼叫端傳 offset-aware 起點) → 驅動成員 followFormationNode（跟節點走、不各自 chase）
 * → 整隊 anchor 沿 facing/spline 推進 → 中途死移除該 slot → 全員回收/清場 → 標記 done。
 *
 * ★契約：
 *  1) 不動 Enemy FSM：只呼 member.setFormationControlled + followFormationNode（外層編排）。
 *  2) AI 切換乾淨：綁定 setFormationControlled(true)＝不 chase；destroy/回收 setFormationControlled(false)＝回 chase。
 *  3) offset-aware：anchor 起點由 EnemySpawner 傳（已含 getLevelOffsetX）；spline 點亦世界座標。
 *  4) 清場/過關：EnemySpawner registry 管，clearAllEnemies → 對每個 formation destroy（解控成員+標 done）。
 */
export class EnemyFormation {
  private readonly config: FormationConfig;
  /** slot 相對偏移（unit，已套 facing 旋轉）；index 對應 members。 */
  private readonly slotOffsets: Vec2[];
  /** 成員（index 對應 slotOffsets；死亡→設 null 空出該 slot）。 */
  private readonly members: (Enemy | null)[];
  /** 整隊錨點（世界 px，offset-aware 起點）。 */
  private anchor: Vec2;
  /** spline 進度 0..1（有 spline 時沿曲線推進）。 */
  private splineT = 0;
  private done = false;

  /**
   * @param config 陣型設定。
   * @param anchor 起始錨點（世界 px；★由 EnemySpawner 傳 offset-aware：生成點 + getLevelOffsetX）。
   * @param members 綁定的敵人（長度應 <= slotOffsets；多退少補由呼叫端控）。
   */
  constructor(config: FormationConfig, anchor: Vec2, members: Enemy[]) {
    this.config = config;
    this.anchor = { x: anchor.x, y: anchor.y };
    this.slotOffsets = computeFormationSlots(config);
    this.members = this.slotOffsets.map((_, i) => members[i] ?? null);
    // 綁定：接管的成員設 formationControlled（EnemySpawner 不再呼其 e.update）。
    for (const m of this.members) if (m) m.setFormationControlled(true);
  }

  isDone(): boolean {
    return this.done;
  }

  /** 本幀某 slot 的節點世界座標（anchor + 偏移×PPU）。 */
  private nodeWorld(i: number): Vec2 {
    const off = this.slotOffsets[i];
    return { x: this.anchor.x + off.x * PPU, y: this.anchor.y + off.y * PPU };
  }

  /**
   * 每幀：推進 anchor（facing 直線 or spline）→ 驅動各存活成員 followFormationNode。
   * 死亡成員從該 slot 移除（解控、空出）；全員死/回收 → done。
   * @param dt 幀時間。
   */
  update(dt: number): void {
    if (this.done) return;
    // 1) 整隊 anchor 推進。
    const mv = this.config.move;
    if (mv) {
      const speedPx = mv.speedUnits * PPU;
      if (mv.spline && mv.spline.length >= 2) {
        // 沿 spline 推進：t 依速度/總長粗略前進（世界 px spline 點）。
        const totalLenPx = this.splineTotalLen(mv.spline);
        if (totalLenPx > 1) this.splineT = Math.min(1, this.splineT + (speedPx * dt) / totalLenPx);
        this.anchor = splinePoint(mv.spline, this.splineT);
      } else {
        this.anchor = advanceAnchor(this.anchor, this.config.facingDeg, speedPx, dt);
      }
    }
    // 2) 驅動存活成員跟節點走；死亡移除。
    let alive = 0;
    for (let i = 0; i < this.members.length; i += 1) {
      const m = this.members[i];
      if (!m) continue;
      if (m.isDead()) {
        m.setFormationControlled(false); // 解控（雖已死；保險）
        this.members[i] = null; // RemoveEnemy：空出該 slot
        continue;
      }
      alive += 1;
      m.followFormationNode(this.nodeWorld(i), dt); // spline 上的 maxSpeed 用預設
    }
    // 3) 全員死 → FormationEnd 回收。
    if (alive === 0) this.done = true;
  }

  /** spline 世界座標點總長（粗估：折線段和）。 */
  private splineTotalLen(pts: readonly Vec2[]): number {
    let len = 0;
    for (let i = 1; i < pts.length; i += 1) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return len;
  }

  /** 回收/清場：解控所有成員（回 chase）、標 done。clearAllEnemies/過關/走完呼此。 */
  destroy(): void {
    for (const m of this.members) if (m && !m.isDead()) m.setFormationControlled(false);
    this.done = true;
  }

  /** 存活成員數（debug/回收判定）。 */
  aliveCount(): number {
    return this.members.filter((m) => m !== null && !m.isDead()).length;
  }
}
