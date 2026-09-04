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
 * 預設幀率規則：
 * - idle/move 循環：24fps
 * - attack/death/damaged 一次性：24fps
 *
 * 註：規格提到 Enemy_Rush/move 為 20 幀（POC 60fps 烘），但實際放進來的資料夾
 * 只有 8 幀（frame_00~07），故此處照「實際檔案數」設定；若之後補到 20 幀再調整。
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
  // SunWukong / Enemy_Ranged / Enemy_Elite 之後照樣補（圖已就位）。
};

export const ALL_ANIM_STATES: readonly AnimState[] = [
  'idle',
  'move',
  'attack',
  'damaged',
  'death',
];
