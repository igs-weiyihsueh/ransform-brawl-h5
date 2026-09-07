/**
 * 地圖邊界編輯器（獨立進入點 + 遊戲內 overlay tab）— 調整遊玩範圍矩形邊界（Unity 世界單位，中心原點）。
 *
 * 架構（對齊 dash/hitfeel 等編輯器）：獨立 Vite entry（mapbounds-editor/index.html），與遊戲分開打包。
 * 只 import mapBoundsSchema（零 Phaser，型別+驗證+resolve）+ editorStore（套用契約）。
 * 功能：4 欄 minX/maxX/minY/maxY slider+數字（unit）→ canvas 可視化預覽（畫場景框+邊界框+面板下界參考）→
 *      載入 JSON / 下載 JSON / 套用到遊戲（localStorage override）/ 清除 / 開啟讀 override 回顯。
 *
 * ★0/負座標合法（unit 中心原點，minX 常負/可 0）；但 minX<maxX、minY<maxY 必須（clampToValid 防反轉）。
 */
import {
  MAP_BOUNDS_SCHEMA_VERSION,
  validateMapBounds,
  type MapBoundsFile,
  type MapBoundsUnits,
} from '@/config/mapBoundsSchema';
import {
  EDITOR_STORE_KEYS,
  applyToGame,
  clearOverride,
  loadOverride,
} from '@/config/editorStore';

const PPU = 100; // 對照 gameConfig.PPU（本檔自持，不 import 遊戲檔）
const GAME_W = 1920;
const GAME_H = 1080;
// 下方面板上緣 Y（螢幕座標，對照 mapConfig.PANEL_TOP_Y = GAME_H - 16 - 120 = 944）——預覽參考線。
const PANEL_TOP_Y = GAME_H - 16 - 120;

/** 打包預設邊界（對照 mapConfig.MAP_BOUNDS_UNITS；editor 初值 / 重設用）。 */
const DEFAULT_BOUNDS: MapBoundsUnits = { minX: -8, maxX: 8, minY: -4, maxY: 4 };

let editorRoot: HTMLElement = document.body;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = editorRoot.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

/** 目前編輯中的邊界（unit）。 */
let bounds: MapBoundsUnits = { ...DEFAULT_BOUNDS };

function setStatus(msg: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  const el = $('status');
  el.textContent = msg;
  el.className = kind === 'ok' ? 'status-ok' : kind === 'err' ? 'status-err' : '';
}

/** 保證 min<max（編輯時即時防反轉：改 min 撞 max 時把 min 壓在 max 之下一格；反之亦然）。純顯示層防呆，validate 仍把關。 */
function ensureOrder(): void {
  const EPS = 0.1;
  if (bounds.minX >= bounds.maxX) bounds.minX = bounds.maxX - EPS;
  if (bounds.minY >= bounds.maxY) bounds.minY = bounds.maxY - EPS;
}

/** 一列：label + 拖軸 + 數字框（雙向同步，parseFloat 小數，超界 clamp；★可負可 0）。 */
function numberRow(
  label: string,
  get: () => number,
  set: (v: number) => void,
  opts: { min: number; max: number; step: number },
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(opts.min); slider.max = String(opts.max); slider.step = String(opts.step);
  slider.value = String(get());
  const num = document.createElement('input');
  num.type = 'number';
  num.min = String(opts.min); num.max = String(opts.max); num.step = 'any';
  num.value = String(get());
  const clamp = (v: number): number => Math.min(opts.max, Math.max(opts.min, v));
  const commit = (raw: string): void => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    const c = clamp(v);
    set(c);
    ensureOrder();
    buildInspector(); // 重繪（ensureOrder 可能改到相鄰欄）
    render();
  };
  slider.addEventListener('input', () => commit(slider.value));
  num.addEventListener('change', () => commit(num.value));
  row.appendChild(lab); row.appendChild(slider); row.appendChild(num);
  return row;
}

function buildInspector(): void {
  const insp = $('bounds-inspector');
  insp.innerHTML = '';
  insp.appendChild(numberRow('minX (unit)', () => bounds.minX, (v) => { bounds.minX = v; }, { min: -12, max: 12, step: 0.5 }));
  insp.appendChild(numberRow('maxX (unit)', () => bounds.maxX, (v) => { bounds.maxX = v; }, { min: -12, max: 12, step: 0.5 }));
  insp.appendChild(numberRow('minY (unit)', () => bounds.minY, (v) => { bounds.minY = v; }, { min: -8, max: 8, step: 0.5 }));
  insp.appendChild(numberRow('maxY (unit)', () => bounds.maxY, (v) => { bounds.maxY = v; }, { min: -8, max: 8, step: 0.5 }));
}

/** unit（中心原點）→ 螢幕像素（左上原點）：x=GAME_W/2+unit×PPU、y=GAME_H/2+unit×PPU。 */
function unitToPxX(u: number): number { return GAME_W / 2 + u * PPU; }
function unitToPxY(u: number): number { return GAME_H / 2 + u * PPU; }

/** 可視化預覽：畫整個遊戲畫面框（縮到 canvas）+ 目前邊界矩形 + 面板下界參考線。 */
function render(): void {
  const cv = $<HTMLCanvasElement>('preview');
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  const s = W / GAME_W; // 縮放：整個 1920 寬塞進 canvas 寬
  ctx.clearRect(0, 0, W, H);
  // 遊戲畫面框（1920×1080 縮放）。
  ctx.fillStyle = '#10101c'; ctx.fillRect(0, 0, GAME_W * s, GAME_H * s);
  ctx.strokeStyle = '#3a3a5c'; ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, GAME_W * s, GAME_H * s);
  // 中心十字（原點參考）。
  ctx.strokeStyle = '#2c2c48';
  ctx.beginPath(); ctx.moveTo(GAME_W / 2 * s, 0); ctx.lineTo(GAME_W / 2 * s, GAME_H * s);
  ctx.moveTo(0, GAME_H / 2 * s); ctx.lineTo(GAME_W * s, GAME_H / 2 * s); ctx.stroke();
  // 面板下界參考線（玩家/敵人實際下界會收到面板上緣之上）。
  ctx.strokeStyle = '#ff6c7a'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, PANEL_TOP_Y * s); ctx.lineTo(GAME_W * s, PANEL_TOP_Y * s); ctx.stroke();
  ctx.setLineDash([]);
  // 目前邊界矩形（unit→px→canvas）。
  const x1 = unitToPxX(bounds.minX) * s, x2 = unitToPxX(bounds.maxX) * s;
  const y1 = unitToPxY(bounds.minY) * s, y2 = unitToPxY(bounds.maxY) * s;
  ctx.fillStyle = 'rgba(108,140,255,0.18)';
  ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  ctx.strokeStyle = '#6c8cff'; ctx.lineWidth = 2;
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  // 尺寸標註。
  ctx.fillStyle = '#9a9ab5'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
  const wUnit = (bounds.maxX - bounds.minX).toFixed(1);
  const hUnit = (bounds.maxY - bounds.minY).toFixed(1);
  ctx.fillText(`遊玩範圍 ${wUnit}×${hUnit} unit（${Math.round((bounds.maxX - bounds.minX) * PPU)}×${Math.round((bounds.maxY - bounds.minY) * PPU)} px）`, 6, GAME_H * s - 8);
  ctx.fillStyle = '#ff9d9d';
  ctx.fillText('紅虛線=下方面板上緣（玩家/敵人下界會收到此線之上）', 6, GAME_H * s - 22);
}

function refreshAll(): void { buildInspector(); render(); }

/** 目前 bounds 包成匯出檔。 */
function currentFile(): MapBoundsFile {
  return { version: MAP_BOUNDS_SCHEMA_VERSION, bounds: { ...bounds } };
}

/** 套用到遊戲：validate 過才存 localStorage override。 */
function applyBounds(andReturn: boolean, standalone: boolean): boolean {
  const file = currentFile();
  const res = validateMapBounds(file);
  if (!res.ok) { setStatus(`套用失敗（驗證未過）：\n${res.errors.join('\n')}`, 'err'); return false; }
  const ok = applyToGame(EDITOR_STORE_KEYS.mapBounds, res.data);
  if (!ok) { setStatus('套用失敗：瀏覽器 localStorage 不可用。', 'err'); return false; }
  if (andReturn && standalone) {
    setStatus('✅ 已套用，返回遊戲中…', 'ok');
    window.location.href = '../';
    return true;
  }
  setStatus(andReturn
    ? '✅ 已套用到遊戲（存入瀏覽器）。重開遊戲即生效（overlay 內請關閉面板重開遊戲）。'
    : '✅ 已套用到遊戲（存入瀏覽器）。重開遊戲即生效。', 'ok');
  return true;
}

/** 匯入回顯：開啟優先讀 override 回填 bounds；無/壞則打包預設。 */
function initLoad(): void {
  const raw = loadOverride(EDITOR_STORE_KEYS.mapBounds);
  if (raw !== null) {
    const r = validateMapBounds(raw);
    if (r.ok) {
      bounds = { ...r.data.bounds };
      refreshAll();
      setStatus('已載入你上次套用到遊戲的地圖邊界（可繼續編）。', 'ok');
      return;
    }
    setStatus('已套用的地圖邊界驗證失敗，退回打包預設。', 'err');
  }
  bounds = { ...DEFAULT_BOUNDS };
  refreshAll();
}

function bindUI(standalone: boolean): void {
  $('btn-load-default').addEventListener('click', () => { bounds = { ...DEFAULT_BOUNDS }; refreshAll(); setStatus('已載入打包預設地圖邊界。', 'info'); });
  $('btn-reset').addEventListener('click', () => { bounds = { ...DEFAULT_BOUNDS }; refreshAll(); setStatus('已重設為預設值。', 'info'); });

  // 載入 JSON 檔（對齊其他編輯器上傳即套用）。
  $('btn-load-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let json: unknown;
      try { json = JSON.parse(String(reader.result)); }
      catch (err) { setStatus(`不是合法 JSON：${(err as Error).message}`, 'err'); return; }
      // 接受 {version,bounds} 或裸 {minX,maxX,minY,maxY}（自動包 version）。
      const wrapped = (json && typeof json === 'object' && 'bounds' in (json as object))
        ? json
        : { version: MAP_BOUNDS_SCHEMA_VERSION, bounds: json };
      const r = validateMapBounds(wrapped);
      if (!r.ok) { setStatus(`載入失敗（驗證未過）：\n${r.errors.join('\n')}`, 'err'); return; }
      bounds = { ...r.data.bounds };
      refreshAll();
      const applied = applyToGame(EDITOR_STORE_KEYS.mapBounds, r.data);
      setStatus(applied ? '已載入 JSON 並套用到遊戲（重開仍在）。' : '已載入 JSON（套用失敗：localStorage 不可用）。', applied ? 'ok' : 'err');
    };
    reader.readAsText(f);
    (e.target as HTMLInputElement).value = '';
  });

  $('btn-export').addEventListener('click', () => {
    const res = validateMapBounds(currentFile());
    if (!res.ok) { setStatus(`驗證失敗：\n${res.errors.join('\n')}`, 'err'); return; }
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mapBounds.json'; a.click();
    URL.revokeObjectURL(url);
    setStatus('已下載 mapBounds.json。', 'ok');
  });

  $('btn-apply').addEventListener('click', () => void applyBounds(false, standalone));
  $('btn-apply-return').addEventListener('click', () => void applyBounds(true, standalone));
  $('btn-clear-apply').addEventListener('click', () => {
    clearOverride(EDITOR_STORE_KEYS.mapBounds);
    setStatus('已清除套用，遊戲將回到打包預設地圖邊界（重開生效）。', 'info');
  });

  // 「回到遊戲」導覽鈕：僅獨立頁；overlay 內移除（會離開遊戲頁弄壞 overlay）。
  const btnReturn = editorRoot.querySelector<HTMLButtonElement>('#btn-return');
  if (btnReturn) {
    if (standalone) btnReturn.addEventListener('click', () => { window.location.href = '../'; });
    else btnReturn.remove();
  }
}

// ---- mount 化（方案 A' 遊戲內展開 + 獨立頁並存） -------------------------

const EDITOR_BODY_HTML = `
<header>
  <h1>地圖邊界編輯器</h1>
  <span class="badge">MapBounds · unit</span>
  <div class="spacer"></div>
  <button id="btn-load-default">載入預設</button>
  <button id="btn-load-file">載入 JSON 檔…</button>
  <input id="file-input" type="file" accept="application/json,.json" hidden />
  <button id="btn-reset">重設為預設值</button>
  <button id="btn-export">下載 JSON</button>
  <button id="btn-apply" class="primary" title="驗證後存入瀏覽器，重開遊戲即生效">套用到遊戲</button>
  <button id="btn-apply-return" class="primary" title="套用並立即返回遊戲">套用並回到遊戲</button>
  <button id="btn-clear-apply" title="移除套用，遊戲回打包預設">清除套用</button>
  <button id="btn-return" class="primary" title="回到遊戲頁">回到遊戲</button>
</header>
<div class="layout">
  <div class="stage-wrap">
    <canvas id="preview" width="640" height="360"></canvas>
    <div class="hint">藍框＝遊玩範圍（unit 中心原點→螢幕）；紅虛線＝下方面板上緣（玩家/敵人下界收此線之上，不進面板）。</div>
  </div>
  <div class="col-inspector">
    <div class="section-title">地圖邊界（Unity 世界單位）</div>
    <div id="bounds-inspector"></div>
    <div class="hint">minX/minY 通常為負（中心原點），可 0 可負；minX&lt;maxX、minY&lt;maxY 必須。調完按「套用到遊戲」，重開遊戲即生效。</div>
  </div>
</div>
<div id="status">就緒。右側調 4 邊界（unit），中間預覽遊玩範圍框。</div>
`;

const EDITOR_CSS = `
.tb-editor-root {
  --bg: #1a1a2e; --panel: #23233a; --panel2: #2c2c48; --line: #3a3a5c;
  --text: #e6e6f0; --muted: #9a9ab5; --accent: #6c8cff; --danger: #ff6c7a; --ok: #59d98e; --stage: #10101c;
  display: flex; flex-direction: column; height: 100%;
  background: var(--bg); color: var(--text);
  font-family: Arial, "Microsoft JhengHei", "Noto Sans TC", sans-serif; font-size: 14px;
}
.tb-editor-root * { box-sizing: border-box; }
.tb-editor-root header { padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; flex: 0 0 auto; }
.tb-editor-root header h1 { font-size: 16px; margin: 0; }
.tb-editor-root header .spacer { flex: 1; }
.tb-editor-root .badge { font-size: 11px; color: var(--muted); border: 1px solid var(--line); padding: 1px 6px; border-radius: 10px; }
.tb-editor-root button { background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
.tb-editor-root button:hover { border-color: var(--accent); }
.tb-editor-root button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.tb-editor-root select, .tb-editor-root input { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; font-size: 13px; }
.tb-editor-root .layout { display: flex; flex: 1; min-height: 0; }
.tb-editor-root .stage-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #14141f; overflow: auto; gap: 8px; }
.tb-editor-root #preview { background: var(--stage); outline: 1px solid var(--line); }
.tb-editor-root .col-inspector { width: 360px; border-left: 1px solid var(--line); padding: 12px; overflow-y: auto; background: var(--panel); }
.tb-editor-root .section-title { color: var(--muted); font-size: 12px; text-transform: uppercase; margin: 10px 0 8px; letter-spacing: 0.5px; }
.tb-editor-root .row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tb-editor-root .row label { width: 110px; color: var(--muted); }
.tb-editor-root .row input[type=range] { flex: 1; }
.tb-editor-root .row input[type=number] { width: 74px; text-align: right; }
.tb-editor-root #status { padding: 8px 16px; font-size: 13px; white-space: pre-wrap; border-top: 1px solid var(--line); background: var(--panel); max-height: 120px; overflow-y: auto; flex: 0 0 auto; }
.tb-editor-root .status-ok { color: var(--ok); } .tb-editor-root .status-err { color: var(--danger); }
.tb-editor-root .hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
`;

const EDITOR_STYLE_ID = 'tb-mapbounds-editor-style';

function ensureEditorStyle(): void {
  if (document.getElementById(EDITOR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = EDITOR_STYLE_ID;
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}

/**
 * 掛載地圖邊界編輯器到指定容器（EditorMountFn）：注入 HTML+樣式 → 綁事件 → initLoad 回顯。
 * 無全域 keydown / 無載遊戲 iframe。unmount 清 DOM。overlay 內移除「回到遊戲」導覽鈕。
 */
export function mount(container: HTMLElement): { unmount(): void } {
  ensureEditorStyle();
  container.classList.add('tb-editor-root');
  container.innerHTML = EDITOR_BODY_HTML;
  editorRoot = container;

  bounds = { ...DEFAULT_BOUNDS };
  bindUI(container.id === 'tb-editor-standalone');
  initLoad(); // 匯入回顯（含 buildInspector + render）

  return {
    unmount(): void {
      container.innerHTML = '';
      container.classList.remove('tb-editor-root');
    },
  };
}

/** 獨立頁自動啟動（並存）：有 #tb-editor-standalone 掛載點才自動 mount。 */
const standaloneHost = document.getElementById('tb-editor-standalone');
if (standaloneHost) {
  mount(standaloneHost);
}
