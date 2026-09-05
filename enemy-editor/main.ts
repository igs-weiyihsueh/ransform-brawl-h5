/**
 * 怪物編輯器（獨立進入點）— 可視化編輯 ENEMY_AI 敵人設定。
 *
 * 架構：獨立 Vite entry（enemy-editor/index.html），與遊戲分開打包，純前端零 Phaser。
 * 只 import enemySchema（其只讀 import enemyConfig 的型別 + ENEMY_AI 值當初值，無遊戲 runtime）。
 *
 * 功能：列敵人 → 選一隻 → Inspector 編各欄位（數字/滑桿、attackKind 下拉、characterKey、
 * attack 子欄位）→ canvas 同心圓即時預覽 detectRange/attackRange/attack.radius（×PPU）→
 * assertValidEnemies 驗過才匯出 JSON；可載入 JSON、新增敵人（複製一筆改 key）、Ctrl+Z undo。
 */
import {
  ENEMY_SCHEMA_VERSION,
  ATTACK_KINDS,
  assertValidEnemies,
  defaultEnemyFile,
  validateEnemies,
  type EnemyAIConfig,
  type EnemyAttackKind,
  type EnemyFile,
} from './enemySchema';

/** Pixels-Per-Unit：對照 gameConfig.PPU=100（本檔自持常數，不 import 遊戲檔）。 */
const PPU = 100;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

// ---- 狀態 -----------------------------------------------------------------

function cloneFile(f: EnemyFile): EnemyFile {
  return JSON.parse(JSON.stringify(f)) as EnemyFile;
}

let file: EnemyFile = defaultEnemyFile();
let selectedKey: string | null = Object.keys(file.enemies)[0] ?? null;

// ---- Undo / Redo ----------------------------------------------------------

const HISTORY_CAP = 50;
let undoStack: EnemyFile[] = [];
let redoStack: EnemyFile[] = [];
let pendingSnapshot: string | null = null;

function beginEdit(): void { pendingSnapshot = JSON.stringify(file); }
function commitEdit(): void {
  if (pendingSnapshot === null) return;
  if (JSON.stringify(file) !== pendingSnapshot) {
    undoStack.push(JSON.parse(pendingSnapshot) as EnemyFile);
    if (undoStack.length > HISTORY_CAP) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }
  pendingSnapshot = null;
}
function pushHistory(): void {
  undoStack.push(cloneFile(file));
  if (undoStack.length > HISTORY_CAP) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}
function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(cloneFile(file));
  file = prev;
  ensureSelection();
  renderAll();
  updateHistoryButtons();
  setStatus('已復原（Undo）。', 'info');
}
function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(cloneFile(file));
  file = next;
  ensureSelection();
  renderAll();
  updateHistoryButtons();
  setStatus('已重做（Redo）。', 'info');
}
function updateHistoryButtons(): void {
  ($('btn-undo') as HTMLButtonElement).disabled = undoStack.length === 0;
  ($('btn-redo') as HTMLButtonElement).disabled = redoStack.length === 0;
}

// ---- 共用 -----------------------------------------------------------------

function setStatus(msg: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  const el = $('status');
  el.textContent = msg;
  el.className = kind === 'ok' ? 'status-ok' : kind === 'err' ? 'status-err' : '';
}

const ENEMY_LABELS: Record<string, string> = {
  Enemy_Rush: '衝鋒兵', Enemy_Ranged: '遠程兵', Enemy_Elite: '菁英兵',
};
function enemyLabel(key: string): string {
  const zh = ENEMY_LABELS[key];
  return zh ? `${zh}（${key}）` : key;
}

function currentEnemy(): EnemyAIConfig | undefined {
  return selectedKey ? file.enemies[selectedKey] : undefined;
}

function ensureSelection(): void {
  if (!selectedKey || !file.enemies[selectedKey]) {
    selectedKey = Object.keys(file.enemies)[0] ?? null;
  }
}

// ---- 敵人清單 -------------------------------------------------------------

function renderList(): void {
  const list = $('enemy-list');
  list.innerHTML = '';
  for (const key of Object.keys(file.enemies)) {
    const item = document.createElement('div');
    item.className = 'list-item' + (key === selectedKey ? ' selected' : '');
    const label = document.createElement('span');
    label.className = 'grow';
    label.textContent = enemyLabel(key);
    item.appendChild(label);

    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = '刪除敵人';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Object.keys(file.enemies).length <= 1) {
        setStatus('至少要保留一隻敵人。', 'err');
        return;
      }
      pushHistory();
      delete file.enemies[key];
      if (selectedKey === key) selectedKey = Object.keys(file.enemies)[0] ?? null;
      renderAll();
    });
    item.appendChild(del);

    item.addEventListener('click', () => { selectedKey = key; renderAll(); });
    list.appendChild(item);
  }
}

// ---- Inspector ------------------------------------------------------------

function numberRow(
  label: string, value: number, onChange: (v: number) => void,
  opts: { min?: number; max?: number; step?: number; slider?: boolean } = {},
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  row.appendChild(lab);

  const input = document.createElement('input');
  input.type = opts.slider ? 'range' : 'number';
  input.step = String(opts.step ?? 'any');
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  input.value = String(value);
  const commit = (): void => commitEdit();
  input.addEventListener('focus', () => beginEdit());
  input.addEventListener('pointerdown', () => beginEdit()); // slider 拖動
  input.addEventListener('change', commit);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (!Number.isFinite(v)) return;
    onChange(v);
    if (valEl) valEl.textContent = fmt(v);
    renderPreview();
    renderList();
  });
  row.appendChild(input);

  let valEl: HTMLSpanElement | null = null;
  if (opts.slider) {
    valEl = document.createElement('span');
    valEl.className = 'val';
    valEl.textContent = fmt(value);
    row.appendChild(valEl);
  }
  return row;
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function textRow(label: string, value: string, onChange: (v: string) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('focus', () => beginEdit());
  input.addEventListener('change', () => commitEdit());
  input.addEventListener('input', () => { onChange(input.value); });
  row.appendChild(lab);
  row.appendChild(input);
  return row;
}

function selectRow(label: string, value: string, options: readonly string[], onChange: (v: string) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const sel = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    if (o === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    beginEdit();
    onChange(sel.value);
    commitEdit();
    renderInspector();
    renderPreview();
  });
  row.appendChild(lab);
  row.appendChild(sel);
  return row;
}

function renderInspector(): void {
  const insp = $('inspector');
  insp.innerHTML = '';
  const e = currentEnemy();
  if (!e) { insp.innerHTML = '<div class="hint">左側選一隻敵人以編輯。</div>'; return; }

  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = `${selectedKey ? enemyLabel(selectedKey) : ''}`;
  insp.appendChild(title);

  insp.appendChild(textRow('characterKey', e.characterKey, (v) => { e.characterKey = v; }));
  insp.appendChild(numberRow('生命 hp', e.hp, (v) => { e.hp = v; }, { min: 1, step: 1 }));
  insp.appendChild(numberRow('移速 moveSpeed', e.moveSpeed, (v) => { e.moveSpeed = v; }, { min: 0, max: 10, step: 0.1, slider: true }));
  insp.appendChild(numberRow('偵測 detectRange', e.detectRange, (v) => { e.detectRange = v; }, { min: 0, max: 40, step: 0.5, slider: true }));
  insp.appendChild(numberRow('攻擊範圍 attackRange', e.attackRange, (v) => { e.attackRange = v; }, { min: 0, max: 40, step: 0.5, slider: true }));
  insp.appendChild(numberRow('蓄力 chargeTime', e.chargeTime, (v) => { e.chargeTime = v; }, { min: 0, max: 5, step: 0.1, slider: true }));
  insp.appendChild(numberRow('冷卻 attackCooldown', e.attackCooldown, (v) => { e.attackCooldown = v; }, { min: 0, max: 10, step: 0.1, slider: true }));
  insp.appendChild(numberRow('硬直 hitStun', e.hitStun, (v) => { e.hitStun = v; }, { min: 0, max: 3, step: 0.05, slider: true }));
  insp.appendChild(numberRow('擊退力 knockbackForce', e.knockbackForce, (v) => { e.knockbackForce = v; }, { min: 0, max: 10, step: 0.1, slider: true }));

  insp.appendChild(selectRow('攻擊方式 attackKind', e.attackKind, ATTACK_KINDS as readonly string[], (v) => {
    e.attackKind = v as EnemyAttackKind;
    if (v === 'projectile' && e.projectileSpeed === undefined) e.projectileSpeed = 8;
  }));
  if (e.attackKind === 'projectile') {
    insp.appendChild(numberRow('射彈速度 projectileSpeed', e.projectileSpeed ?? 8, (v) => { e.projectileSpeed = v; }, { min: 0, max: 30, step: 0.5, slider: true }));
  }

  // attack 子欄位
  const at = document.createElement('div');
  at.className = 'section-title';
  at.textContent = '攻擊判定 attack';
  insp.appendChild(at);

  insp.appendChild(selectRow('形狀 shapeType', e.attack.shapeType, ['circle', 'rectangle'], (v) => {
    e.attack.shapeType = v as 'circle' | 'rectangle';
  }));
  if (e.attack.shapeType === 'circle') {
    insp.appendChild(numberRow('半徑 radius', e.attack.radius ?? 0.5, (v) => { e.attack.radius = v; }, { min: 0, max: 5, step: 0.05, slider: true }));
  } else {
    insp.appendChild(numberRow('長 length', e.attack.length ?? 1, (v) => { e.attack.length = v; }, { min: 0, max: 5, step: 0.05, slider: true }));
    insp.appendChild(numberRow('寬 width', e.attack.width ?? 1, (v) => { e.attack.width = v; }, { min: 0, max: 5, step: 0.05, slider: true }));
  }
  insp.appendChild(numberRow('offsetX', e.attack.offsetX, (v) => { e.attack.offsetX = v; }, { min: -3, max: 3, step: 0.05, slider: true }));
  insp.appendChild(numberRow('offsetY', e.attack.offsetY, (v) => { e.attack.offsetY = v; }, { min: -3, max: 3, step: 0.05, slider: true }));
  insp.appendChild(numberRow('傷害 damage', e.attack.damage, (v) => { e.attack.damage = v; }, { min: 0, step: 1 }));
  insp.appendChild(numberRow('擊退 knockback', e.attack.knockback, (v) => { e.attack.knockback = v; }, { min: 0, max: 10, step: 0.1, slider: true }));
  insp.appendChild(numberRow('前搖 hitDelay', e.attack.hitDelay, (v) => { e.attack.hitDelay = v; }, { min: 0, max: 3, step: 0.05, slider: true }));
}

// ---- 預覽（同心圓，×PPU）--------------------------------------------------

function renderPreview(): void {
  const canvas = $('preview') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H / 2;

  const e = currentEnemy();
  if (!e) return;

  // 依 detectRange 決定顯示縮放：讓最大圈(detectRange)約佔畫布 42%。
  const detectPx = e.detectRange * PPU;
  const maxPx = Math.max(detectPx, e.attackRange * PPU, 40);
  const viewScale = (Math.min(W, H) * 0.42) / maxPx;

  const ring = (radiusUnit: number, color: string, labelText: string): void => {
    const rPx = radiusUnit * PPU * viewScale;
    if (rPx <= 0) return;
    ctx.beginPath();
    ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '12px Arial, "Microsoft JhengHei", sans-serif';
    ctx.fillText(labelText, cx + 4, cy - rPx - 4);
  };

  // 偵測範圍（大）→ 攻擊範圍 → 攻擊判定圈
  ring(e.detectRange, getCss('--detect'), `偵測 ${fmt(e.detectRange)}u`);
  ring(e.attackRange, getCss('--attackR'), `攻擊 ${fmt(e.attackRange)}u`);

  // 攻擊判定圈：以 offset 為中心（面向朝右示意），circle 用 radius；rectangle 畫矩形。
  const offX = e.attack.offsetX * PPU * viewScale;
  const offY = e.attack.offsetY * PPU * viewScale;
  ctx.strokeStyle = getCss('--hit');
  ctx.lineWidth = 2;
  if (e.attack.shapeType === 'circle') {
    const rPx = (e.attack.radius ?? 0) * PPU * viewScale;
    if (rPx > 0) {
      ctx.beginPath();
      ctx.arc(cx + offX, cy + offY, rPx, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    const lPx = (e.attack.length ?? 0) * PPU * viewScale;
    const wPx = (e.attack.width ?? 0) * PPU * viewScale;
    ctx.strokeRect(cx + offX - lPx / 2, cy + offY - wPx / 2, lPx, wPx);
  }
  ctx.fillStyle = getCss('--hit');
  ctx.font = '12px Arial, "Microsoft JhengHei", sans-serif';
  ctx.fillText('判定', cx + offX + 4, cy + offY - 4);

  // 敵人本體（中心點 + 面向箭頭）
  ctx.fillStyle = '#e6e6f0';
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e6e6f0';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + 22, cy);
  ctx.stroke();

  // 比例尺
  ctx.fillStyle = '#9a9ab5';
  ctx.font = '11px Arial, sans-serif';
  ctx.fillText(`顯示比例 ×${viewScale.toFixed(2)}（1 unit = ${PPU}px 遊戲內）`, 8, H - 10);
}

/** 讀 CSS 變數色值。 */
function getCss(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#fff';
}

// ---- 載入 / 匯出 / 新增 / 重設 --------------------------------------------

function loadIntoState(f: EnemyFile, recordHistory = false): void {
  if (recordHistory) pushHistory();
  file = f;
  ensureSelection();
  renderAll();
}

async function loadDefault(): Promise<void> {
  // 預設直接用打包進來的 ENEMY_AI（權威值），不需 fetch。
  loadIntoState(defaultEnemyFile(), true);
  setStatus('已載入預設（來自遊戲 ENEMY_AI 權威值）。', 'ok');
}

function loadFromFile(text: string, fileName: string): void {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch (e) { setStatus(`檔案 ${fileName} 不是合法 JSON：${(e as Error).message}`, 'err'); return; }
  const result = validateEnemies(raw);
  if (!result.ok) {
    setStatus(`檔案 ${fileName} 驗證失敗（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return;
  }
  loadIntoState(result.data, true);
  setStatus(`已載入 ${fileName}：${Object.keys(result.data.enemies).length} 隻敵人。`, 'ok');
}

function exportJson(): void {
  const result = validateEnemies(file);
  if (!result.ok) {
    setStatus(`匯出被擋下：資料不合法（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return;
  }
  const validated = assertValidEnemies(file);
  const text = JSON.stringify(validated, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'enemyConfig.json';
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`驗證通過，已下載 enemyConfig.json（${Object.keys(validated.enemies).length} 隻）。`, 'ok');
}

function addEnemy(): void {
  const base = currentEnemy();
  if (!base) { setStatus('請先選一隻敵人再複製。', 'err'); return; }
  pushHistory();
  // 產生不重複的新 key。
  let n = 1;
  let key = `${selectedKey}_copy`;
  while (file.enemies[key]) { n += 1; key = `${selectedKey}_copy${n}`; }
  file.enemies[key] = JSON.parse(JSON.stringify(base)) as EnemyAIConfig;
  selectedKey = key;
  renderAll();
  setStatus(`已新增敵人「${key}」（複製自「${base.characterKey}」），可改 key/數值。`, 'info');
}

function resetDefault(): void {
  loadIntoState(defaultEnemyFile(), true);
  setStatus('已重設為預設值。', 'info');
}

// ---- 統一重繪 -------------------------------------------------------------

function renderAll(): void {
  renderList();
  renderInspector();
  renderPreview();
}

// ---- 綁定 -----------------------------------------------------------------

function bindUI(): void {
  $('schema-version').textContent = `schema v${ENEMY_SCHEMA_VERSION}`;
  $('btn-load-default').addEventListener('click', () => void loadDefault());
  $('btn-export').addEventListener('click', exportJson);
  $('btn-reset').addEventListener('click', resetDefault);
  $('btn-add').addEventListener('click', addEnemy);
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);

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

  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });
  updateHistoryButtons();
}

bindUI();
renderAll();
