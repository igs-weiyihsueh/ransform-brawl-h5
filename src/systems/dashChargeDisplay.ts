/**
 * dashChargeDisplay — 衝刺充能「衝」圖示冷卻壓黑動畫的純幾何/邏輯（可測）。
 * ⚠️ 純視覺；讀 ctx 衝刺接口（getDashCharges/getDashMaxCharges/getDashCooldownProgress），不回寫核心。
 */

/** 圓周總角度（弧度）。 */
export const TWO_PI = Math.PI * 2;

/**
 * 冷卻壓黑遮罩的「剩餘壓黑」掃掠角度（弧度，純函式，可測）。
 * cooldownProgress：0=全壓黑(整圈)、1=壓黑消完(0)。→ 剩餘壓黑 = (1-progress) 整圈。
 */
export function darkSweepAngle(cooldownProgress: number): number {
  const p = Math.min(1, Math.max(0, cooldownProgress));
  return (1 - p) * TWO_PI;
}

/**
 * 逆時針徑向填回：壓黑楔形的起訖角（弧度）。
 * 從正上方（-90°）起，壓黑往「逆時針」方向縮小消去 → 亮的部分逆時針長回來。
 * Phaser Graphics.arc 預設順時針掃（clockwise=true）；要逆時針消去壓黑，
 * 壓黑楔形本身用「順時針掃剩餘壓黑角」呈現，起點隨 progress 從 -90° 往順時針退，
 * 使「亮起」的邊界看起來逆時針推進。回傳 { startAngle, endAngle, anticlockwise } 供 arc()。
 *
 * 實作：壓黑 = 從 startTop(-90°) 起、順時針掃 darkSweepAngle 的楔形；
 * progress 增大 → sweep 減小 → 壓黑從「另一側（逆時針方向）」收回。
 */
export function darkWedgeArc(cooldownProgress: number): {
  startAngle: number;
  endAngle: number;
  anticlockwise: boolean;
} {
  const startTop = -Math.PI / 2; // 正上方
  const sweep = darkSweepAngle(cooldownProgress);
  // 逆時針消去：壓黑楔形以「逆時針(anticlockwise)」從正上方掃剩餘角度，
  // progress↑ → sweep↓ → 壓黑邊界沿逆時針退回，亮面逆時針長回。
  return { startAngle: startTop, endAngle: startTop - sweep, anticlockwise: true };
}

/** 是否正在冷卻回充（charges < max 表示至少一格在回充）。 */
export function isDashRecharging(charges: number, max: number): boolean {
  return charges < max;
}
