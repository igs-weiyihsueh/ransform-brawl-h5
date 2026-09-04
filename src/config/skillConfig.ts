import type { AttackData } from '@/systems/AttackData';

/**
 * skillConfig.ts — 角色招式與能量模式設定（資料驅動，對照 Unity 決策 15fec2a4）。
 *
 * 招式就是不同的 AttackData，跟普攻走同一套 hitDetection（只是換數值/形狀）。
 * 幾何數值為「未乘 scale」的 unit 值；判定時 × GLOBAL_CHARACTER_SCALE。
 */

/** 能量模式：凡人（命中計數→只放 skill1）或悟空（能量條→循環 skill1/2/ultimate）。 */
export type EnergyMode = 'HumanSimple' | 'Full';

/** 一個角色的四組攻擊資料。 */
export interface CharacterSkillSet {
  normalAttack: AttackData;
  skill1: AttackData;
  skill2: AttackData;
  ultimate: AttackData;
}

/** 角色能量/招式整體設定。 */
export interface CharacterCombatProfile {
  /** 能量模式。 */
  mode: EnergyMode;
  /** 充能上限（達到即 skillReady）：凡人 humanSkillInterval=4；悟空能量條 4 格。 */
  energyCap: number;
  /** 傷害倍率：凡人 0.5、變身後(悟空) 1.0。finalDmg = max(1, round(data.damage × mult))。 */
  damageMultiplier: number;
  /** 四組攻擊資料。 */
  skills: CharacterSkillSet;
}

// --- 凡人 Character_Human ---
const HUMAN_SKILLS: CharacterSkillSet = {
  normalAttack: {
    shapeType: 'rectangle',
    width: 0.8,
    length: 2,
    offsetX: 1.2,
    offsetY: 0.2,
    damage: 1,
    hitDelay: 0.1,
    knockback: 10,
    vfxKey: 'attack_03',
  },
  // skill1 落點衝擊：圓形
  skill1: {
    shapeType: 'circle',
    radius: 1,
    offsetX: 1,
    offsetY: 0.2,
    damage: 3,
    hitDelay: 0.2,
    knockback: 6,
    vfxKey: 'attack_01',
  },
  // skill2 旋風掃：圓形（凡人先不用，備用；Unity 為粒子特效，凡人永不觸發，借用 attack_09 當 fallback）
  skill2: {
    shapeType: 'circle',
    radius: 2,
    offsetX: 0,
    offsetY: 0.2,
    damage: 5,
    hitDelay: 0.1,
    knockback: 6,
    vfxKey: 'attack_09',
  },
  // ultimate 如意金箍棒：矩形（凡人先不用，備用；fallback attack_10）
  ultimate: {
    shapeType: 'rectangle',
    width: 2,
    length: 3,
    offsetX: 1.8,
    offsetY: 0.1,
    damage: 10,
    hitDelay: 0.1,
    knockback: 6,
    vfxKey: 'attack_10',
  },
};

// --- 悟空 Character_SunWukong ---
const SUNWUKONG_SKILLS: CharacterSkillSet = {
  normalAttack: {
    shapeType: 'rectangle',
    width: 0.5,
    length: 1.5,
    offsetX: 1,
    offsetY: 0.2,
    damage: 1,
    hitDelay: 0.1,
    knockback: 10,
    vfxKey: 'attack_04',
  },
  // skill1：扇形
  skill1: {
    shapeType: 'fan',
    radius: 1.5,
    angle: 160,
    offsetX: 0.2,
    offsetY: 0.2,
    damage: 3,
    hitDelay: 0.2,
    knockback: 6,
    vfxKey: 'attack_08',
  },
  skill2: {
    shapeType: 'circle',
    radius: 2,
    offsetX: 0,
    offsetY: 0.2,
    damage: 5,
    hitDelay: 0.1,
    knockback: 6,
    vfxKey: 'attack_09',
  },
  ultimate: {
    shapeType: 'rectangle',
    width: 2,
    length: 4,
    offsetX: 2,
    offsetY: 0.1,
    damage: 10,
    hitDelay: 0.1,
    knockback: 6,
    vfxKey: 'attack_10',
  },
};

/** 角色戰鬥設定表（key = 角色美術 key）。 */
export const CHARACTER_COMBAT: Record<string, CharacterCombatProfile> = {
  Human: {
    mode: 'HumanSimple',
    energyCap: 4, // humanSkillInterval
    damageMultiplier: 0.5,
    skills: HUMAN_SKILLS,
  },
  SunWukong: {
    mode: 'Full',
    energyCap: 4, // 能量條 4 格
    damageMultiplier: 1.0,
    skills: SUNWUKONG_SKILLS,
  },
};

/** 取得角色戰鬥設定（未知角色回 Human 當保險預設）。 */
export function getCombatProfile(charKey: string): CharacterCombatProfile {
  return CHARACTER_COMBAT[charKey] ?? CHARACTER_COMBAT.Human;
}

/** 悟空 Full 模式放招循環順序（index % 3）。 */
export const FULL_SKILL_CYCLE: readonly (keyof CharacterSkillSet)[] = [
  'skill1',
  'skill2',
  'ultimate',
] as const;
