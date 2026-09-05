/**
 * aiConfig.ts — AI 玩家設定（移植 Unity AIController 參數，決策 8fb9c890）。
 * 單位為 Unity world unit；判定/距離時 ×PPU。
 */
export const AI_CONFIG = {
  /** 攻擊態進入距離（unit）：dist<=此值進攻擊態。 */
  attackRange: 1.2,
  /** 攻擊態遲滯（Schmitt）：dist>attackRange+此值才回追擊態。 */
  attackRangeHysteresis: 0.3,
  /** 攻擊間隔（秒）。 */
  attackInterval: 0.6,
  /** 目標黏著：新目標要比當前近超過此值(unit)才換。 */
  targetSwitchMargin: 1.0,
} as const;
