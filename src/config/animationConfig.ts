/**
 * 角色動畫設定（資料驅動）。
 *
 * 每個角色的每個動作對應一組逐幀 PNG：
 *   public/assets/images/characters/<角色>/<動作>/frame_NN.png
 * 檔名 2 位補零、0-indexed（frame_00 ~ frame_{count-1}），每張 256×256 透明。
 *
 * 之後要接其他角色（SunWukong / Enemy_Ranged / Enemy_Elite），
 * 只要在 CHARACTERS 加一筆即可，不用改動畫系統程式。
 */

/** 動畫狀態名。 */
export type AnimState = 'idle' | 'move' | 'attack' | 'damaged' | 'death';

/** 單一動作的設定。 */
export interface ActionDef {
  /** 幀數（frame_00 ~ frame_{frames-1}）。 */
  frames: number;
  /** 播放幀率。 */
  fps: number;
  /** 是否循環。 */
  loop: boolean;
}

/** 一個角色的所有動作設定。 */
export type CharacterDef = Record<AnimState, ActionDef>;

/** 幀圖原始尺寸（正方形畫布），用來換算縮放。 */
export const FRAME_SIZE = 256;

/**
 * 播放幀率規則：idle/move 循環 24fps；attack/death/damaged 一次性 24fps。
 *
 * 全角色所有動作幀數統一：idle12 / move8 / attack12 / damaged8 / death16。
 */
const A = (frames: number, fps = 24, loop = false): ActionDef => ({ frames, fps, loop });

export const CHARACTERS: Record<string, CharacterDef> = {
  Human: {
    idle: A(12, 24, true),
    move: A(8, 24, true),
    attack: A(12, 24, false),
    damaged: A(8, 24, false),
    death: A(16, 24, false),
  },
  Enemy_Rush: {
    idle: A(12, 24, true),
    move: A(8, 24, true),
    attack: A(12, 24, false),
    damaged: A(8, 24, false),
    death: A(16, 24, false),
  },
  SunWukong: {
    idle: A(12, 24, true),
    move: A(8, 24, true),
    attack: A(12, 24, false),
    damaged: A(8, 24, false),
    death: A(16, 24, false),
  },
  Enemy_Ranged: {
    idle: A(12, 24, true),
    move: A(8, 24, true),
    attack: A(12, 24, false),
    damaged: A(8, 24, false),
    death: A(16, 24, false),
  },
  Enemy_Elite: {
    idle: A(12, 24, true),
    move: A(8, 24, true),
    attack: A(12, 24, false),
    damaged: A(8, 24, false),
    death: A(16, 24, false),
  },
};

export const ALL_ANIM_STATES: readonly AnimState[] = [
  'idle',
  'move',
  'attack',
  'damaged',
  'death',
];

/**
 * 每角色顯示縮放倍率（default 1）。
 *
 * 因為每隻角色是各自 union bounds 烘進同一個 256² 畫布，世界尺寸大的角色
 * 在畫布裡反而被縮小，再套同一個 SPRITE_SCALE 就顯得偏小。
 * 這裡針對個別角色補償：finalScale = SPRITE_SCALE × PER_CHAR_SCALE[charKey]。
 *
 * 例：Enemy_Elite 世界尺寸大(viewH≈2.45 vs Human1.93) → 調大讓它像個大隻菁英。
 * （更正解是全角色統一 pixels-per-world-unit 重烘，之後要精準再處理。）
 */
export const PER_CHAR_SCALE: Record<string, number> = {
  Human: 1,
  SunWukong: 1,
  Enemy_Rush: 1,
  Enemy_Ranged: 1,
  Enemy_Elite: 1.5,
};

/** 取得某角色的顯示縮放倍率（未設定則 1）。 */
export function getPerCharScale(charKey: string): number {
  return PER_CHAR_SCALE[charKey] ?? 1;
}
