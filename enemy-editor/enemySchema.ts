/**
 * enemy-editor/enemySchema.ts — 相容 re-export（enemies JSON 化後 schema 移到 src/config 單一真相）。
 *
 * 六輪 enemies JSON 化：schema/validate 移到 src/config/enemySchema.ts（遊戲讀取端 + 編輯器共用單一真相，
 * 對齊 uiLayoutSchema 模式）。本檔保留為相容層（既有 import './enemySchema' 與測騎測試不需改路徑）。
 */
export * from '@/config/enemySchema';
