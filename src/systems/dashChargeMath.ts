/**
 * dashChargeMath.ts — 衝刺「充能格」計時純函式（零 Phaser，抽給測騎 + PlayerControlSystem 共用）。
 *
 * 玩法（對齊 異靈 規格）：
 *  - 玩家有 maxCharges 格衝刺充能（預設 3），初始滿格。
 *  - 每次衝刺消耗 1 格；若消耗前是滿格，從該刻起開始跑冷卻計時（cooldownElapsed 從 0）。
 *  - 冷卻回充：cooldownElapsed 累加 dt，跑滿一圈 cooldownDuration → +1 格、餘量帶入下一格繼續（<max 時持續回充）。
 *  - 滿格（currentCharges === maxCharges）時不再累加、不超充（cooldownElapsed 歸 0）。
 *  - 冷卻進度 0→1（當前正在回充的那一格）：滿格時回 0；非滿格時 = cooldownElapsed / cooldownDuration。
 *    供 UI 逆時針壓黑動畫。
 *
 * 設計為不可變（回傳新 state），方便測試與推理；PlayerControlSystem 每 pid 存一份 state。
 */

/** 衝刺充能狀態（每玩家一份）。 */
export interface DashChargeState {
  /** 目前可用充能格數（0 ~ maxCharges）。 */
  currentCharges: number;
  /** 當前正在回充那一格已累積的冷卻時間（秒，0 ~ cooldownDuration）。滿格時為 0。 */
  cooldownElapsed: number;
}

/**
 * 建立初始滿格狀態。
 * @param maxCharges 最大充能格（預設 3）。
 */
export function makeDashChargeState(maxCharges = 3): DashChargeState {
  return { currentCharges: Math.max(0, Math.floor(maxCharges)), cooldownElapsed: 0 };
}

/** 目前是否可衝刺（有至少 1 格）。 */
export function canDash(state: DashChargeState): boolean {
  return state.currentCharges > 0;
}

/**
 * 消耗一格衝刺。
 * - 有格：currentCharges-1；若原本是滿格（開始出現缺口）→ cooldownElapsed 重置為 0（從此刻起跑冷卻）。
 *   若原本已非滿格（已有缺口在回充中）→ 保留 cooldownElapsed（不打斷正在跑的那一格冷卻）。
 * - 無格：不變。
 * @returns { state:新狀態, consumed:是否成功消耗 }。
 */
export function consumeDashCharge(
  state: DashChargeState,
  maxCharges = 3,
): { state: DashChargeState; consumed: boolean } {
  if (state.currentCharges <= 0) return { state, consumed: false };
  const wasFull = state.currentCharges >= maxCharges;
  const next: DashChargeState = {
    currentCharges: state.currentCharges - 1,
    // 從滿格掉下來才「重新起算」冷卻；已在回充中則不打斷。
    cooldownElapsed: wasFull ? 0 : state.cooldownElapsed,
  };
  return { state: next, consumed: true };
}

/**
 * 推進冷卻回充一幀。
 * - 滿格：cooldownElapsed 歸 0，不累加（不超充）。
 * - 非滿格：cooldownElapsed += dt；每跑滿 cooldownDuration → +1 格、餘量帶入；到滿格則停在 elapsed=0。
 * @param dt 幀時間（秒，>=0）。
 * @param maxCharges 最大格數。
 * @param cooldownDuration 每格回充所需時間（秒，>0）。
 */
export function tickDashCharge(
  state: DashChargeState,
  dt: number,
  maxCharges = 3,
  cooldownDuration = 1,
): DashChargeState {
  if (state.currentCharges >= maxCharges) {
    return state.cooldownElapsed === 0 ? state : { currentCharges: state.currentCharges, cooldownElapsed: 0 };
  }
  if (dt <= 0 || cooldownDuration <= 0) return state;

  let charges = state.currentCharges;
  let elapsed = state.cooldownElapsed + dt;
  // 一幀可能跨多格（極端 dt / 短 cooldown）。
  while (charges < maxCharges && elapsed >= cooldownDuration) {
    elapsed -= cooldownDuration;
    charges += 1;
  }
  // 補滿後不留餘量（不預充下一格，因為已滿）。
  if (charges >= maxCharges) elapsed = 0;
  return { currentCharges: charges, cooldownElapsed: elapsed };
}

/**
 * 當前正在回充那一格的進度 0~1（滿格回 0）。供界騎 UI 逆時針壓黑。
 * @param cooldownDuration 每格回充所需時間（秒，>0）。
 */
export function dashCooldownProgress(
  state: DashChargeState,
  maxCharges = 3,
  cooldownDuration = 1,
): number {
  if (state.currentCharges >= maxCharges) return 0;
  if (cooldownDuration <= 0) return 1;
  const p = state.cooldownElapsed / cooldownDuration;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
