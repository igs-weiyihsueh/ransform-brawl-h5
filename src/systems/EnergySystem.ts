import { GLOBAL_CHARACTER_SCALE } from '@/config/combatConfig';
import {
  FULL_SKILL_CYCLE,
  getCombatProfile,
  type CharacterCombatProfile,
} from '@/config/skillConfig';
import type { AttackData } from '@/systems/AttackData';
import type { GameContext } from '@/systems/GameContext';
import type { GameSystem } from '@/systems/GameSystem';

/** 一次攻擊意圖的結算：用哪組 AttackData、倍率、是否為招式。 */
export interface AttackIntent {
  attack: AttackData;
  multiplier: number;
  isSkill: boolean;
}

/**
 * EnergySystem — 能量充能 + 放招決策（對照 Unity 決策 15fec2a4）。
 *
 * 充能：普攻「命中敵人」才 +1（打空氣不充；一次攻擊最多 +1；招式命中不充）。
 * 模式（依當前角色）：
 *  - HumanSimple（凡人）：命中計數到 energyCap → ready；放招永遠 skill1；放完歸 0 重累。
 *  - Full（悟空）：能量條集到 energyCap → ready；放招循環 skill1→skill2→ultimate(index%3)。
 * 觸發：沒有獨立招式鍵。ready 時「下一次攻擊鍵按下」變放招（消耗那次按鍵）；否則普攻。
 *
 * 與 PlayerControlSystem 的協定：
 *  - 攻擊鍵按下 → resolveAttackIntent() 取這次要用的 AttackData/倍率/isSkill（會消耗 ready）。
 *  - 命中結算後 → reportHit(isSkill, hitAny) 回報，普攻打到人才充能。
 * UI（能量條）：getEnergy()/getMax()/isReady()。
 */
export class EnergySystem implements GameSystem {
  readonly name = 'EnergySystem';
  private ctx!: GameContext;

  /** 目前充能值。 */
  private charge = 0;
  /** 是否已達可放招。 */
  private ready = false;
  /** Full 模式放招循環索引。 */
  private cycleIndex = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
  }

  update(_dt: number): void {
    // 能量狀態由攻擊事件驅動（resolveAttackIntent/reportHit），每幀不需輪詢。
    // ready 由 charge 是否達上限決定（角色可能中途切換，這裡以當前 profile 重算）。
    this.ready = this.charge >= this.currentProfile().energyCap;
  }

  /** 當前角色的戰鬥設定（角色可用 T 切換，故每次讀取）。 */
  private currentProfile(): CharacterCombatProfile {
    return getCombatProfile(this.ctx.player.getCharacterKey());
  }

  /**
   * 攻擊鍵按下時呼叫：決定這次是普攻還是放招。
   * ready → 放招（依模式挑招、消耗 ready：充能歸 0、Full 循環前進）；否則普攻。
   */
  resolveAttackIntent(): AttackIntent {
    const profile = this.currentProfile();
    const mult = profile.damageMultiplier;

    if (this.ready) {
      const skill = this.pickSkill(profile);
      // 消耗：歸 0、Full 循環前進、ready 清掉。
      this.charge = 0;
      this.ready = false;
      if (profile.mode === 'Full') {
        this.cycleIndex = (this.cycleIndex + 1) % FULL_SKILL_CYCLE.length;
      }
      return { attack: skill, multiplier: mult, isSkill: true };
    }
    return { attack: profile.skills.normalAttack, multiplier: mult, isSkill: false };
  }

  /** 依模式挑這次要放的招。 */
  private pickSkill(profile: CharacterCombatProfile): AttackData {
    if (profile.mode === 'HumanSimple') {
      return profile.skills.skill1; // 凡人永遠 skill1
    }
    // Full：依循環索引挑（在消耗前用當前 index）。
    const key = FULL_SKILL_CYCLE[this.cycleIndex];
    return profile.skills[key];
  }

  /**
   * 命中結算後回報：普攻打到人才 +1（招式命中不充；一次攻擊最多 +1）。
   * @param isSkill 這次攻擊是否為招式。
   * @param hitAny 這次攻擊是否命中任一敵人。
   */
  reportHit(isSkill: boolean, hitAny: boolean): void {
    if (isSkill || !hitAny) return;
    const cap = this.currentProfile().energyCap;
    this.charge = Math.min(cap, this.charge + 1);
    this.ready = this.charge >= cap;
  }

  /** 傷害倍率換算：finalDmg = max(1, round(base × mult))。 */
  static applyMultiplier(baseDamage: number, mult: number): number {
    return Math.max(1, Math.round(baseDamage * mult));
  }

  /** 角色 scale（供 PlayerControl 建判定用；集中一處）。 */
  getAttackScale(): number {
    return GLOBAL_CHARACTER_SCALE;
  }

  // --- UI 讀取（能量條） ---
  /** 目前充能格數。 */
  getEnergy(): number {
    return this.charge;
  }

  /** 充能上限（格數）。 */
  getMax(): number {
    return this.currentProfile().energyCap;
  }

  /** 是否可放招（滿格）。 */
  isReady(): boolean {
    return this.ready;
  }
}
