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

interface EnergyState {
  charge: number;
  ready: boolean;
  cycleIndex: number;
}

/**
 * EnergySystem — 能量充能 + 放招決策（多人遷移 S3：per-player keying）。
 *
 * 每玩家一份能量狀態（Map<playerId>）。S3 仍只有 P1（id=0），Map 一筆＝退化成舊單一 state。
 * 模式依「該 playerId 對應的 player 角色」決定（HumanSimple/Full）。公開 API 加 playerId。
 * 充能：普攻命中才 +1（打空氣/招式命中不充；一次攻擊最多 +1）。
 */
export class EnergySystem implements GameSystem {
  readonly name = 'EnergySystem';
  private ctx!: GameContext;

  private states = new Map<number, EnergyState>();

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.states.clear();
  }

  private stateOf(playerId: number): EnergyState {
    let s = this.states.get(playerId);
    if (!s) {
      s = { charge: 0, ready: false, cycleIndex: 0 };
      this.states.set(playerId, s);
    }
    return s;
  }

  update(_dt: number): void {
    // ready 由 charge 是否達上限決定（角色可能中途切換，以當前 profile 重算）。
    for (const [playerId, s] of this.states) {
      s.ready = s.charge >= this.profileOf(playerId).energyCap;
    }
  }

  /** 依 playerId 找該玩家，取其角色戰鬥設定（角色可用 T 切換，故每次讀取）。 */
  private profileOf(playerId: number): CharacterCombatProfile {
    const p = this.ctx.players.find((pl) => pl.playerId === playerId) ?? this.ctx.player;
    return getCombatProfile(p.getCharacterKey());
  }

  /**
   * 攻擊鍵按下時呼叫：決定這次是普攻還是放招。
   * ready → 放招（依模式挑招、消耗 ready：充能歸 0、Full 循環前進）；否則普攻。
   */
  resolveAttackIntent(playerId: number): AttackIntent {
    const profile = this.profileOf(playerId);
    const s = this.stateOf(playerId);
    const mult = profile.damageMultiplier;

    if (s.ready) {
      const skill = this.pickSkill(profile, s.cycleIndex);
      s.charge = 0;
      s.ready = false;
      if (profile.mode === 'Full') {
        s.cycleIndex = (s.cycleIndex + 1) % FULL_SKILL_CYCLE.length;
      }
      return { attack: skill, multiplier: mult, isSkill: true };
    }
    return { attack: profile.skills.normalAttack, multiplier: mult, isSkill: false };
  }

  /** 依模式挑這次要放的招。 */
  private pickSkill(profile: CharacterCombatProfile, cycleIndex: number): AttackData {
    if (profile.mode === 'HumanSimple') {
      return profile.skills.skill1; // 凡人永遠 skill1
    }
    const key = FULL_SKILL_CYCLE[cycleIndex];
    return profile.skills[key];
  }

  /**
   * 命中結算後回報：普攻打到人才 +1（招式命中不充；一次攻擊最多 +1）。
   */
  reportHit(playerId: number, isSkill: boolean, hitAny: boolean): void {
    if (isSkill || !hitAny) return;
    const s = this.stateOf(playerId);
    const cap = this.profileOf(playerId).energyCap;
    s.charge = Math.min(cap, s.charge + 1);
    s.ready = s.charge >= cap;
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
  getEnergy(playerId: number): number {
    return this.stateOf(playerId).charge;
  }

  getMax(playerId: number): number {
    return this.profileOf(playerId).energyCap;
  }

  isReady(playerId: number): boolean {
    return this.stateOf(playerId).ready;
  }
}
