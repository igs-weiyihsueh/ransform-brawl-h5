/**
 * 波次編輯器（獨立進入點）— Inspector 式網頁工具。
 *
 * 架構（架構顧問核可，見 docs/h5_collab_spec.md §4）：
 *  - 獨立 Vite entry（editor/index.html），與遊戲 main.ts 分開打包，遊戲 bundle 不含本檔。
 *  - **單向依賴**：只 import 凍結的 levelSchema（純型別 + 驗證，零遊戲/Phaser 依賴）。
 *    不 import 任何遊戲 runtime。
 *  - 匯出前一律用 assertValidLevels 驗證，不合法就擋下並顯示精準錯誤（大聲失敗）。
 *
 * 功能：載入 levels.json → 關卡列表（用 name）→ 選關顯示節點序列 →
 * 加/刪/排序節點 → 依 nodeType 編輯欄位 → 驗證＋下載 JSON / 也可載入既有 JSON。
 */
import {
  ENEMY_TYPES,
  LEVELS_SCHEMA_VERSION,
  assertValidLevels,
  type EnemyType,
  type EventNodeData,
  type LevelData,
  type LevelNodeData,
  type LevelsFile,
  type RewardNodeData,
  type SpawnNodeData,
  validateLevels,
} from '@/config/levelSchema';
import {
  PREVIEW_MSG,
  PREVIEW_QUERY_FLAG,
  type PreviewMessage,
} from '@/config/previewProtocol';
import { enemyTypeLabel, nodeTypeLabel } from './labels';

// ---- 編輯狀態（可變草稿；匯出時才驗證） ----------------------------------
// 注意：編輯過程用寬鬆型別草稿（欄位可能暫時不合法），匯出前才收斂驗證。

interface EditorState {
  version: number;
  levels: LevelData[];
  selectedLevel: number;
  selectedNode: number;
}

const state: EditorState = {
  version: LEVELS_SCHEMA_VERSION,
  levels: [],
  selectedLevel: -1,
  selectedNode: -1,
};

// ---- DOM 快取 -------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

const levelListEl = $('level-list');
const nodeListEl = $('node-list');
const inspectorEl = $('inspector');
const statusEl = $('status');

// ---- 狀態訊息 -------------------------------------------------------------

function setStatus(msg: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  statusEl.textContent = msg;
  statusEl.className = kind === 'ok' ? 'status-ok' : kind === 'err' ? 'status-err' : '';
}

// ---- 預設節點工廠（新增節點時給合理預設） --------------------------------

function defaultSpawnNode(): SpawnNodeData {
  return {
    nodeType: 'Spawn',
    killQuota: 10,
    maxAlive: 10,
    spawnThreshold: 6,
    spawnInterval: 0.4,
    spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }],
  };
}
function defaultRewardNode(): RewardNodeData {
  return { nodeType: 'Reward' };
}
function defaultEventNode(): EventNodeData {
  return { nodeType: 'Event', eventPresetName: 'Guard60' };
}

function makeNode(type: LevelNodeData['nodeType']): LevelNodeData {
  if (type === 'Spawn') return defaultSpawnNode();
  if (type === 'Reward') return defaultRewardNode();
  return defaultEventNode();
}

// ---- 渲染：關卡列表 -------------------------------------------------------

function currentLevel(): LevelData | undefined {
  return state.levels[state.selectedLevel];
}
function currentNode(): LevelNodeData | undefined {
  return currentLevel()?.nodes[state.selectedNode];
}

function renderLevelList(): void {
  levelListEl.innerHTML = '';
  if (state.levels.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '尚無關卡';
    levelListEl.appendChild(empty);
    return;
  }
  state.levels.forEach((lvl, i) => {
    const item = document.createElement('div');
    item.className = 'list-item' + (i === state.selectedLevel ? ' selected' : '');
    const label = document.createElement('span');
    label.className = 'grow';
    label.textContent = lvl.name ? `${lvl.name} (${lvl.id})` : lvl.id;
    item.appendChild(label);

    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '✕';
    del.title = '刪除關卡';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      state.levels.splice(i, 1);
      if (state.selectedLevel >= state.levels.length) state.selectedLevel = state.levels.length - 1;
      state.selectedNode = -1;
      renderAll();
    });
    item.appendChild(del);

    item.addEventListener('click', () => {
      state.selectedLevel = i;
      state.selectedNode = -1;
      renderAll();
    });
    levelListEl.appendChild(item);
  });
}

// ---- 渲染：節點列表（含排序） ---------------------------------------------

function renderNodeList(): void {
  nodeListEl.innerHTML = '';
  const lvl = currentLevel();
  if (!lvl) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '先選一個關卡';
    nodeListEl.appendChild(empty);
    return;
  }
  if (lvl.nodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '尚無節點，用下方按鈕新增';
    nodeListEl.appendChild(empty);
    return;
  }
  lvl.nodes.forEach((node, i) => {
    const item = document.createElement('div');
    item.className = 'list-item' + (i === state.selectedNode ? ' selected' : '');

    const label = document.createElement('span');
    label.className = 'grow';
    label.textContent = `${i + 1}. ${nodeSummary(node)}`;
    item.appendChild(label);

    const up = document.createElement('button');
    up.textContent = '↑';
    up.title = '上移';
    up.disabled = i === 0;
    up.addEventListener('click', (e) => {
      e.stopPropagation();
      moveNode(i, i - 1);
    });
    item.appendChild(up);

    const down = document.createElement('button');
    down.textContent = '↓';
    down.title = '下移';
    down.disabled = i === lvl.nodes.length - 1;
    down.addEventListener('click', (e) => {
      e.stopPropagation();
      moveNode(i, i + 1);
    });
    item.appendChild(down);

    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '✕';
    del.title = '刪除節點';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      lvl.nodes.splice(i, 1);
      if (state.selectedNode >= lvl.nodes.length) state.selectedNode = lvl.nodes.length - 1;
      renderAll();
    });
    item.appendChild(del);

    item.addEventListener('click', () => {
      state.selectedNode = i;
      renderAll();
    });
    nodeListEl.appendChild(item);
  });
}

function nodeSummary(node: LevelNodeData): string {
  if (node.nodeType === 'Spawn') return `${nodeTypeLabel('Spawn')}（殺敵 ${node.killQuota}）`;
  if (node.nodeType === 'Reward') {
    return `${nodeTypeLabel('Reward')}${node.rewardPresetName ? `（${node.rewardPresetName}）` : ''}`;
  }
  return `${nodeTypeLabel('Event')}（${node.eventPresetName}）`;
}

function moveNode(from: number, to: number): void {
  const lvl = currentLevel();
  if (!lvl) return;
  if (to < 0 || to >= lvl.nodes.length) return;
  const [n] = lvl.nodes.splice(from, 1);
  lvl.nodes.splice(to, 0, n);
  state.selectedNode = to;
  renderAll();
}

// ---- 渲染：Inspector ------------------------------------------------------

/** 建一列「label + input」。 */
function fieldRow(
  labelText: string,
  input: HTMLElement,
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('label');
  label.textContent = labelText;
  row.appendChild(label);
  row.appendChild(input);
  return row;
}

function numberInput(value: number, onChange: (v: number) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    onChange(Number.isFinite(v) ? v : 0);
    // 只更新節點列表摘要，不整頁重繪（避免游標跳走）。
    renderNodeList();
  });
  return input;
}

function textInput(value: string, onChange: (v: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('input', () => {
    onChange(input.value);
    renderNodeList();
    renderLevelList();
  });
  return input;
}

function renderInspector(): void {
  inspectorEl.innerHTML = '';
  const lvl = currentLevel();
  if (!lvl) {
    inspectorEl.innerHTML = '<div class="empty">先選一個關卡</div>';
    return;
  }

  // 關卡層級欄位：id / name。
  inspectorEl.appendChild(
    fieldRow('關卡ID', textInput(lvl.id, (v) => { lvl.id = v; })),
  );
  inspectorEl.appendChild(
    fieldRow('關卡名稱', textInput(lvl.name ?? '', (v) => {
      if (v.length === 0) delete lvl.name;
      else lvl.name = v;
    })),
  );

  const node = currentNode();
  if (!node) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '選一個節點以編輯其欄位。';
    inspectorEl.appendChild(hint);
    return;
  }

  const hr = document.createElement('div');
  hr.className = 'section-title';
  hr.style.marginTop = '16px';
  hr.textContent = `節點 #${state.selectedNode + 1}：${nodeTypeLabel(node.nodeType)}`;
  inspectorEl.appendChild(hr);

  if (node.nodeType === 'Spawn') renderSpawnInspector(node);
  else if (node.nodeType === 'Reward') renderRewardInspector(node);
  else renderEventInspector(node);
}

function renderSpawnInspector(node: SpawnNodeData): void {
  inspectorEl.appendChild(fieldRow('殺敵數', numberInput(node.killQuota, (v) => { node.killQuota = v; })));
  inspectorEl.appendChild(fieldRow('場上上限', numberInput(node.maxAlive, (v) => { node.maxAlive = v; })));
  inspectorEl.appendChild(fieldRow('補怪門檻', numberInput(node.spawnThreshold, (v) => { node.spawnThreshold = v; })));
  inspectorEl.appendChild(fieldRow('生怪間隔（秒）', numberInput(node.spawnInterval, (v) => { node.spawnInterval = v; })));

  const spawnsTitle = document.createElement('div');
  spawnsTitle.className = 'section-title';
  spawnsTitle.style.marginTop = '12px';
  spawnsTitle.textContent = '敵人配置（敵種 + 權重）';
  inspectorEl.appendChild(spawnsTitle);

  node.spawns.forEach((entry, si) => {
    const row = document.createElement('div');
    row.className = 'spawn-entry';

    const sel = document.createElement('select');
    for (const t of ENEMY_TYPES) {
      const opt = document.createElement('option');
      opt.value = t; // JSON 值維持英文 enum
      opt.textContent = enemyTypeLabel(t); // 顯示中文（英文）
      if (t === entry.enemyType) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      entry.enemyType = sel.value as EnemyType;
    });
    row.appendChild(sel);

    const w = document.createElement('input');
    w.type = 'number';
    w.step = 'any';
    w.value = String(entry.weight);
    w.title = '權重';
    w.addEventListener('input', () => {
      const v = Number(w.value);
      entry.weight = Number.isFinite(v) ? v : 0;
    });
    row.appendChild(w);

    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      node.spawns.splice(si, 1);
      renderInspector();
    });
    row.appendChild(del);

    inspectorEl.appendChild(row);
  });

  const addBtn = document.createElement('button');
  addBtn.textContent = '+ 新增敵種';
  addBtn.addEventListener('click', () => {
    node.spawns.push({ enemyType: ENEMY_TYPES[0], weight: 1 });
    renderInspector();
  });
  inspectorEl.appendChild(addBtn);
}

function renderRewardInspector(node: RewardNodeData): void {
  inspectorEl.appendChild(
    fieldRow('獎勵預設名', textInput(node.rewardPresetName ?? '', (v) => {
      if (v.length === 0) delete node.rewardPresetName;
      else node.rewardPresetName = v;
    })),
  );
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = '留空 = 用預設固定獎勵（Unity 共同獎勵）。';
  inspectorEl.appendChild(hint);
}

function renderEventInspector(node: EventNodeData): void {
  inspectorEl.appendChild(
    fieldRow('事件預設名', textInput(node.eventPresetName, (v) => { node.eventPresetName = v; })),
  );
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = '例：Guard60（守護事件預設名）。必填。';
  inspectorEl.appendChild(hint);
}

// ---- 統一重繪 -------------------------------------------------------------

function renderAll(): void {
  renderLevelList();
  renderNodeList();
  renderInspector();
}

// ---- 載入 / 匯出 ----------------------------------------------------------

/** 把驗證過的 LevelsFile 套進編輯狀態。 */
function loadIntoState(file: LevelsFile): void {
  state.version = file.version;
  state.levels = file.levels;
  state.selectedLevel = file.levels.length > 0 ? 0 : -1;
  state.selectedNode = -1;
  renderAll();
}

async function loadDefault(): Promise<void> {
  // 編輯器頁位於 /editor/，預設關卡檔在網站根的 assets/data/ →
  // 用相對路徑上一層。base:'./' 下對 GitHub Pages 子路徑亦正確。
  const url = '../assets/data/levels.json';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw: unknown = await res.json();
    const file = assertValidLevels(raw); // 大聲失敗：不合法直接拋
    loadIntoState(file);
    setStatus(`已載入預設 ${url}：${file.levels.length} 關。`, 'ok');
  } catch (e) {
    setStatus(`載入預設失敗：${(e as Error).message}`, 'err');
  }
}

function loadFromFile(fileText: string, fileName: string): void {
  let raw: unknown;
  try {
    raw = JSON.parse(fileText);
  } catch (e) {
    setStatus(`檔案 ${fileName} 不是合法 JSON：${(e as Error).message}`, 'err');
    return;
  }
  const result = validateLevels(raw);
  if (!result.ok) {
    setStatus(`檔案 ${fileName} 驗證失敗（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return;
  }
  loadIntoState(result.data);
  setStatus(`已載入 ${fileName}：${result.data.levels.length} 關。`, 'ok');
}

/** 匯出：先驗證（assertValidLevels 等效——用 validateLevels 攔錯顯示），過了才下載。 */
function exportJson(): void {
  const candidate: LevelsFile = { version: state.version, levels: state.levels };
  const result = validateLevels(candidate);
  if (!result.ok) {
    setStatus(`匯出被擋下：資料不合法（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return;
  }
  // 再過一次 assertValidLevels 當最後保險（與載入器同一套）。
  const validated = assertValidLevels(candidate);
  const text = JSON.stringify(validated, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'levels.json';
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`驗證通過，已下載 levels.json（${validated.levels.length} 關）。`, 'ok');
}

// ---- 試玩（iframe + postMessage + ready 交握） ----------------------------
//
// 流程（協定見 @/config/previewProtocol）：
//  1. 建 iframe src=../?preview=1，掛 window message listener，等遊戲送 preview-ready。
//  2. 收 ready → 比對 schemaVersion vs 編輯器 LEVELS_SCHEMA_VERSION，不符攔下不送資料。
//  3. 一致 → assertValidLevels(當前 levels) 過 → postMessage preview-levels（targetOrigin=自身 origin）。
//  4. 收 preview-error → 在編輯器 UI 顯示 reason。
//  5. ready 逾時（5 秒）→ 顯示載入逾時（覆蓋 iframe 載入失敗/遊戲 crash：遊戲死了發不出 error）。
//  6. origin 檢查：只收 event.origin === location.origin。
//  7. 支援邊改邊試玩：試玩開著可「重新套用」再送一次（遊戲端會帶新關卡重啟）。

const READY_TIMEOUT_MS = 5000;

interface PreviewSession {
  iframe: HTMLIFrameElement;
  ready: boolean;
  readyTimer: number | null;
  onMessage: (e: MessageEvent) => void;
}

let preview: PreviewSession | null = null;

/** 編輯器頁在 /editor/，遊戲頁在上一層；帶 ?preview=1。 */
function gamePreviewUrl(): string {
  return `../?${PREVIEW_QUERY_FLAG}=1`;
}

function setPreviewMsg(msg: string): void {
  $('preview-msg').textContent = msg;
}

function showPreviewButtons(active: boolean): void {
  ($('btn-preview') as HTMLButtonElement).hidden = active;
  ($('btn-preview-reapply') as HTMLButtonElement).hidden = !active;
  ($('btn-preview-close') as HTMLButtonElement).hidden = !active;
}

/** 開始試玩：建 iframe、掛 listener、起 ready 逾時。 */
function startPreview(): void {
  if (state.levels.length === 0) {
    setStatus('沒有可試玩的關卡，請先新增或載入關卡。', 'err');
    return;
  }
  // 送出前先自我驗證：不合法就別開試玩（大聲擋下）。
  const check = validateLevels({ version: state.version, levels: state.levels });
  if (!check.ok) {
    setStatus(
      `試玩被擋下：資料不合法（${check.errors.length} 項）：\n${check.errors.map((m) => `  - ${m}`).join('\n')}`,
      'err',
    );
    return;
  }

  closePreview(); // 若已有 session，先收乾淨

  const overlay = $('preview-overlay') as HTMLDivElement;
  const host = $('preview-frame-host');
  host.innerHTML = '';
  overlay.hidden = false;
  setPreviewMsg('遊戲載入中…');
  showPreviewButtons(true);

  const iframe = document.createElement('iframe');
  iframe.src = gamePreviewUrl();
  host.appendChild(iframe);

  const onMessage = (e: MessageEvent): void => handlePreviewMessage(e);
  window.addEventListener('message', onMessage);

  const readyTimer = window.setTimeout(() => {
    if (preview && !preview.ready) {
      setPreviewMsg('遊戲載入逾時，請重整頁面後再試。');
      setStatus('試玩失敗：遊戲載入逾時（iframe 未回報 preview-ready）。', 'err');
    }
  }, READY_TIMEOUT_MS);

  preview = { iframe, ready: false, readyTimer, onMessage };
}

/** 重新套用：試玩開著時把當前編輯的關卡再送一次（邊改邊試玩）。 */
function reapplyPreview(): void {
  if (!preview) {
    startPreview();
    return;
  }
  if (!preview.ready) {
    setStatus('遊戲尚未就緒，請稍候或重整。', 'err');
    return;
  }
  sendLevelsToPreview();
}

/** 關閉試玩：移除 iframe、解除 listener、清 timer。 */
function closePreview(): void {
  if (!preview) {
    ($('preview-overlay') as HTMLDivElement).hidden = true;
    showPreviewButtons(false);
    return;
  }
  window.removeEventListener('message', preview.onMessage);
  if (preview.readyTimer !== null) window.clearTimeout(preview.readyTimer);
  preview.iframe.remove();
  preview = null;
  ($('preview-overlay') as HTMLDivElement).hidden = true;
  setPreviewMsg('');
  showPreviewButtons(false);
}

/** 處理來自 iframe 的協定訊息。 */
function handlePreviewMessage(e: MessageEvent): void {
  // ④ origin 檢查：非同源忽略。
  if (e.origin !== window.location.origin) return;
  if (!preview) return;
  const data = e.data as PreviewMessage | undefined;
  if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;

  switch (data.type) {
    case PREVIEW_MSG.ready: {
      preview.ready = true;
      if (preview.readyTimer !== null) {
        window.clearTimeout(preview.readyTimer);
        preview.readyTimer = null;
      }
      // ② 版本歪斜早攔：比對 schemaVersion。
      if (data.schemaVersion !== LEVELS_SCHEMA_VERSION) {
        const reason = `編輯器（v${LEVELS_SCHEMA_VERSION}）與遊戲（v${data.schemaVersion}）schema 版本不符，請重整頁面。`;
        setPreviewMsg(reason);
        setStatus(`試玩中止：${reason}`, 'err');
        return; // 不送資料
      }
      sendLevelsToPreview();
      break;
    }
    case PREVIEW_MSG.error: {
      // ④ 在編輯器 UI 顯示遊戲端拒絕原因。
      setPreviewMsg(`遊戲端拒絕關卡：${data.reason}`);
      setStatus(`試玩失敗（遊戲端驗證）：${data.reason}`, 'err');
      break;
    }
    default:
      break; // preview-levels 是編輯器→遊戲，不會收到
  }
}

/** ③ 送資料：assertValidLevels 驗過 → postMessage preview-levels（targetOrigin=自身 origin）。 */
function sendLevelsToPreview(): void {
  if (!preview) return;
  let file: LevelsFile;
  try {
    file = assertValidLevels({ version: state.version, levels: state.levels });
  } catch (err) {
    const reason = (err as Error).message;
    setPreviewMsg('關卡資料不合法，未送出。');
    setStatus(`試玩被擋下：${reason}`, 'err');
    return;
  }
  const win = preview.iframe.contentWindow;
  if (!win) {
    setStatus('試玩失敗：iframe 尚未就緒。', 'err');
    return;
  }
  win.postMessage(
    { type: PREVIEW_MSG.levels, payload: file },
    window.location.origin, // 同源 targetOrigin
  );
  setPreviewMsg('已送出關卡，遊戲執行中。改動後可按「重新套用」。');
  setStatus(`已送出 ${file.levels.length} 關到試玩。`, 'ok');
}

// ---- 事件綁定 -------------------------------------------------------------

function addLevel(): void {
  const n = state.levels.length;
  state.levels.push({ id: `Level${n}`, name: `第 ${n + 1} 關`, nodes: [] });
  state.selectedLevel = state.levels.length - 1;
  state.selectedNode = -1;
  renderAll();
  setStatus('已新增關卡。', 'info');
}

function addNode(type: LevelNodeData['nodeType']): void {
  const lvl = currentLevel();
  if (!lvl) {
    setStatus('請先選/新增一個關卡再加節點。', 'err');
    return;
  }
  lvl.nodes.push(makeNode(type));
  state.selectedNode = lvl.nodes.length - 1;
  renderAll();
}

function bindUI(): void {
  $('schema-version').textContent = `schema v${LEVELS_SCHEMA_VERSION}`;
  $('btn-load-default').addEventListener('click', () => void loadDefault());
  $('btn-export').addEventListener('click', exportJson);
  $('btn-add-level').addEventListener('click', addLevel);
  $('btn-preview').addEventListener('click', startPreview);
  $('btn-preview-reapply').addEventListener('click', reapplyPreview);
  $('btn-preview-close').addEventListener('click', closePreview);

  const fileInput = $<HTMLInputElement>('file-input');
  $('btn-load-file').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => loadFromFile(String(reader.result), f.name);
    reader.readAsText(f);
    fileInput.value = ''; // 允許重複載入同檔
  });

  document.querySelectorAll<HTMLButtonElement>('[data-add-node]').forEach((btn) => {
    btn.addEventListener('click', () => {
      addNode(btn.dataset.addNode as LevelNodeData['nodeType']);
    });
  });
}

bindUI();
renderAll();
