import type { EditorTabDef } from '@/systems/editorOverlay/editorMount';

/**
 * editorTabs.ts — 遊戲內 overlay 的編輯器 tab 註冊表（方案 A'）。
 *
 * 各 tab 用動態 import() lazy 載對應編輯器模組（維持隔離 bundle：遊戲主 bundle 不含編輯器 code，
 * 點開該 tab 才動態載）。編輯器模組須 export `mount(container): { unmount() }`（EditorMountFn）。
 *
 * 打樣階段先只掛 enemy-editor（翼騎沒在動、穩定）。方向確認後其餘編輯器
 * (ui/level/skill/dash/event/hitfeel) 照樣 mount 化 + 在此加 tab。
 */
export const EDITOR_TABS: readonly EditorTabDef[] = [
  {
    id: 'enemy',
    label: '怪物編輯器',
    loader: () => import('../../../enemy-editor/main'),
  },
  {
    id: 'ui',
    label: 'UI 編輯器',
    loader: () => import('../../../ui-editor/main'),
  },
  {
    id: 'level',
    label: '關卡編輯器',
    loader: () => import('../../../editor/main'),
  },
  {
    id: 'skill',
    label: '招式編輯器',
    loader: () => import('../../../skill-editor/main'),
  },
  {
    id: 'dash',
    label: '衝刺編輯器',
    loader: () => import('../../../dash-editor/main'),
  },
  {
    id: 'event',
    label: '事件編輯器',
    loader: () => import('../../../event-editor/main'),
  },
  {
    id: 'hitfeel',
    label: '打擊感編輯器',
    loader: () => import('../../../hitfeel-editor/main'),
  },
];
