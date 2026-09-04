/**
 * jpConfig.ts — JP 累積獎池系統設定（零式定案，決策 924a1d83）。
 * 三組：紅/藍/紫，各 5 燈集滿觸發、各自累積倍數池。
 */

export type JpGroup = 'red' | 'blue' | 'purple';
export const JP_GROUPS: readonly JpGroup[] = ['red', 'blue', 'purple'] as const;

/** 集滿觸發的燈數。 */
export const JP_LIGHTS_TO_TRIGGER = 5;

/** 派彩票面：獎金 = 當前倍數 × 此張數。 */
export const JP_TICKET_FACE = 30;

/**
 * 平均出獎局數（幣）：一局約此幣數從起始倍數漲到平均出獎倍數。
 * 1 幣 = 10 Credit 消耗。用於推每幣累積步進。
 */
export const JP_AVG_COINS_PER_ROUND = 450;

/** 1 幣 = 多少 Credit 消耗（用於把 Credit 消耗換算成幣數）。 */
export const CREDIT_PER_COIN = 10;

export interface JpGroupConfig {
  /** 起始倍數。 */
  startMultiplier: number;
  /** 封頂倍數（clamp）。 */
  capMultiplier: number;
  /** 平均出獎倍數（決定每幣累積步進：(avg-start)/avgCoins）。 */
  avgPayoutMultiplier: number;
}

/**
 * 三組數值（零式）：
 * 紅 5→30 平均15.75；藍 10→50 平均22.5；紫 20→80 平均29.25。
 * 累積率＝平均出獎倍數/450幣＝Buffer佔比（紅3.5%/藍5%/紫6.5%），
 * 這裡用「每幣累積 = (avg-start)/450」達成「約 450 幣從起始漲到平均」。
 */
export const JP_GROUP_CONFIG: Record<JpGroup, JpGroupConfig> = {
  red: { startMultiplier: 5, capMultiplier: 30, avgPayoutMultiplier: 15.75 },
  blue: { startMultiplier: 10, capMultiplier: 50, avgPayoutMultiplier: 22.5 },
  purple: { startMultiplier: 20, capMultiplier: 80, avgPayoutMultiplier: 29.25 },
};

/** 每「幣」該組倍數累積步進 = (平均出獎倍數 - 起始) / 平均出獎局數(450幣)。 */
export function multiplierStepPerCoin(group: JpGroup): number {
  const c = JP_GROUP_CONFIG[group];
  return (c.avgPayoutMultiplier - c.startMultiplier) / JP_AVG_COINS_PER_ROUND;
}

/**
 * BOSS 挑戰閘門：規格為「集滿→打該組 BOSS→贏才給」。H5 無 BOSS，
 * 先 false = 集滿直接派彩（跳過 BOSS 戰）；B 段做 BOSS 再改 true。
 */
export const JP_BOSS_GATED = false;

/** 每幕通關隨機給一組 +1 燈：三組均等機率（各 1/3）。 */
export function pickLightGroup(rng: () => number = Math.random): JpGroup {
  const i = Math.min(JP_GROUPS.length - 1, Math.floor(rng() * JP_GROUPS.length));
  return JP_GROUPS[i];
}
