import Phaser from 'phaser';
import { BulletShooter } from '@/systems/BulletShooter';
import type { Projectile } from '@/systems/Projectile';
import type { EnemySkillDef, SkillPhaseDef } from '@/config/enemySkillSchema';
import type { Vec2 } from '@/systems/hitDetection';

/**
 * EnemySkillRunner — 技能三層「頂層」：管一份 Skill 的 Phase 觸發（延遲/機率）+ 冷卻，產出子彈。
 * 怪物 AI 移植第 1 塊（鬥破規格第 7 節）。
 *
 * ★第 1 塊一般怪單招：1 Phase、delay 0、probability 1 → 觸發即立刻發射（行為對齊現況單顆直線）。
 *   Boss 多 Phase 連段（各自 delay/機率/shooter）之後擴充，介面不改。
 * ★三契約：
 *  1) offset-aware：origin/aim 由呼叫端傳世界座標（敵人已 offset）。
 *  2) 命中不在此：只透過 BulletShooter 產 Projectile（命中沿用 Projectile 既有 circleIntersectsCircle）。
 *  3) 生命週期：產出的 Projectile 交呼叫端 registry；本 runner 只管觸發時序，無漂浮狀態（清場時整個丟棄即可）。
 *
 * 冷卻：本 runner 提供 cooldown gate（canFire）給呼叫端查，但實際發射時序仍由呼叫端（敵人 AI/EnemySpawner）決定
 *   —第 1 塊沿用敵人 FSM 的 charge/attackCooldown 時序，不重複 gate（避免雙重冷卻）。cooldownSec 供 Boss 之後自管。
 */
export class EnemySkillRunner {
  private readonly def: EnemySkillDef;
  /** 每個 Phase 一個 shooter（延遲齊發用 shooter.tick）。 */
  private readonly shooters: BulletShooter[];
  /** 進行中的 Phase 排隊（delay 未到）：index 對應 phases。 */
  private pending: { phaseIndex: number; delaySec: number; origin: Vec2; aim: Vec2 }[] = [];
  private cooldownRemaining = 0;

  constructor(scene: Phaser.Scene, def: EnemySkillDef) {
    this.def = def;
    this.shooters = def.phases.map((ph) => new BulletShooter(scene, ph.shooter));
  }

  /** 冷卻是否就緒（Boss 自管冷卻用；第 1 塊沿用 FSM 時序可不查）。 */
  canFire(): boolean {
    return this.cooldownRemaining <= 0;
  }

  /**
   * 觸發技能：各 Phase 依 delaySec/probability 決定發射。delay 0 的 Phase 立即發、其餘排隊（tick 收）。
   * @param origin 發射點（世界 px；敵人 body 中心）。
   * @param aim 瞄準方向（朝目標）。
   * @param sourceLabel debug 來源。
   * @param rng 機率源（可注入，測試用；預設 Math.random）。
   * @returns 立即生成的子彈。
   */
  trigger(origin: Vec2, aim: Vec2, sourceLabel: string, rng: () => number = Math.random): Projectile[] {
    this.cooldownRemaining = this.def.cooldownSec;
    const immediate: Projectile[] = [];
    this.def.phases.forEach((ph, i) => {
      if (rng() > ph.probability) return; // 機率未中 → 此 Phase 不觸發
      if (ph.delaySec <= 0) {
        immediate.push(...this.shooters[i].fire(origin, aim, sourceLabel));
      } else {
        this.pending.push({ phaseIndex: i, delaySec: ph.delaySec, origin, aim });
      }
    });
    return immediate;
  }

  /**
   * 每幀推進：冷卻倒數 + 延遲 Phase 到期發射 + shooter 內部 interval 齊發。
   * @returns 本幀新生子彈（呼叫端 push 進 registry）。
   */
  tick(dt: number, sourceLabel: string): Projectile[] {
    if (this.cooldownRemaining > 0) this.cooldownRemaining -= dt;
    const due: Projectile[] = [];
    // 延遲 Phase 到期發射。
    if (this.pending.length > 0) {
      for (const p of this.pending) p.delaySec -= dt;
      const ready = this.pending.filter((p) => p.delaySec <= 0);
      for (const p of ready) due.push(...this.shooters[p.phaseIndex].fire(p.origin, p.aim, sourceLabel));
      this.pending = this.pending.filter((p) => p.delaySec > 0);
    }
    // shooter 內部 interval 齊發（多顆間隔）。
    for (const sh of this.shooters) if (sh.hasPending()) due.push(...sh.tick(dt));
    return due;
  }

  /** 是否還有排隊中的發射（延遲 Phase / shooter interval）；清場時可查。 */
  hasPending(): boolean {
    return this.pending.length > 0 || this.shooters.some((s) => s.hasPending());
  }

  /** Phase 數（debug）。 */
  phaseCount(): number {
    return this.def.phases.length;
  }

  /** 供測試/debug 讀 Phase 定義。 */
  getPhase(i: number): SkillPhaseDef | undefined {
    return this.def.phases[i];
  }
}
