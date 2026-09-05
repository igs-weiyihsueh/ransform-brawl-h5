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
let zoom = 2.0; // 預設從頭上 UI 區塊開始，放大看清 local 小尺寸；panel 切換時降到 0.45
/** 目前選中的元素 key（如 'overhead.credit' / 'panel.chest'）。 */
let selectedKey: string | null = null;

// ---- Undo / Redo 歷史 -----------------------------------------------------
//
// 每次「拖拉結束 / Inspector 數值變更 / 載入 / 重設」前記一份 layout 深拷貝進 undoStack。
// Ctrl+Z 還原上一步（把當前推進 redoStack）、Ctrl+Y（或 Ctrl+Shift+Z）反向。
// 拖拉中連續移動不逐幀記，只在手勢開始 beginEdit() 記一次、放開才 commitEdit()。

const HISTORY_CAP = 50;
let undoStack: UiLayoutFile[] = [];
let redoStack: UiLayoutFile[] = [];
/** 手勢/編輯開始時暫存的 layout 快照（beginEdit 記、commitEdit 決定是否入棧）。 */
let pendingSnapshot: string | null = null;

/** 手勢/編輯開始：記一份當前 layout 的 JSON 快照（尚未入棧）。 */
function beginEdit(): void {
  pendingSnapshot = JSON.stringify(layout);
}

/** 手勢/編輯結束：若 layout 真的變了，把開始時的快照推進 undoStack、清空 redo。 */
function commitEdit(): void {
  if (pendingSnapshot === null) return;
  const now = JSON.stringify(layout);
  if (now !== pendingSnapshot) {
    undoStack.push(JSON.parse(pendingSnapshot) as UiLayoutFile);
    if (undoStack.length > HISTORY_CAP) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }
  pendingSnapshot = null;
}

/** 立即記一步（用於載入/重設這種一次性整份變更）。 */
function pushHistory(): void {
  undoStack.push(cloneLayout(layout));
  if (undoStack.length > HISTORY_CAP) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(cloneLayout(layout));
  layout = prev;
  selectedKey = null;
  renderStage();
  selectFirstIfNone();
  updateHistoryButtons();
  setStatus('已復原（Undo）。', 'info');
}

function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(cloneLayout(layout));
  layout = next;
  selectedKey = null;
  renderStage();
  selectFirstIfNone();
  updateHistoryButtons();
  setStatus('已重做（Redo）。', 'info');
}

function updateHistoryButtons(): void {
  const u = document.getElementById('btn-undo') as HTMLButtonElement | null;
  const r = document.getElementById('btn-redo') as HTMLButtonElement | null;
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}

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

/** 目前編輯的區塊。兩塊座標系不同，一次只顯示一塊（畫面乾淨、專注）。 */
type Section = 'overhead' | 'panel';
let currentSection: Section = 'overhead';
/** 記住各區塊各自的選中元素（切換區塊時還原）。 */
const selectedBySection: Record<Section, string | null> = { overhead: null, panel: null };

/**
 * 頭上 UI 容器編輯錨點：置中於舞台（此區塊單獨顯示，放大看清 local 相對位置）。
 * local 座標基準=容器中心；容器 200×80 置中，四周留白供 zoom 放大檢視。
 */
function overheadContainerRect(): Rect {
  const ov = layout.overhead;
  const cx = layout.design.width / 2;
  const cy = layout.design.height / 2;
  return { x: cx - ov.width / 2, y: cy - ov.height / 2, width: ov.width, height: ov.height };
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

/** 建立「目前區塊」的可編輯元素清單（一次只一塊）。 */
function buildEditables(): Editable[] {
  return currentSection === 'overhead' ? buildOverheadEditables() : buildPanelEditables();
}

function buildOverheadEditables(): Editable[] {
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
  return list;
}

function buildPanelEditables(): Editable[] {
  const list: Editable[] = [];
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

  if (currentSection === 'panel') {
    // 底部 4 欄底框（遊戲樣式：圓角矩形，底 rgba(16,16,36,0.82)/白框；P2~P4 淡化）
    for (let i = 0; i < layout.panel.slotCount; i += 1) {
      const r = slotRect(i);
      const slot = document.createElement('div');
      slot.className = 'panel-slot-bg' + (i === 0 ? '' : ' inactive');
      slot.style.left = `${r.x}px`;
      slot.style.top = `${r.y}px`;
      slot.style.width = `${r.width}px`;
      slot.style.height = `${r.height}px`;
      slot.style.borderRadius = `${layout.panel.cornerRadius}px`;
      const lab = document.createElement('div');
      lab.className = 'slot-label';
      lab.textContent = `P${i + 1}${i === 0 ? '' : '（佔位）'}`;
      slot.appendChild(lab);
      stageEl.appendChild(slot);
    }
  } else {
    // 頭上 UI 容器框（此區塊單獨顯示，置中放大檢視）
    const oc = overheadContainerRect();
    const cont = document.createElement('div');
    cont.id = 'overhead-container';
    cont.style.left = `${oc.x}px`;
    cont.style.top = `${oc.y}px`;
    cont.style.width = `${oc.width}px`;
    cont.style.height = `${oc.height}px`;
    const clab = document.createElement('div');
    clab.className = 'slot-label';
    clab.textContent = '頭上 UI 容器（跟隨玩家，local 相對中心）';
    cont.appendChild(clab);
    stageEl.appendChild(cont);
  }

  // 各元素方框（聚焦模式）：只有「選中」那一個高亮 + 可拖拉/縮放；
  // 其餘半透明背景參考（不可拖，點一下=切換選中）。
  for (const ed of editables) {
    const r = ed.get();
    const isSel = ed.key === selectedKey;
    const box = document.createElement('div');
    box.className = 'ui-box' + (isSel ? ' selected' : ' dimmed');
    box.dataset.key = ed.key;
    box.style.left = `${ed.origin.x + r.x}px`;
    box.style.top = `${ed.origin.y + r.y}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    box.title = ed.label;
    const visual = document.createElement('div');
    visual.className = 'ui-visual';
    visual.appendChild(buildVisual(ed.key));
    box.appendChild(visual);
    if (isSel) {
      // 選中：可拖拉、可縮放（顯示 handle）。
      attachDrag(box, ed);
      if (ed.resizable) attachResize(box, ed);
    } else {
      // 未選中：只可點選切換，不拖動（避免誤拖擠在一起的元素）。
      box.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        selectedKey = ed.key;
        selectedBySection[currentSection] = ed.key;
        renderStage(); // 切換選中：重繪讓新選中的掛上拖拉、舊的變 dimmed
      });
    }
    stageEl.appendChild(box);
  }

  // P2~P4 佔位欄：只在 panel 區塊顯示（淡化複製 P1 template icon，防漂移）。
  if (currentSection === 'panel') renderPlaceholderColumns();

  renderTree();
  renderInspector();
}

// ---- 視覺（真 icon + 遊戲樣式）--------------------------------------------

/** icon 路徑：編輯器在 /ui-editor/，素材在網站根 assets/images/ui/。 */
function iconUrl(name: string): string {
  return `../assets/images/ui/${name}.png`;
}

/** 建一個 <img>，載入失敗退場成標籤色塊（本機無素材/缺圖也能用）。 */
function iconImg(name: string, label: string): HTMLElement {
  const img = document.createElement('img');
  img.src = iconUrl(name);
  img.alt = label;
  img.addEventListener('error', () => {
    const fb = document.createElement('div');
    fb.className = 'icon-fallback';
    fb.textContent = label;
    img.replaceWith(fb);
  });
  return img;
}

/** 依元素 key 建視覺內容（對照 uiConfig 樣式值）。 */
function buildVisual(key: string): HTMLElement {
  switch (key) {
    case 'panel.chest':
      return iconImg('chest', '寶箱');
    case 'panel.coin':
    case 'overhead.credit':
      return buildIconWithNumber(key);
    case 'panel.ticket':
      return buildTicket();
    case 'panel.progress':
      return buildProgressBar();
    case 'overhead.badge':
      return buildBadge();
    case 'overhead.energy':
      return buildEnergyCells();
    case 'overhead.combo':
      return buildCombo();
    default: {
      const d = document.createElement('div');
      d.className = 'icon-fallback';
      d.textContent = key;
      return d;
    }
  }
}

/** Credit / coin：金幣 icon + 數字（白）。 */
function buildIconWithNumber(key: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px;width:100%;height:100%;';
  const coin = iconImg('coin', '金幣');
  coin.style.cssText = 'width:auto;height:100%;object-fit:contain;';
  wrap.appendChild(coin);
  if (key === 'overhead.credit') {
    const num = document.createElement('span');
    num.textContent = '1234';
    num.style.cssText = 'color:#fff;font-size:22px;font-weight:bold;white-space:nowrap;';
    wrap.appendChild(num);
  }
  return wrap;
}

/** 彩票：ticket icon + 數字（30px 白粗體，放右）。 */
function buildTicket(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%;height:100%;';
  const t = iconImg('ticket', '彩票');
  t.style.cssText = 'width:auto;height:100%;object-fit:contain;';
  const num = document.createElement('span');
  num.textContent = '8';
  num.style.cssText = 'color:#fff;font-size:30px;font-weight:bold;';
  wrap.appendChild(t);
  wrap.appendChild(num);
  return wrap;
}

/** 進度條：圓角條，底 #2a2a3a、填 #4caf50 綠半滿。 */
function buildProgressBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.style.cssText =
    'width:100%;height:100%;background:#2a2a3a;border-radius:6px;overflow:hidden;';
  const fill = document.createElement('div');
  fill.style.cssText = 'width:50%;height:100%;background:#4caf50;border-radius:6px;';
  bar.appendChild(fill);
  return bar;
}

/** 魂力環：ring.png 底環 + 中心 P 牌（藍底白字）+ 紫弧示意。 */
function buildBadge(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:100%;height:100%;';
  const ring = iconImg('ring', '魂力環');
  ring.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;';
  wrap.appendChild(ring);
  // 紫弧（用 conic-gradient 半圈示意 #ba68c8）
  const arc = document.createElement('div');
  arc.style.cssText =
    'position:absolute;inset:8%;border-radius:50%;background:conic-gradient(#ba68c8 0deg 200deg, transparent 200deg 360deg);opacity:0.85;-webkit-mask:radial-gradient(circle, transparent 62%, #000 64%);mask:radial-gradient(circle, transparent 62%, #000 64%);';
  wrap.appendChild(arc);
  // 中心 P 牌
  const pnum = document.createElement('div');
  pnum.textContent = layout.overhead.badge.text || 'P1';
  pnum.style.cssText =
    'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:56%;height:56%;border-radius:50%;background:#2196f3;color:#fff;font-weight:bold;font-size:14px;display:flex;align-items:center;justify-content:center;';
  wrap.appendChild(pnum);
  return wrap;
}

/** 能量：4 小方格（16×16 gap6 圓角3，金 #ffd54f / 暗 #3a3a5a）。 */
function buildEnergyCells(): HTMLElement {
  const e = layout.overhead.energy;
  const wrap = document.createElement('div');
  wrap.style.cssText = `display:flex;gap:${e.cellGap}px;align-items:center;height:100%;`;
  for (let i = 0; i < e.cellCount; i += 1) {
    const cell = document.createElement('div');
    const filled = i < 2; // 示意半滿
    cell.style.cssText =
      `width:${e.cellWidth}px;height:${e.cellHeight}px;border-radius:${e.cornerRadius}px;` +
      `background:${filled ? '#ffd54f' : '#3a3a5a'};`;
    wrap.appendChild(cell);
  }
  return wrap;
}

/** COMBO：文字 "12 HIT"（24px 橘 #ffb300）。 */
function buildCombo(): HTMLElement {
  const t = document.createElement('div');
  t.textContent = `12${layout.overhead.combo.suffix || ' HIT'}`;
  t.style.cssText =
    'color:#ffb300;font-size:24px;font-weight:bold;white-space:nowrap;display:flex;align-items:center;height:100%;';
  return t;
}

/** P2~P4 佔位欄：alpha 0.4 複製 P1 欄底框 + P1 template 元素 icon（唯讀，不可拖）。 */
function renderPlaceholderColumns(): void {
  const p1Col = layout.panel.columns.find((c) => c.playerIndex === 0);
  const p1Elements = p1Col ? p1Col.elements : [];
  for (let i = 1; i < layout.panel.slotCount; i += 1) {
    const slot = slotRect(i);
    const p1 = slotRect(0);
    for (const el of p1Elements) {
      const box = document.createElement('div');
      box.style.cssText =
        `position:absolute;pointer-events:none;opacity:0.4;` +
        `left:${slot.x + el.x}px;top:${slot.y + el.y}px;width:${el.width}px;height:${el.height}px;`;
      const visual = document.createElement('div');
      visual.className = 'ui-visual';
      visual.appendChild(buildVisual(`panel.${el.id}`));
      box.appendChild(visual);
      stageEl.appendChild(box);
    }
    void p1; // p1 origin 已用於 el 相對座標（與 active 欄同 template）
  }
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
    beginEdit(); // 記手勢開始前的快照
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
      commitEdit(); // 放開才記一步
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
    beginEdit(); // 記手勢開始前的快照
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
      commitEdit(); // 放開才記一步
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
  // 只列目前區塊的元素（一次一塊）。
  const groupName = currentSection === 'overhead' ? '頭上 UI' : '底部面板（P1）';
  const gl = document.createElement('div');
  gl.className = 'tree-group';
  gl.textContent = groupName;
  tree.appendChild(gl);
  for (const ed of editables) {
    const item = document.createElement('div');
    item.className = 'tree-item' + (ed.key === selectedKey ? ' selected' : '');
    item.textContent = ed.label;
    item.addEventListener('click', () => {
      selectedKey = ed.key;
      selectedBySection[currentSection] = ed.key;
      renderStage(); // 聚焦模式：切換選中要重掛拖拉到新元素、舊的變 dimmed
    });
    tree.appendChild(item);
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
  // 聚焦時記快照，變更提交（change=blur/Enter）時入棧一步，避免逐字記歷史。
  input.addEventListener('focus', () => beginEdit());
  input.addEventListener('change', () => commitEdit());
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

function loadIntoState(file: UiLayoutFile, recordHistory = false): void {
  if (recordHistory) pushHistory(); // 讓載入/重設可被 Undo 還原
  layout = file;
  selectedKey = null;
  renderStage();
  selectFirstIfNone();
}

/** 聚焦模式：若目前沒有選中元素，預設選第一個（讓一進來就有可編輯的 active 元素）。 */
function selectFirstIfNone(): void {
  if (selectedKey === null && editables.length > 0) {
    selectedKey = editables[0].key;
    selectedBySection[currentSection] = selectedKey;
    renderStage();
  }
}

/** 切換編輯區塊（頭上 UI / 下方面板）：一次只顯示一塊，還原該塊上次的選中。 */
function switchSection(section: Section): void {
  if (section === currentSection) return;
  currentSection = section;
  selectedKey = selectedBySection[section]; // 還原該塊上次選中（可能為 null）
  // 更新 tab 樣式。
  const tOv = document.getElementById('tab-overhead');
  const tPn = document.getElementById('tab-panel');
  if (tOv) tOv.classList.toggle('active', section === 'overhead');
  if (tPn) tPn.classList.toggle('active', section === 'panel');
  // 各塊預設 zoom：頭上塊小尺寸放大看(200%)、面板大尺寸縮小看全欄(45%)。同步滑桿。
  zoom = section === 'overhead' ? 2.0 : 0.45;
  const zoomInput = document.getElementById('zoom') as HTMLInputElement | null;
  if (zoomInput) zoomInput.value = String(Math.round(zoom * 100));
  applyZoom();
  renderStage();
  selectFirstIfNone();
  setStatus(section === 'overhead' ? '編輯：頭上 UI（跟隨玩家）。' : '編輯：下方面板（P1）。', 'info');
}

async function loadDefault(): Promise<void> {
  const url = '../assets/data/uiLayout.json'; // 編輯器在 /ui-editor/，資料在網站根 assets/data/
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw: unknown = await res.json();
    loadIntoState(assertValidUiLayout(raw), true);
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
  loadIntoState(result.data, true);
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
  loadIntoState(cloneLayout(DEFAULT_UI_LAYOUT), true);
  setStatus('已重設為預設值。', 'info');
}

// ---- 綁定 -----------------------------------------------------------------

function bindUI(): void {
  $('schema-version').textContent = `schema v${UI_LAYOUT_SCHEMA_VERSION}`;
  $('tab-overhead').addEventListener('click', () => switchSection('overhead'));
  $('tab-panel').addEventListener('click', () => switchSection('panel'));
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

  // Undo/Redo：按鈕 + 鍵盤。
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);
  window.addEventListener('keydown', (e) => {
    // 若正在數值輸入框打字，讓瀏覽器/欄位自己處理（不攔）。
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const ctrl = e.ctrlKey || e.metaKey; // 支援 Cmd（Mac）
    if (!ctrl) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  });
  updateHistoryButtons();
}

bindUI();
applyZoom();
renderStage();
selectFirstIfNone();
