/**
 * 攻擊特效（VFX）設定 — 資料驅動。
 *
 * 每個特效對應一組逐幀 PNG：
 *   public/assets/images/vfx/<effectKey>/frame_NN.png
 * 之後要加新特效（attack_XX、招式、敵人技能特效），在 VFX_EFFECTS 加一筆
 * 並把 PNG 放進對應資料夾即可，EffectSystem 不用改。
 *
 * 註：VFX 幀圖為 1-indexed（frame_01 起），與角色動畫（0-indexed）不同，
 *     故用 startIndex 明確標示；padding 為 2 位。
 */

export interface VFXEffectDef {
  /** 幀數。 */
  frames: number;
  /** 起始幀編號（attack_03 為 1 → frame_01..frame_08）。 */
  startIndex: number;
  /** 播放幀率。Unity AttackEffectPlayer fps≈20。 */
  fps: number;
  /** 顯示縮放（相對原圖）。可調到對齊攻擊範圍感。 */
  scale: number;
  /** 深度/排序（Phaser depth）。Unity sortingOrder 55 → 特效在角色上層。 */
  depth: number;
}

/** 幀檔名 padding 位數。 */
export const VFX_FRAME_PAD = 2;

export const VFX_EFFECTS: Record<string, VFXEffectDef> = {
  // 玩家普攻斬擊（Unity Attack03：fps20 / sortingOrder55）。原圖 473×212。
  attack_03: {
    frames: 8,
    startIndex: 1,
    fps: 20,
    scale: 1,
    depth: 55,
  },
  // 招式/普攻 VFX（皆 Unity fps20 / sortingOrder55、1-indexed）。
  attack_01: { frames: 10, startIndex: 1, fps: 20, scale: 1, depth: 55 }, // 凡人 skill1
  attack_04: { frames: 6, startIndex: 1, fps: 20, scale: 1, depth: 55 }, // 悟空 normalAttack
  attack_08: { frames: 13, startIndex: 1, fps: 20, scale: 1, depth: 55 }, // 悟空 skill1
  attack_09: { frames: 7, startIndex: 1, fps: 20, scale: 1, depth: 55 }, // 悟空 skill2
  attack_10: { frames: 8, startIndex: 1, fps: 20, scale: 1, depth: 55 }, // 悟空 ultimate
};
