/**
 * UI 位置編輯器（獨立進入點）— 可視化拖拉調整 UI 佈局。
 *
 * 架構：獨立 Vite entry（ui-editor/index.html），與遊戲分開打包，零 Phaser、
 * 只 import 凍結的 uiLayoutSchema（單向依賴，不 import 任何遊戲模組）。
 *
 * 功能：在 1920×1080 舞台上畫出各 UI 元素方框 → 拖拉移動 / 拉右下把手改大小 →
 * 右側 Inspector 數值微調 → assertValidUiLayout 驗過才匯出下載 uiLayout.json；
 * 也可載入既有 uiLayout.json。
 *
 * 座標模型：
 *  - overhead：容器有 width/height，編輯時擺在舞台上方中央當「編輯錨點」；
 *    各 overhead 元素的 x/y 是相對容器中心的 local 座標（跟遊戲端一致）。
 *  - panel：由欄參數算出 4 欄矩形（P1 active）；panel 元素 x/y 相對 P1 欄左上。
 */
import {
  UI_LAYOUT_SCHEMA_VERSION,
  assertValidUiLayout,
  DEFAULT_UI_LAYOUT,
  validateUiLayout,
  type PanelElement,
  type UiLayoutFile,
} from '@/config/uiLayoutSchema';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

// ---- 狀態 -----------------------------------------------------------------

/** 深拷貝一份預設當初始狀態（避免改到常數）。 */
function cloneLayout(src: UiLayoutFile): UiLayoutFile {
  return JSON.parse(JSON.stringify(src)) as UiLayoutFile;
}

let layout: UiLayoutFile = cloneLayout(DEFAULT_UI_LAYOUT);
let zoom = 0.45;
/** 目前選中的元素 key（如 'overhead.credit' / 'panel.chest'）。 */
let selectedKey: string | null = null;

// ---- 可編輯元素的統一存取介面 --------------------------------------------
//
// 每個可拖拉方框綁一個 accessor：讀/寫其 x/y/w/h（寫回 layout 物件），
// 以及 origin（該元素 local 座標在舞台上的像素原點）。box 的舞台像素 = origin + (x,y)。

interface Rect { x: number; y: number; width: number; height: number; }

interface Editable {
  key: string;
  label: string;
  /** local 座標原點在舞台的像素位置（overhead=容器中心；panel=P1 欄左上）。 */
  origin: { x: number; y: number };
  get(): Rect;
  set(r: Partial<Rect>): void;
  /** 是否可改尺寸（badge 用半徑，無 w/h 方框，唯讀尺寸）。 */
  resizable: boolean;
}

const stageEl = $('stage');

/** 舞台上「頭上 UI 容器」編輯錨點：水平置中、上方 200px 處。 */
function overheadContainerRect(): Rect {
  const ov = layout.overhead;
  const cx = layout.design.width / 2;
  const topY = 200;
  return { x: cx - ov.width / 2, y: topY, width: ov.width, height: ov.height };
}

/** 頭上容器中心（local 原點）在舞台的像素座標。 */
function overheadOrigin(): { x: number; y: number } {
  const c = overheadContainerRect();
  return { x: c.x + c.width / 2, y: c.y + c.height / 2 };
}

/** 依欄參數算第 i 欄矩形（螢幕座標）。 */
function slotRect(i: number): Rect {
  const p = layout.panel;
  const totalWidth = p.slotCount * p.slotWidth + (p.slotCount - 1) * p.slotGap;
  const startX = (layout.design.width - totalWidth) / 2;
  const y = layout.design.height - p.bottomOffset - p.slotHeight;
  const x = startX + i * (p.slotWidth + p.slotGap);
  return { x, y, width: p.slotWidth, height: p.slotHeight };
}

/** 建立目前佈局的所有可編輯元素清單。 */
function buildEditables(): Editable[] {
  const list: Editable[] = [];
  const ov = layout.overhead;
  const oOrigin = overheadOrigin();

  // overhead.credit（有 w/h，可縮放）
  list.push({
    key: 'overhead.credit', label: '點數 credit', origin: oOrigin, resizable: true,
    get: () => ({ x: ov.credit.x, y: ov.credit.y, width: ov.credit.width, height: ov.credit.height }),
    set: (r) => {
      if (r.x !== undefined) ov.credit.x = r.x;
      if (r.y !== undefined) ov.credit.y = r.y;
      if (r.width !== undefined) ov.credit.width = r.width;
      if (r.height !== undefined) ov.credit.height = r.height;
    },
  });

  // overhead.combo（點狀，用固定小框表示位置，不縮放）
  list.push({
    key: 'overhead.combo', label: '連段 combo', origin: oOrigin, resizable: false,
    get: () => ({ x: ov.combo.x - 30, y: ov.combo.y - 12, width: 60, height: 24 }),
    set: (r) => {
      if (r.x !== undefined) ov.combo.x = r.x + 30;
      if (r.y !== undefined) ov.combo.y = r.y + 12;
    },
  });

  // overhead.badge（同心圓，用外接方框=ringRadius，位置=cx/cy 中心，不縮放）
  list.push({
    key: 'overhead.badge', label: '玩家牌/魂力環 badge', origin: oOrigin, resizable: false,
    get: () => {
      const d = ov.badge.ringRadius * 2;
      return { x: ov.badge.cx - ov.badge.ringRadius, y: ov.badge.cy - ov.badge.ringRadius, width: d, height: d };
    },
    set: (r) => {
      if (r.x !== undefined) ov.badge.cx = r.x + ov.badge.ringRadius;
      if (r.y !== undefined) ov.badge.cy = r.y + ov.badge.ringRadius;
    },
  });

  // overhead.energy（4 格總寬 = cellCount*cellWidth + gaps，起點 x/y，不縮放整塊）
  list.push({
    key: 'overhead.energy', label: '能量格 energy', origin: oOrigin, resizable: false,
    get: () => {
      const e = ov.energy;
      const w = e.cellCount * e.cellWidth + (e.cellCount - 1) * e.cellGap;
      return { x: e.x, y: e.y, width: w, height: e.cellHeight };
    },
    set: (r) => {
      if (r.x !== undefined) ov.energy.x = r.x;
      if (r.y !== undefined) ov.energy.y = r.y;
    },
  });

  // panel 元素（第一版單人：編 P1 = columns[playerIndex 0] 的元素，相對 P1 欄左上）
  const p1 = slotRect(0);
  const pOrigin = { x: p1.x, y: p1.y };
  const p1Col = layout.panel.columns.find((c) => c.playerIndex === 0);
  const p1Elements = p1Col ? p1Col.elements : [];
  for (const el of p1Elements) {
    const ref: PanelElement = el;
    list.push({
      key: `panel.${ref.id}`, label: `${panelElLabel(ref.id)}（${ref.id}）`, origin: pOrigin, resizable: true,
      get: () => ({ x: ref.x, y: ref.y, width: ref.width, height: ref.height }),
      set: (r) => {
        if (r.x !== undefined) ref.x = r.x;
        if (r.y !== undefined) ref.y = r.y;
        if (r.width !== undefined) ref.width = r.width;
        if (r.height !== undefined) ref.height = r.height;
      },
    });
  }
  return list;
}

function panelElLabel(id: string): string {
  const map: Record<string, string> = {
    chest: '寶箱', ticket: '彩票', progress: '寶盒進度條', coin: '金幣',
  };
  return map[id] ?? id;
}

// ---- 渲染舞台 -------------------------------------------------------------

let editables: Editable[] = [];

function setStatus(msg: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  const el = $('status');
  el.textContent = msg;
  el.className = kind === 'ok' ? 'status-ok' : kind === 'err' ? 'status-err' : '';
}

function applyZoom(): void {
  stageEl.style.transform = `scale(${zoom})`;
  $('zoom-val').textContent = `${Math.round(zoom * 100)}%`;
}

function renderStage(): void {
  editables = buildEditables();
  stageEl.innerHTML = '';

  // 底部 4 欄
  for (let i = 0; i < layout.panel.slotCount; i += 1) {
    const r = slotRect(i);
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === 0 ? '' : ' inactive');
    slot.style.left = `${r.x}px`;
    slot.style.top = `${r.y}px`;
    slot.style.width = `${r.width}px`;
    slot.style.height = `${r.height}px`;
    const lab = document.createElement('div');
    lab.className = 'slot-label';
    lab.textContent = `P${i + 1}${i === 0 ? '' : '（佔位）'}`;
    slot.appendChild(lab);
    stageEl.appendChild(slot);
  }

  // 頭上 UI 容器框
  const oc = overheadContainerRect();
  const cont = document.createElement('div');
  cont.id = 'overhead-container';
  cont.style.left = `${oc.x}px`;
  cont.style.top = `${oc.y}px`;
  cont.style.width = `${oc.width}px`;
  cont.style.height = `${oc.height}px`;
  const clab = document.createElement('div');
  clab.className = 'slot-label';
  clab.textContent = '頭上 UI（跟隨玩家）';
  cont.appendChild(clab);
  stageEl.appendChild(cont);

  // 各可編輯方框
  for (const ed of editables) {
    const r = ed.get();
    const box = document.createElement('div');
    box.className = 'ui-box' + (ed.key === selectedKey ? ' selected' : '');
    box.dataset.key = ed.key;
    box.style.left = `${ed.origin.x + r.x}px`;
    box.style.top = `${ed.origin.y + r.y}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    box.textContent = ed.label;
    attachDrag(box, ed);
    if (ed.resizable) attachResize(box, ed);
    stageEl.appendChild(box);
  }

  renderTree();
  renderInspector();
}

// ---- 拖拉 / 縮放 ----------------------------------------------------------

/** 把滑鼠位移（螢幕像素）換算成舞台座標位移（除以 zoom）。 */
function toStageDelta(dxScreen: number, dyScreen: number): { dx: number; dy: number } {
  return { dx: dxScreen / zoom, dy: dyScreen / zoom };
}

function attachDrag(box: HTMLDivElement, ed: Editable): void {
  box.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).classList.contains('resize-handle')) return;
    e.preventDefault();
    selectedKey = ed.key;
    renderSelectionOnly();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = ed.get();
    box.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent): void => {
      const { dx, dy } = toStageDelta(ev.clientX - startX, ev.clientY - startY);
      ed.set({ x: Math.round(start.x + dx), y: Math.round(start.y + dy) });
      const r = ed.get();
      box.style.left = `${ed.origin.x + r.x}px`;
      box.style.top = `${ed.origin.y + r.y}px`;
      updateInspectorFields(ed);
    };
    const onUp = (ev: PointerEvent): void => {
      box.releasePointerCapture(ev.pointerId);
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerup', onUp);
      renderStage(); // 重繪（欄座標可能連動）
    };
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerup', onUp);
  });
}

function attachResize(box: HTMLDivElement, ed: Editable): void {
  const handle = document.createElement('div');
  handle.className = 'resize-handle';
  box.appendChild(handle);
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectedKey = ed.key;
    renderSelectionOnly();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = ed.get();
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent): void => {
      const { dx, dy } = toStageDelta(ev.clientX - startX, ev.clientY - startY);
      ed.set({
        width: Math.max(4, Math.round(start.width + dx)),
        height: Math.max(4, Math.round(start.height + dy)),
      });
      const r = ed.get();
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      updateInspectorFields(ed);
    };
    const onUp = (ev: PointerEvent): void => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      renderStage();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

/** 只更新選取樣式（拖拉開始時輕量套用，不整頁重繪）。 */
function renderSelectionOnly(): void {
  stageEl.querySelectorAll<HTMLDivElement>('.ui-box').forEach((b) => {
    b.classList.toggle('selected', b.dataset.key === selectedKey);
  });
  renderTree();
  renderInspector();
}

// ---- 元素樹 / Inspector ---------------------------------------------------

function renderTree(): void {
  const tree = $('tree');
  tree.innerHTML = '';
  const groups: Array<{ name: string; prefix: string }> = [
    { name: '頭上 UI', prefix: 'overhead.' },
    { name: '底部面板（P1）', prefix: 'panel.' },
  ];
  for (const g of groups) {
    const gl = document.createElement('div');
    gl.className = 'tree-group';
    gl.textContent = g.name;
    tree.appendChild(gl);
    for (const ed of editables.filter((e) => e.key.startsWith(g.prefix))) {
      const item = document.createElement('div');
      item.className = 'tree-item' + (ed.key === selectedKey ? ' selected' : '');
      item.textContent = ed.label;
      item.addEventListener('click', () => {
        selectedKey = ed.key;
        renderSelectionOnly();
      });
      tree.appendChild(item);
    }
  }
}

function currentEditable(): Editable | undefined {
  return editables.find((e) => e.key === selectedKey);
}

function renderInspector(): void {
  const insp = $('inspector');
  insp.innerHTML = '';
  const ed = currentEditable();
  if (!ed) {
    insp.innerHTML = '<div class="hint">在畫面點選一個 UI 元素以編輯座標/尺寸。</div>';
    return;
  }
  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = ed.label;
  insp.appendChild(title);

  const r = ed.get();
  insp.appendChild(numRow(ed, 'x', 'X（local）', r.x));
  insp.appendChild(numRow(ed, 'y', 'Y（local）', r.y));
  if (ed.resizable) {
    insp.appendChild(numRow(ed, 'width', '寬 width', r.width));
    insp.appendChild(numRow(ed, 'height', '高 height', r.height));
  } else {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '此元素尺寸由專屬參數（半徑/格數等）決定，這裡只調位置；細部尺寸請在 JSON 或請界騎調。';
    insp.appendChild(hint);
  }
}

function numRow(ed: Editable, field: keyof Rect, label: string, value: number): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '1';
  input.value = String(value);
  input.dataset.field = field;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (!Number.isFinite(v)) return;
    ed.set({ [field]: Math.round(v) } as Partial<Rect>);
    // 只移動對應方框，不整頁重繪（避免 input 失焦）。
    const box = stageEl.querySelector<HTMLDivElement>(`.ui-box[data-key="${ed.key}"]`);
    if (box) {
      const cur = ed.get();
      box.style.left = `${ed.origin.x + cur.x}px`;
      box.style.top = `${ed.origin.y + cur.y}px`;
      box.style.width = `${cur.width}px`;
      box.style.height = `${cur.height}px`;
    }
  });
  row.appendChild(lab);
  row.appendChild(input);
  return row;
}

/** 拖拉中同步 Inspector 數值欄（若正顯示同一元素）。 */
function updateInspectorFields(ed: Editable): void {
  if (selectedKey !== ed.key) return;
  const r = ed.get();
  const insp = $('inspector');
  const set = (f: string, val: number): void => {
    const input = insp.querySelector<HTMLInputElement>(`input[data-field="${f}"]`);
    if (input && document.activeElement !== input) input.value = String(val);
  };
  set('x', r.x); set('y', r.y); set('width', r.width); set('height', r.height);
}

// ---- 載入 / 匯出 / 重設 ---------------------------------------------------

function loadIntoState(file: UiLayoutFile): void {
  layout = file;
  selectedKey = null;
  renderStage();
}

async function loadDefault(): Promise<void> {
  const url = '../assets/data/uiLayout.json'; // 編輯器在 /ui-editor/，資料在網站根 assets/data/
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw: unknown = await res.json();
    loadIntoState(assertValidUiLayout(raw));
    setStatus(`已載入預設 ${url}。`, 'ok');
  } catch (e) {
    setStatus(`載入預設失敗：${(e as Error).message}`, 'err');
  }
}

function loadFromFile(text: string, fileName: string): void {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    setStatus(`檔案 ${fileName} 不是合法 JSON：${(e as Error).message}`, 'err');
    return;
  }
  const result = validateUiLayout(raw);
  if (!result.ok) {
    setStatus(`檔案 ${fileName} 驗證失敗（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return;
  }
  loadIntoState(result.data);
  setStatus(`已載入 ${fileName}。`, 'ok');
}

function exportJson(): void {
  const result = validateUiLayout(layout);
  if (!result.ok) {
    setStatus(`匯出被擋下：資料不合法（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return;
  }
  const validated = assertValidUiLayout(layout);
  const text = JSON.stringify(validated, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'uiLayout.json';
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus('驗證通過，已下載 uiLayout.json。', 'ok');
}

function resetDefault(): void {
  loadIntoState(cloneLayout(DEFAULT_UI_LAYOUT));
  setStatus('已重設為預設值。', 'info');
}

// ---- 綁定 -----------------------------------------------------------------

function bindUI(): void {
  $('schema-version').textContent = `schema v${UI_LAYOUT_SCHEMA_VERSION}`;
  $('btn-load-default').addEventListener('click', () => void loadDefault());
  $('btn-export').addEventListener('click', exportJson);
  $('btn-reset').addEventListener('click', resetDefault);

  const fileInput = $<HTMLInputElement>('file-input');
  $('btn-load-file').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => loadFromFile(String(reader.result), f.name);
    reader.readAsText(f);
    fileInput.value = '';
  });

  const zoomInput = $<HTMLInputElement>('zoom');
  zoomInput.addEventListener('input', () => {
    zoom = Number(zoomInput.value) / 100;
    applyZoom();
  });
}

bindUI();
applyZoom();
renderStage();
