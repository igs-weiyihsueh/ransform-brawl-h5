/**
 * comboHudMath — 鬥氣連段 HUD 純顯示計算（零 Phaser，可測，交測騎）。
 *
 * ★純顯示層：只從 combo/teamLevel/門檻/解鎖等級算出「條填充比例、節點 px 定位、節點三態」，
 *   不碰連段邏輯/命中/body/位移。DouqiComboHud 讀這裡的結果畫 UI。
 */

/** 連段進度條填充比例（combo / maxCombo，夾 0~1）。 */
export function comboFillRatio(combo: number, maxCombo: number): number {
  if (maxCombo <= 0) return 0;
  return Math.max(0, Math.min(1, combo / maxCombo));
}

/**
 * 招式節點沿進度條的 x 座標（按門檻比例定位）：barX + (threshold/maxCombo)×barWidth。
 * @param barX 進度條左緣 x。
 * @param barWidth 進度條寬。
 * @param threshold 該招 combo 門檻（3/6/9/10）。
 * @param maxCombo 上限（10）。
 */
export function comboNodeX(barX: number, barWidth: number, threshold: number, maxCombo: number): number {
  const t = maxCombo <= 0 ? 0 : Math.max(0, Math.min(1, threshold / maxCombo));
  return barX + t * barWidth;
}

/** 節點三態（核心＝「待會放什麼招」預告，非文字）。 */
export type ComboNodeState = 'locked' | 'unlocked' | 'ready';

/**
 * 節點三態判定：
 *  - locked：teamLevel < unlockLevel（該招尚未解鎖）→ 灰。
 *  - unlocked：已解鎖但 combo < threshold（尚未爬到）→ 淡灰。
 *  - ready：已解鎖且 combo ≥ threshold（下次揮擊命中就放這招）→ 高亮 activeColor。
 * @param teamLevel 當前隊伍等級。
 * @param combo 當前 combo。
 * @param threshold 該招 combo 門檻。
 * @param unlockLevel 該招解鎖等級。
 */
export function comboNodeState(
  teamLevel: number,
  combo: number,
  threshold: number,
  unlockLevel: number,
): ComboNodeState {
  if (teamLevel < unlockLevel) return 'locked';
  if (combo < threshold) return 'unlocked';
  return 'ready';
}

/** 強化倒數文字（empowerRemainMs>0 顯示「強化 X.Xs」，否則空字串＝隱藏）。 */
export function empowerCountdownLabel(empowerRemainMs: number): string {
  if (empowerRemainMs <= 0) return '';
  return `強化 ${(empowerRemainMs / 1000).toFixed(1)}s`;
}
