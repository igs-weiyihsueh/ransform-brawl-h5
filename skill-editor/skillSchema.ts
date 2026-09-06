/**
 * skill-editor/skillSchema.ts — 相容 re-export（skills JSON 化後 schema 移到 src/config 單一真相）。
 *
 * 六輪 skills JSON 化：schema/validate 移到 src/config/skillSchema.ts（遊戲讀取端 + 編輯器共用單一真相，
 * 對齊 enemySchema/uiLayoutSchema 模式）。本檔保留為相容層（既有 import './skillSchema' 不需改路徑）。
 */
export * from '@/config/skillSchema';
