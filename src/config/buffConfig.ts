/**
 * buffConfig.ts — 計時增益/能力設定（對照 Unity 15fec2a4 + 零式暫定，標來源）。
 * 頭盔能力 + 寶盒坐騎/二段變身共用同一 buff 計時框架。
 */

/** buff / 能力 id。 */
export type BuffId =
  // 寶盒
  | 'mount' // 坐騎（寶盒，20s）
  | 'secondTransform' // 二段變身（寶盒，30s）
  // 頭盔能力
  | 'MoveSpeed'
  | 'Dash'
  | 'Shield'
  | 'Lightning'
  | 'Freeze';

/** 各 buff 持續秒數（零式暫定，待校準）。 */
export const BUFF_DURATION: Record<BuffId, number> = {
  mount: 20, // 寶盒坐騎
  secondTransform: 30, // 寶盒二段變身
  MoveSpeed: 8, // 頭盔預設 8s
  Dash: 8,
  Shield: 8,
  Lightning: 8,
  Freeze: 8,
};

// --- 效果數值（標來源） ---
/** 坐騎：衝刺速度倍率（零式暫定）。 */
export const MOUNT_DASH_SPEED_MULT = 1.5;
/** 坐騎：衝刺命中數 +N（範圍放大近似）。 */
export const MOUNT_DASH_EXTRA_HITS = 2;
/** 二段變身：傷害倍率（零式暫定）。 */
export const SECOND_TRANSFORM_DMG_MULT = 1.5;
/** 頭盔 MoveSpeed：移速倍率（Unity）。 */
export const HELMET_MOVESPEED_MULT = 1.5;
/** 頭盔 Dash：衝刺速度倍率（Unity）。 */
export const HELMET_DASH_SPEED_MULT = 1.5;
/** Lightning：主目標麻痺秒數。 */
export const LIGHTNING_PARALYZE_SEC = 1.5;
/** Lightning：連鎖數 / 範圍(unit) / 每隻傷害。 */
export const LIGHTNING_CHAIN_COUNT = 3;
export const LIGHTNING_CHAIN_RANGE = 3;
export const LIGHTNING_CHAIN_DAMAGE = 1;
/** Freeze：命中凍結敵人秒數。 */
export const FREEZE_SEC = 2;

/** 頭盔 sprite → 能力 對應（H5 用 debug 隨機選其一測試）。 */
export const HELMET_ABILITIES: readonly BuffId[] = [
  'MoveSpeed',
  'Dash',
  'Shield',
  'Lightning',
  'Freeze',
] as const;
