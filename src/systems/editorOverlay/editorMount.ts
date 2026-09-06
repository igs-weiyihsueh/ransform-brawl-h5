/**
 * editorMount.ts — 遊戲內展開編輯器的「掛載契約」（方案 A' 骨架，異靈確認方向）。
 *
 * 背景：現有 7 個編輯器是獨立 vite entry + 各自 index.html（獨佔整頁 DOM、固定 id、100vh CSS、
 * main.ts module 頂層立即執行）。要在遊戲頁「原生展開」（非 iframe、非新分頁），需把每個編輯器
 * 重構成「可掛載到指定容器」的函式：mount(container) 建 DOM+綁事件、unmount() 清掉。
 *
 * 本檔只定義契約（介面 + 註冊表），不含任何編輯器實作，零遊戲/零 Phaser 依賴 → 遊戲 bundle 不因此變大。
 * 各編輯器實作（enemy/ui/skill/...）改成 export 一個 EditorModule，由 EditorOverlay lazy import() 載入
 * （維持隔離 bundle：遊戲主 bundle 不含編輯器 code，點開才動態載）。
 *
 * 復用原則（★異靈定）：editorStore（localStorage 契約）+ 各 schema（validate/resolve）+ 現有 main.ts
 * 渲染/undo/canvas 預覽/波騎開啟回顯邏輯全部保留，只改「DOM scope（getElementById→container.querySelector）
 * + 掛載方式（頂層立即執行→收進 mount）」。
 */

/**
 * 單一編輯器的掛載介面。各編輯器把原 main.ts 的初始化收進 mount、清理收進 unmount。
 */
export interface EditorInstance {
  /** 卸載：移除事件監聽、清空容器 DOM、釋放資源（overlay 收合或切 tab 時呼叫）。 */
  unmount(): void;
}

/**
 * 編輯器模組契約：mount 到指定容器並回傳可卸載的 instance。
 * @param container overlay 分配給此編輯器的根容器（已加 .tb-editor-root 命名空間）。
 * @returns 可 unmount 的 instance。
 */
export type EditorMountFn = (container: HTMLElement) => EditorInstance;

/**
 * 編輯器在 overlay tab 列的描述 + lazy 載入器。
 * loader 用動態 import()（維持隔離 bundle），回傳該編輯器的 mount 函式。
 */
export interface EditorTabDef {
  /** 穩定 id（tab key / 對應 editorStore key 概念，勿與遊戲 DOM id 撞）。 */
  id: string;
  /** tab 顯示名（中文）。 */
  label: string;
  /** lazy 載入器：點開此 tab 才動態 import 對應編輯器模組。 */
  loader: () => Promise<{ mount: EditorMountFn }>;
}
