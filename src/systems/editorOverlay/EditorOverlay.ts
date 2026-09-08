import type { EditorInstance, EditorTabDef } from '@/systems/editorOverlay/editorMount';
import { exportAllSettings, exportSettingsFilename, importAllSettings } from '@/config/editorStore';

/**
 * EditorOverlay — 遊戲內展開編輯器的 overlay 殼（方案 A' 骨架）。
 *
 * 職責：遊戲頁右下角浮動鈕 → 點開全螢幕 overlay（遊戲之上）→ tab 列切換各編輯器 →
 * 選 tab 時 lazy import() 對應編輯器模組 + mount 到分配容器 → 關閉時 unmount + 可選 soft-reload。
 *
 * 隔離：CSS 全部命名空間在 .tb-editor-overlay / .tb-editor-root 下，不污染遊戲頁樣式；
 * 編輯器 code 走動態 import()（遊戲主 bundle 不含編輯器）。
 *
 * 即時生效策略（三決策②待用戶定，先做「收合 reload」保底）：關閉 overlay 時若編輯器有套用過
 * override（applyToGame 寫了 localStorage），呼叫 onClose 回呼讓遊戲決定重載（soft-reload 場景 or location.reload）。
 * 之後若用戶要「真即時」，再在此加 override 快取 invalidate 鉤子（不影響本殼結構）。
 */
export class EditorOverlay {
  private readonly tabs: readonly EditorTabDef[];
  private readonly onClose: (() => void) | undefined;

  private root: HTMLDivElement | null = null;
  private overlayEl: HTMLDivElement | null = null;
  private editorHost: HTMLDivElement | null = null;
  private tabBar: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;

  private activeTabId: string | null = null;
  private activeInstance: EditorInstance | null = null;
  private open = false;
  private styleInjected = false;

  /**
   * @param tabs 編輯器 tab 定義（id/label/lazy loader）。
   * @param onClose overlay 關閉時回呼（遊戲決定是否 soft-reload 讀新 override）。
   */
  constructor(tabs: readonly EditorTabDef[], onClose?: () => void) {
    this.tabs = tabs;
    this.onClose = onClose;
  }

  /** 掛到遊戲頁（建浮動鈕 + 樣式）。呼叫一次即可（一般在遊戲 main.ts boot 後）。 */
  attach(parent: HTMLElement = document.body): void {
    if (this.root) return; // 已掛載
    this.injectStyle();

    const root = document.createElement('div');
    root.className = 'tb-editor-overlay';

    const btn = document.createElement('button');
    btn.className = 'tb-editor-entry-btn';
    btn.type = 'button';
    btn.textContent = '⚙ 編輯器';
    btn.addEventListener('click', () => this.openOverlay());

    root.appendChild(btn);
    parent.appendChild(root);
    this.root = root;
  }

  /** 展開 overlay（首次建 DOM，之後顯示）。 */
  openOverlay(): void {
    if (!this.root) this.attach();
    if (!this.overlayEl) this.buildOverlay();
    if (!this.overlayEl) return;
    this.overlayEl.style.display = 'flex';
    this.open = true;
    // 首次展開預設載第一個 tab。
    if (!this.activeTabId && this.tabs.length > 0) {
      void this.selectTab(this.tabs[0].id);
    }
  }

  /** 收合 overlay：unmount 當前編輯器、隱藏、觸發 onClose（遊戲決定重載）。 */
  closeOverlay(): void {
    if (!this.open) return;
    this.unmountActive();
    if (this.overlayEl) this.overlayEl.style.display = 'none';
    this.open = false;
    this.onClose?.();
  }

  /** 是否展開中（查詢/測試用）。 */
  isOpen(): boolean {
    return this.open;
  }

  /** 目前 tab id（查詢/測試用）。 */
  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  // --- 內部 ---

  private buildOverlay(): void {
    if (!this.root) return;

    const overlay = document.createElement('div');
    overlay.className = 'tb-editor-panel';

    // 頂列：tab 列 + 關閉鈕。
    const topBar = document.createElement('div');
    topBar.className = 'tb-editor-topbar';

    const tabBar = document.createElement('div');
    tabBar.className = 'tb-editor-tabs';
    for (const t of this.tabs) {
      const tabBtn = document.createElement('button');
      tabBtn.type = 'button';
      tabBtn.className = 'tb-editor-tab';
      tabBtn.dataset.tabId = t.id;
      tabBtn.textContent = t.label;
      tabBtn.addEventListener('click', () => void this.selectTab(t.id));
      tabBar.appendChild(tabBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tb-editor-close';
    closeBtn.textContent = '✕ 關閉';
    closeBtn.addEventListener('click', () => this.closeOverlay());

    // 匯出全部設定（用戶指定）：讀所有 localStorage override → 下載結構化 JSON（給翼騎寫進 repo default）。
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'tb-editor-export';
    exportBtn.textContent = '⤓ 匯出全部設定';
    exportBtn.title = '把目前調好、套用到遊戲的全部設定打包成 JSON 下載（交開發寫進打包預設給所有玩家）';
    exportBtn.addEventListener('click', () => this.downloadAllSettings());

    // 匯入設定 JSON（匯出的反向）：選 JSON 檔 → 依 EDITOR_STORE_META 分派各 editorStore（applyToGame）→
    // 各編輯器分頁顯示跟 JSON 一致。缺項不動、格式錯提示不炸。
    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'tb-editor-import';
    importBtn.textContent = '⤒ 匯入設定 JSON';
    importBtn.title = '載入一份設定 JSON（如之前匯出的），把各項套用到遊戲並讓編輯器顯示一致';
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = 'application/json,.json';
    importInput.className = 'tb-editor-import-input';
    importInput.style.display = 'none';
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', (e) => this.handleImportFile(e));

    topBar.appendChild(tabBar);
    topBar.appendChild(importBtn);
    topBar.appendChild(importInput);
    topBar.appendChild(exportBtn);
    topBar.appendChild(closeBtn);

    // 編輯器掛載區（各編輯器 mount 到這個 host 內的 .tb-editor-root 容器）。
    const host = document.createElement('div');
    host.className = 'tb-editor-host';

    // 狀態列（載入中/錯誤提示）。
    const status = document.createElement('div');
    status.className = 'tb-editor-status';

    overlay.appendChild(topBar);
    overlay.appendChild(host);
    overlay.appendChild(status);
    this.root.appendChild(overlay);

    this.overlayEl = overlay;
    this.editorHost = host;
    this.tabBar = tabBar;
    this.statusEl = status;
  }

  /** 切換到某 tab：unmount 舊、lazy import 新、mount 到新容器。 */
  private async selectTab(tabId: string): Promise<void> {
    if (tabId === this.activeTabId) return;
    const def = this.tabs.find((t) => t.id === tabId);
    if (!def || !this.editorHost) return;

    this.unmountActive();
    this.activeTabId = tabId;
    this.highlightActiveTab();
    this.setStatus(`載入 ${def.label}…`);

    // 分配乾淨容器（命名空間 .tb-editor-root，scoped DOM 查找不撞遊戲頁 id）。
    const container = document.createElement('div');
    container.className = 'tb-editor-root';
    this.editorHost.innerHTML = '';
    this.editorHost.appendChild(container);

    try {
      const mod = await def.loader();
      // 切 tab 競態保護：await 期間若又切走，放棄本次 mount。
      if (this.activeTabId !== tabId) return;
      this.activeInstance = mod.mount(container);
      this.setStatus('');
    } catch (err) {
      this.setStatus(`載入 ${def.label} 失敗：${String(err)}`);
    }
  }

  private unmountActive(): void {
    if (this.activeInstance) {
      try {
        this.activeInstance.unmount();
      } catch {
        /* 卸載失敗不擋 UI，容器會被清掉 */
      }
      this.activeInstance = null;
    }
    if (this.editorHost) this.editorHost.innerHTML = '';
  }

  private highlightActiveTab(): void {
    if (!this.tabBar) return;
    for (const el of Array.from(this.tabBar.children)) {
      const btn = el as HTMLButtonElement;
      btn.classList.toggle('active', btn.dataset.tabId === this.activeTabId);
    }
  }

  private setStatus(msg: string): void {
    if (this.statusEl) this.statusEl.textContent = msg;
  }

  /**
   * 匯出全部設定（用戶指定）：讀 editorStore 所有 override key（純讀，不改套用/讀取邏輯）→
   * 打包結構化 JSON（每 key 標 label + 翼騎 target + 原始值 + version）→ 下載 .json（檔名帶日期戳）。
   * 只含有存 localStorage 的 key；沒調的列 unset。localStorage 不可用時仍下載（settings 空 + unset 全列），不炸。
   */
  private downloadAllSettings(): void {
    try {
      const data = exportAllSettings();
      const count = Object.keys(data.settings).length;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportSettingsFilename();
      a.click();
      URL.revokeObjectURL(url);
      this.setStatus(
        count > 0
          ? `已匯出 ${count} 份已調整設定（${Object.keys(data.settings).join('、')}）→ 下載 ${a.download}。`
          : '目前沒有任何套用中的設定（都吃打包預設）。已下載空清單。',
      );
    } catch (err) {
      this.setStatus(`匯出失敗：${String(err)}`);
    }
  }

  /**
   * 匯入設定 JSON（匯出的反向）：讀檔 → JSON.parse → importAllSettings（依 EDITOR_STORE_META 分派 applyToGame）→
   * 重掛當前 tab 讓編輯器顯示跟 JSON 一致（各編輯器 mount 時 initLoad 讀新 override 回填）。
   * ★容錯：格式錯 → 狀態列提示不炸；缺項保持不變；不認得的 key 略過（狀態列標示）。
   */
  private handleImportFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let json: unknown;
      try {
        json = JSON.parse(String(reader.result));
      } catch (err) {
        this.setStatus(`匯入失敗：不是合法 JSON（${(err as Error).message}）。`);
        input.value = '';
        return;
      }
      const res = importAllSettings(json);
      if (!res.ok) {
        this.setStatus(
          res.unknown.length > 0
            ? `匯入未套用任何設定（不認得的項目：${res.unknown.join('、')}；或 localStorage 不可用）。`
            : '匯入未套用任何設定（JSON 沒有可辨識的設定項目，或 localStorage 不可用）。',
        );
        input.value = '';
        return;
      }
      // 重掛當前編輯器 → initLoad 讀新 override 回填，顯示跟 JSON 一致。
      const unknownNote = res.unknown.length > 0 ? `（略過不認得：${res.unknown.join('、')}）` : '';
      const doneMsg = `已匯入並套用 ${res.imported.length} 份設定（${res.imported.join('、')}）${unknownNote}。重開遊戲全面生效。`;
      // remount 是 async（selectTab 內 setStatus 載入中/清空）→ 完成後才設匯入成功訊息，避免被清掉。
      void this.remountActive().then(() => this.setStatus(doneMsg));
      input.value = ''; // 允許重選同檔
    };
    reader.readAsText(f);
  }

  /** 重掛當前 tab（匯入後讓編輯器讀新 override 回填）：unmount → 重新 mount 同一個 tab。回傳 mount 完成的 promise。 */
  private async remountActive(): Promise<void> {
    const tabId = this.activeTabId;
    if (!tabId) return;
    this.activeTabId = null; // 清掉讓 selectTab 不當成同 tab 提早 return
    await this.selectTab(tabId);
  }

  private injectStyle(): void {
    if (this.styleInjected || document.getElementById('tb-editor-overlay-style')) {
      this.styleInjected = true;
      return;
    }
    const style = document.createElement('style');
    style.id = 'tb-editor-overlay-style';
    style.textContent = OVERLAY_CSS;
    document.head.appendChild(style);
    this.styleInjected = true;
  }
}

/**
 * overlay 殼樣式（全部命名空間在 .tb-editor-* 下，不污染遊戲/編輯器內部樣式）。
 * 編輯器內部樣式由各編輯器自己在 .tb-editor-root 下注入（mount 化時搬進來）。
 */
const OVERLAY_CSS = `
.tb-editor-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  pointer-events: none;
  font-family: Arial, "Microsoft JhengHei", "Noto Sans TC", sans-serif;
}
.tb-editor-entry-btn {
  position: fixed;
  right: 12px;
  bottom: 56px;
  pointer-events: auto;
  padding: 8px 14px;
  border-radius: 20px;
  background: rgba(20, 20, 40, 0.72);
  color: #fff;
  font-size: 14px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  cursor: pointer;
  opacity: 0.72;
  transition: background 0.15s, opacity 0.15s;
}
.tb-editor-entry-btn:hover { background: rgba(40, 40, 70, 0.92); opacity: 1; }
.tb-editor-panel {
  position: fixed;
  inset: 0;
  display: none;
  flex-direction: column;
  background: #1a1a2e;
  color: #e6e6f0;
  pointer-events: auto;
}
.tb-editor-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: #23233a;
  border-bottom: 1px solid #3a3a5c;
  flex-wrap: wrap;
}
.tb-editor-tabs { display: flex; gap: 6px; flex: 1; flex-wrap: wrap; }
.tb-editor-tab {
  padding: 6px 12px;
  border-radius: 6px;
  background: #2c2c48;
  color: #e6e6f0;
  border: 1px solid #3a3a5c;
  cursor: pointer;
  font-size: 13px;
}
.tb-editor-tab:hover { border-color: #6c8cff; }
.tb-editor-tab.active { background: #6c8cff; border-color: #6c8cff; color: #fff; }
.tb-editor-close {
  padding: 6px 12px;
  border-radius: 6px;
  background: #2c2c48;
  color: #ff6c7a;
  border: 1px solid #3a3a5c;
  cursor: pointer;
  font-size: 13px;
}
.tb-editor-close:hover { border-color: #ff6c7a; }
.tb-editor-export {
  padding: 6px 12px;
  border-radius: 6px;
  background: #6c8cff;
  color: #fff;
  border: 1px solid #6c8cff;
  cursor: pointer;
  font-size: 13px;
}
.tb-editor-export:hover { background: #5578ff; }
.tb-editor-import {
  padding: 6px 12px;
  border-radius: 6px;
  background: #2c2c48;
  color: #6c8cff;
  border: 1px solid #6c8cff;
  cursor: pointer;
  font-size: 13px;
}
.tb-editor-import:hover { background: #34345a; }
.tb-editor-host { flex: 1; overflow: hidden; position: relative; }
.tb-editor-root { width: 100%; height: 100%; overflow: auto; }
.tb-editor-status {
  padding: 6px 14px;
  font-size: 12px;
  color: #9a9ab5;
  background: #23233a;
  border-top: 1px solid #3a3a5c;
  min-height: 14px;
}
`;
