/**
 * secondTransformDisplay — 二段變身能量條 UI 的純顯示決策（可測，無 Phaser 依賴）。
 * ⚠️ 純視覺層：讀 ctx 二段變身接口（getSecondTransformEnergyRatio / isSecondTransformActive /
 * isSecondTransformAvailable），只決定「顯不顯二段條 / 顯哪種樣式 / 用哪個 ratio」，不回寫核心。
 *
 * 用戶規格：一段悟空變身後（isSecondTransformAvailable）→ 魂力環位置改顯二段能量條
 * （打怪累積 getSecondTransformEnergyRatio）；未變身/flag 關 → 走現有魂力環（本檔回 show=false）。
 * feature flag 關時核心回 available=false / ratio=0 → 本函式 show=false，UI 完全走現有魂力環。
 */

/** 二段能量條呈現樣式。 */
export type SecondTransformStyle =
  | 'charging' // 累積中（一段悟空後打怪填充，ratio 往上）
  | 'active'; // 二段變身中（放大強化，ratio 隨時間消退往下）

/** 二段能量條顯示決策結果。 */
export interface SecondTransformDisplay {
  /** 是否顯示二段能量條（取代魂力環）。false → UI 走現有魂力環（soul/mash 不動）。 */
  show: boolean;
  /** 顯示時的填充比例（0..1，已夾限）。 */
  ratio: number;
  /** 顯示時的樣式（charging=累積色；active=二段中消退色/滿格特效）。 */
  style: SecondTransformStyle;
}

/** 夾限到 [0,1]。 */
function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 純決策：依二段變身三個接口值決定二段能量條顯示。
 *
 * @param available isSecondTransformAvailable(pid)：一段悟空後且 flag 開才 true（flag 關恆 false）。
 * @param active    isSecondTransformActive(pid)：二段變身中（放大強化）。
 * @param ratio     getSecondTransformEnergyRatio(pid)：能量條填充 0..1（flag 關回 0）。
 * @returns show/ratio/style。available=false → show=false（走現有魂力環，flag 關時現況不受影響）。
 */
export function resolveSecondTransformDisplay(
  available: boolean,
  active: boolean,
  ratio: number,
): SecondTransformDisplay {
  // flag 關 / 未到二段可累積階段 → 不顯二段條，交回現有魂力環邏輯。
  if (!available && !active) {
    return { show: false, ratio: 0, style: 'charging' };
  }
  return {
    show: true,
    ratio: clamp01(ratio),
    // 二段變身中 → active 樣式（消退/滿格特效）；否則累積中。
    style: active ? 'active' : 'charging',
  };
}
