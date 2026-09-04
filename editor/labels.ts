/**
 * editor/labels.ts — 編輯器顯示用中文對照（presentation，只有編輯器用）。
 *
 * 為何放這裡：levelSchema 是「純型別 + 驗證」的三方共用契約（遊戲 loader /
 * WaveSystem / 編輯器）。中文顯示 label 只有編輯器 UI 會用到，遊戲那兩方永遠不顯示，
 * 放進 schema 會讓 schema 變 UI 字串垃圾場。故顯示對照撤到編輯器側。
 *
 * 依賴方向：本檔 import schema 的 EnemyType/NodeType 型別當 key（編輯器 → schema
 * 單向依賴，允許）。型別單一來源仍在 schema；label 屬編輯器。
 *
 * ⚠️ 這些純顯示；**不影響 JSON 存的英文 enum 值**（存檔/匯出一律英文 key）。
 */
import type { EnemyType, NodeType } from '@/config/levelSchema';

/** 節點類型 → 中文。 */
export const NODE_TYPE_LABELS: Readonly<Record<NodeType, string>> = {
  Spawn: '刷怪',
  Reward: '獎勵',
  Event: '事件',
};

/** 敵種 → 中文。 */
export const ENEMY_TYPE_LABELS: Readonly<Record<EnemyType, string>> = {
  Enemy_Rush: '衝鋒兵',
  Enemy_Ranged: '遠程兵',
  Enemy_Elite: '菁英兵',
};

/** 節點類型顯示字串：「中文（英文enum）」，找不到就退回原值。 */
export function nodeTypeLabel(type: string): string {
  const zh = (NODE_TYPE_LABELS as Record<string, string>)[type];
  return zh ? `${zh}（${type}）` : type;
}

/** 敵種顯示字串：「中文（英文enum）」，找不到就退回原值。 */
export function enemyTypeLabel(type: string): string {
  const zh = (ENEMY_TYPE_LABELS as Record<string, string>)[type];
  return zh ? `${zh}（${type}）` : type;
}
