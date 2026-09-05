/**
 * hitFeelConfig — 打擊手感（hitFeel）參數（#搬自 Unity EnemyConfig hitFeel 一整套）。
 *
 * 集中成一份可被「hitFeel 編輯器」(第 2 步) import 讀寫（像 enemyConfig/skillConfig）。
 * 純視覺表演層參數（白閃/punch/火花/頓幀/死亡粒子）＋ 擊退曲線（Unity 快進快出）。
 * 顏色用 Phaser 0xRRGGBB；時間用秒；距離/力道以 unit（呼叫端 ×PPU 換像素）。
 */
export interface HitFeelConfig {
  /** 總開關：關掉則 takeHit/die 不播任何 juice（數值照常）。 */
  enabled: boolean;

  // --- 受擊白閃 ---
  /** 受擊瞬間整體染色（Unity hitFlashColor，預設白）。 */
  hitFlashColor: number;
  /** 白閃持續（秒，Unity hitFlashDuration 0.08）。 */
  hitFlashDuration: number;

  // --- punch 彈跳 ---
  /** 受擊瞬間 scale 彈跳量（Unity punchScale 0.35，快彈快回）。 */
  punchScale: number;

  // --- 命中火花 ---
  hitSparkEnabled: boolean;
  /** 火花顏色（Unity hitSparkColor 白黃 (1,0.95,0.5)）。 */
  hitSparkColor: number;

  // --- 局部頓幀（只凍被打那隻） ---
  /** 被打那隻 update early-return 的時間（秒，Unity microFreezeDuration 0.06）。 */
  microFreezeDuration: number;

  // --- 擊退（Unity 快進快出，取代舊即時 velocity+指數衰減） ---
  /** 擊退位移時長（秒，Unity knockbackDuration 0.18）。 */
  knockbackDuration: number;
  /** force → 實際距離的比例（Unity knockbackForceScale 0.15；實距 unit = force × 此）。 */
  knockbackForceScale: number;
  /** 擊退距離上限（unit，Unity knockbackDistance 1.5，clamp）。 */
  knockbackDistance: number;

  // --- 死亡粒子 ---
  /** 死亡爆散粒子顏色（Unity deathParticleColor 金黃 (1,0.85,0.3)）。 */
  deathParticleColor: number;
}

/** hitFeel 預設值（對齊 Unity EnemyConfig）。第 2 步編輯器可覆寫這些欄位。 */
export const HIT_FEEL: HitFeelConfig = {
  enabled: true,

  hitFlashColor: 0xffffff, // 白
  hitFlashDuration: 0.08,

  punchScale: 0.35,

  hitSparkEnabled: true,
  hitSparkColor: 0xfff2_80, // 白黃 (1,0.95,0.5)≈(255,242,128)

  microFreezeDuration: 0.06,

  knockbackDuration: 0.18,
  knockbackForceScale: 0.15,
  knockbackDistance: 1.5,

  deathParticleColor: 0xffd94d, // 金黃 (1,0.85,0.3)≈(255,217,77)
};

/**
 * 擊退實際距離（像素）：dist = clamp(force × forceScale, 0, maxDistance) × PPU。
 * 純函式：Unity 快進快出的「總位移量」計算（時長/曲線由呼叫端 tween 處理）。
 * @param force 攻擊的 knockback 力道（unit 級，來自玩家攻擊）。
 * @param ppu 每 unit 像素。
 * @param cfg hitFeel 參數（預設 HIT_FEEL）。
 * @returns 擊退位移距離（像素，已 clamp 到 knockbackDistance）。
 */
export function knockbackDistancePx(
  force: number,
  ppu: number,
  cfg: HitFeelConfig = HIT_FEEL,
): number {
  const distUnit = Math.min(Math.max(force * cfg.knockbackForceScale, 0), cfg.knockbackDistance);
  return distUnit * ppu;
}
