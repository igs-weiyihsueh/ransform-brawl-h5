/**
 * secondTransformMath.ts — 二段變身能量條純函式（零 Phaser，抽給測騎 + TransformSystem 共用）。
 *
 * 玩法（用戶新大功能，型態 A＝沿用悟空、變大+強化）：
 *  - 前提：玩家已是「一段悟空變身」後才累積二段能量（isSecondTransformAvailable 由呼叫端 gate）。
 *  - 打怪累積：擊殺/命中 → energy += 增量（cap 1）。energy 達 fillThreshold → 自動觸發二段（active=true）。
 *  - 二段期間：energy 隨時間消退（decayPerSec）；退完（≤0）→ 解除二段（active=false）回一段悟空常態。
 *  - ratio 0~1（能量條填充，供界騎 UI）。
 *
 * 設計為不可變（回新 state），方便測試與推理；TransformSystem 每 pid 存一份 state。
 * ★feature flag（SECOND_TRANSFORM_CONFIG.enabled）由呼叫端 gate——關時完全不呼叫這些函式，行為 100% 不變。
 */

/** 二段變身能量狀態（每玩家一份）。 */
export interface SecondTransformState {
  /** 二段能量 0~1（累積打怪、二段期間隨時間消退）。 */
  energy: number;
  /** 是否在二段變身中（放大+強化）。 */
  active: boolean;
}

/** 建立初始狀態（能量 0、非二段）。 */
export function makeSecondTransformState(): SecondTransformState {
  return { energy: 0, active: false };
}

/** clamp 0~1。 */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 打怪累積二段能量。
 * - 已 active（二段中）：不累積（二段期間走消退，不因打怪再充；避免無限二段）。回原 state。
 * - 未 active：energy += amount（cap 1）；達 fillThreshold → 觸發二段（active=true，energy 保持滿）。
 * @param amount 本次累積量（>0；<=0 為 no-op）。
 * @param fillThreshold 觸發二段的能量閾值（通常 1.0）。
 */
export function accumulateSecondEnergy(
  state: SecondTransformState,
  amount: number,
  fillThreshold = 1,
): SecondTransformState {
  if (state.active) return state; // 二段中不再累積
  if (!(amount > 0)) return state;
  const energy = clamp01(state.energy + amount);
  if (energy >= fillThreshold) {
    return { energy: 1, active: true }; // 滿 → 觸發二段，能量條填滿
  }
  return { energy, active: false };
}

/**
 * 推進二段消退一幀。
 * - active（二段中）：energy -= decayPerSec×dt；≤0 → 解除二段（active=false, energy=0）回一段常態。
 * - 非 active：不變（未觸發二段的累積能量不隨時間掉；只有二段中才消退）。
 * @param dt 幀時間（秒，>=0）。
 * @param decayPerSec 二段每秒消退量（ratio/秒，>0）。
 */
export function decaySecondEnergy(
  state: SecondTransformState,
  dt: number,
  decayPerSec: number,
): SecondTransformState {
  if (!state.active) return state;
  if (dt <= 0 || decayPerSec <= 0) return state;
  const energy = state.energy - decayPerSec * dt;
  if (energy <= 0) {
    return { energy: 0, active: false }; // 退完 → 解除二段
  }
  return { energy, active: true };
}

/** 能量條填充比例 0~1（供界騎 UI）。 */
export function secondEnergyRatio(state: SecondTransformState): number {
  return clamp01(state.energy);
}

/**
 * 階段3：玩家被怪擊中 → 二段能量倒扣（純函式，clamp 下限 0）。
 * - ★能量為 0 → 不扣（clamp 0，回原 state，不會負）。
 * - active（二段中）被打：也扣能量；扣到 0 這裡不解除二段（消退由 decaySecondEnergy 管；本函式只管累積態的能量倒扣）。
 *   實務：二段中 energy 由 decay 管、通常滿→退；被打倒扣主要影響「累積中（未觸發二段）」的進度。保守只降 energy、不主動翻 active。
 * @param amount 倒扣量（>0；<=0 為 no-op）。
 * @returns 新 state（energy 下限 clamp 0）。
 */
export function loseSecondEnergy(
  state: SecondTransformState,
  amount: number,
): SecondTransformState {
  if (!(amount > 0)) return state; // 無效扣量 no-op
  if (state.energy <= 0) return state; // ★能量 0 不扣（不會負）
  const energy = Math.max(0, state.energy - amount);
  return { energy, active: state.active };
}

/** 是否在二段變身中。 */
export function isSecondActive(state: SecondTransformState): boolean {
  return state.active;
}
