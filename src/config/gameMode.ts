/**
 * gameMode — 遊戲模式型別（鬥氣模式階段 0 骨架）。零依賴型別（比照 GameMode enum）。
 *
 * - 'normal'：現有《變身大亂鬥》模式（★預設，一個 byte 不動＝現況）。
 * - 'douqi'：鬥氣模式（海牛《鬥氣割草》戰鬥+關卡用我方素材重寫；階段 0 先沿用現有戰鬥/關卡佔位，階段 1+ 才填鬥氣邏輯）。
 */
export type GameMode = 'normal' | 'douqi';

/** ★預設模式＝normal＝現況（GameScene.init data 缺 gameMode 時、preview 皆用此）。 */
export const DEFAULT_GAME_MODE: GameMode = 'normal';

/** 收斂任意輸入為合法 GameMode（非 'douqi' 一律 normal＝安全預設現況）。 */
export function resolveGameMode(value: unknown): GameMode {
  return value === 'douqi' ? 'douqi' : 'normal';
}
