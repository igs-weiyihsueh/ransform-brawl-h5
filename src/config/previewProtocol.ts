import type { LevelsFile } from './levelSchema';

/**
 * previewProtocol.ts — 編輯器⇄遊戲「試玩」的共用訊息協定。
 *
 * 零 Phaser / 零遊戲 runtime 依賴（只 import type levelSchema），
 * 供遊戲端與編輯器端（波騎）雙方 import，作為唯一的協定真相來源。
 * 傳輸機制：iframe + window.postMessage；交握：遊戲 boot 後送 preview-ready。
 */

/** 遊戲頁進入試玩模式的 URL query flag（?preview=1）。 */
export const PREVIEW_QUERY_FLAG = 'preview';

/** 遊戲 → 編輯器：boot 完成、回報自己的 schema 版本，準備接收關卡。 */
export interface PreviewReadyMessage {
  type: 'preview-ready';
  schemaVersion: number;
}

/** 編輯器 → 遊戲：一份（編輯器端已驗過的）關卡資料。 */
export interface PreviewLevelsMessage {
  type: 'preview-levels';
  payload: LevelsFile;
}

/** 遊戲 → 編輯器：收到的關卡在遊戲端驗不過，逐條原因。 */
export interface PreviewErrorMessage {
  type: 'preview-error';
  reason: string;
}

/** 三種協定訊息的聯集。 */
export type PreviewMessage =
  | PreviewReadyMessage
  | PreviewLevelsMessage
  | PreviewErrorMessage;

/** 訊息 type 字串常數（避免魔術字串散落）。 */
export const PREVIEW_MSG = {
  ready: 'preview-ready',
  levels: 'preview-levels',
  error: 'preview-error',
} as const;
