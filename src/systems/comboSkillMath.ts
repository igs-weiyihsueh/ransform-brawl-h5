/**
 * comboSkillMath — 鬥氣連段技純幾何/判定邏輯（階段 2）。零 Phaser、可測。交測騎。
 *
 * 連段技命中＝一次性 AOE（觸發幀對全場可傷怪結算一次）：
 *  - 圓形斬：距離 ≤ radius。
 *  - 直線氣波：pointInOrientedRect（朝 aimAngle 的矩形，玩家為底邊中心向前延伸 length、半寬 width/2）。
 */

/** 點是否在圓內（距離 ≤ radius）。 */
export function pointInCircle(px: number, py: number, cx: number, cy: number, radius: number): boolean {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * 點是否在「有向矩形」內（直線氣波貫穿判定）。
 * 矩形：從 origin 沿 angle 方向延伸 length（前向），垂直方向半寬 halfWidth（兩側）。
 *   ＝把點投影到「前向軸」(0..length) 與「側向軸」(|.| ≤ halfWidth)。
 * @param px,py 待測點（敵人中心）。
 * @param ox,oy 矩形起點（玩家位置，矩形底邊中心）。
 * @param angle 前向角（弧度，aimAngle）。
 * @param length 前向長度。
 * @param halfWidth 側向半寬（＝ width/2）。
 */
export function pointInOrientedRect(
  px: number,
  py: number,
  ox: number,
  oy: number,
  angle: number,
  length: number,
  halfWidth: number,
): boolean {
  const dx = px - ox;
  const dy = py - oy;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const forward = dx * cos + dy * sin; // 前向投影
  const lateral = -dx * sin + dy * cos; // 側向投影
  return forward >= 0 && forward <= length && Math.abs(lateral) <= halfWidth;
}

/**
 * combo 累積 +1（普攻揮擊命中呼）：★無時間衰減。上限 maxCombo（達上限維持、不自動歸零）——
 *   歸零由「滿連段強化(empower)觸發後 spirit 歸零」處理（達 max→觸發 empower→呼叫端 reset 到 0）。
 * @returns 新 combo 值（cap 在 maxCombo）。
 */
export function bumpCombo(current: number, maxCombo: number): number {
  return Math.min(current + 1, maxCombo);
}

/** 門檻+等級雙條件：combo ≥ threshold 且 teamLevel ≥ unlockLevel 才觸發。 */
export function comboSkillReady(combo: number, teamLevel: number, threshold: number, unlockLevel: number): boolean {
  return combo >= threshold && teamLevel >= unlockLevel;
}
