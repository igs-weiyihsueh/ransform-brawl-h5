/**
 * 衝刺編輯器（獨立進入點）— 可視化調整玩家衝刺參數（速度/時間/傷害/擊退/半徑）。
 *
 * 架構（對齊四編輯器）：獨立 Vite entry（dash-editor/index.html），與遊戲分開打包。
 * 只 import dashSchema（零 Phaser，型別 + 驗證 + DASH_CONFIG 當初值）+ editorStore（套用契約）。
 * 功能：5 欄拖軸+數字框（含小數）→ canvas 預覽衝刺距離（角色參照 + 完整場景真實比例 + 放大滑桿）→
 *      驗證並下載 JSON / 載入 JSON / 套用到遊戲（localStorage override）/ 清除。
 */
import {
  DASH_SCHEMA_VERSION,
  defaultDashFile,
  validateDash,
  assertValidDash,
  dashDistance,
  type DashFile,
} from '@/config/dashSchema';
import {
  EDITOR_STORE_KEYS,
  applyToGame,
  clearOverride,
  loadOverride,
} from '@/config/editorStore';

const PPU = 100; // 對照 gameConfig.PPU=100（本檔自持，不 import 遊戲檔）
const REF_SPRITE_SIZE = 269; // 角色 sprite 顯示尺寸（FRAME_SIZE256×SPRITE_SCALE≈1.05）
const SCENE_W = 1920;
let previewZoom = 1;

/**
 * mount 化（方案 A' 遊戲內展開）：DOM 查找 scope 進 editorRoot（overlay 容器），不吃 document 全域。
 * 獨立頁 /dash-editor/ 仍可用（並存）。mounted 旗標防「HTML 未注入時 refSprite 載入回呼觸發 render() 找不到元素而炸」。
 */
let editorRoot: HTMLElement = document.body;
let mounted = false;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = editorRoot.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

let file: DashFile = defaultDashFile();

const refSprite = new Image();
let refLoaded = false;
refSprite.addEventListener('load', () => { refLoaded = true; if (mounted) render(); });
refSprite.addEventListener('error', () => { refLoaded = false; if (mounted) render(); });
refSprite.src = '../assets/images/characters/SunWukong/idle/frame_00.png';

function setStatus(msg: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  const el = $('status');
  el.textContent = msg;
  el.className = kind === 'ok' ? 'status-ok' : kind === 'err' ? 'status-err' : '';
}

/** 一列：label + 拖軸 + 數字框（雙向同步，parseFloat 小數，超界 clamp）。 */
function numberRow(
  label: string,
  value: number,
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
  slider.value = String(value);
  const num = document.createElement('input');
  num.type = 'number';
  num.min = String(opts.min); num.max = String(opts.max); num.step = 'any'; // 可打小數
  num.value = String(value);
  const clamp = (v: number): number => Math.min(opts.max, Math.max(opts.min, v));
  const commit = (raw: string): void => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    const c = clamp(v);
    slider.value = String(c); num.value = String(c);
    set(c); render();
  };
  slider.addEventListener('input', () => commit(slider.value));
  num.addEventListener('change', () => commit(num.value));
  row.appendChild(lab); row.appendChild(slider); row.appendChild(num);
  return row;
}

function buildInspector(): void {
  const insp = $('dash-inspector');
  insp.innerHTML = '';
  const d = file.dash;
  insp.appendChild(numberRow('速度 speed (unit/s)', d.speed, (v) => { d.speed = v; }, { min: 0, max: 40, step: 0.5 }));
  insp.appendChild(numberRow('持續時間 duration (s)', d.duration, (v) => { d.duration = v; }, { min: 0, max: 1, step: 0.01 }));
  insp.appendChild(numberRow('傷害 damage', d.damage, (v) => { d.damage = v; }, { min: 0, max: 20, step: 1 }));
  insp.appendChild(numberRow('擊退 knockback', d.knockback, (v) => { d.knockback = v; }, { min: 0, max: 10, step: 0.5 }));
  insp.appendChild(numberRow('命中半徑 radius (unit)', d.radius, (v) => { d.radius = v; }, { min: 0, max: 3, step: 0.1 }));
}

/** 預覽：完整場景等比縮（sceneScale=畫布寬/1920）× previewZoom；畫角色參照 + 衝刺距離箭頭。 */
function render(): void {
  const cv = $<HTMLCanvasElement>('preview');
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#10101c'; ctx.fillRect(0, 0, W, H);

  const sceneScale = (W / SCENE_W) * previewZoom; // 完整場景真實比例 × 放大
  const cx = W / 2, cy = H / 2;
  const d = file.dash;
  const distUnit = dashDistance(d.speed, d.duration);
  const distPx = distUnit * PPU * sceneScale; // 衝刺距離（螢幕像素，真實比例）

  // 衝刺距離箭頭（從角色往右 = 衝刺方向）。
  ctx.strokeStyle = '#6c8cff'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + distPx, cy); ctx.stroke();
  // 箭頭頭。
  ctx.beginPath(); ctx.moveTo(cx + distPx, cy);
  ctx.lineTo(cx + distPx - 12, cy - 7); ctx.lineTo(cx + distPx - 12, cy + 7); ctx.closePath();
  ctx.fillStyle = '#6c8cff'; ctx.fill();
  // 命中半徑圈（終點）。
  ctx.strokeStyle = '#ff9d5c'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx + distPx, cy, d.radius * PPU * sceneScale, 0, Math.PI * 2); ctx.stroke();

  // 角色參照（原點 = 衝刺起點）。
  const sprPx = REF_SPRITE_SIZE * sceneScale;
  if (refLoaded) {
    ctx.drawImage(refSprite, cx - sprPx / 2, cy - sprPx / 2, sprPx, sprPx);
  } else {
    ctx.strokeStyle = '#8a8aa5'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, sprPx / 3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#8a8aa5'; ctx.font = '20px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('🧍', cx, cy);
  }
  ctx.fillStyle = '#9a9ab5'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`顯示比例 ×${sceneScale.toFixed(2)}（1 unit=${PPU}px 遊戲內；角色與距離同比例）`, 8, H - 10);

  $('dist-label').innerHTML = `衝刺距離 = <b>${distUnit.toFixed(2)}</b> unit（${Math.round(distUnit * PPU)}px）＝ 速度 ${d.speed} × 時間 ${d.duration}s`;
}

function refreshAll(): void { buildInspector(); render(); }

/** 開啟載入（匯入回顯）：優先讀 localStorage override 回填 file，無/壞→打包預設（不炸）。 */
function initLoad(): void {
  const raw = loadOverride(EDITOR_STORE_KEYS.dash);
  if (raw !== null) {
    const r = validateDash(raw);
    if (r.ok) {
      file = r.data;
      refreshAll();
      setStatus('已載入你上次套用到遊戲的衝刺設定（可繼續編）。', 'ok');
      return;
    }
    setStatus('已套用的衝刺設定驗證失敗，退回打包預設。', 'err');
  }
  file = defaultDashFile();
  refreshAll();
}

function main(): void {
  $('schema-version').textContent = `schema v${DASH_SCHEMA_VERSION}`;
  initLoad(); // 匯入回顯：開啟優先讀 localStorage override 回填，無則打包預設

  $('preview-zoom').addEventListener('input', (e) => {
    previewZoom = parseFloat((e.target as HTMLInputElement).value);
    $('preview-zoom-val').textContent = `${previewZoom}×`;
    render();
  });

  $('btn-load-default').addEventListener('click', () => { file = defaultDashFile(); refreshAll(); setStatus('已載入打包預設衝刺參數。', 'info'); });
  $('btn-reset').addEventListener('click', () => { file = defaultDashFile(); refreshAll(); setStatus('已重設為預設值。', 'info'); });

  $('btn-load-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        file = assertValidDash(json);
        refreshAll();
        // 上傳即生效：載入編輯器 + 同時套用到遊戲（存 localStorage，重開仍在）。
        const applied = applyToGame(EDITOR_STORE_KEYS.dash, file);
        setStatus(applied ? '已載入 JSON 並套用到遊戲（重開仍在）。' : '已載入 JSON（套用失敗：localStorage 不可用）。', applied ? 'ok' : 'err');
      } catch (err) {
        setStatus(`載入失敗：${(err as Error).message}`, 'err');
      }
    };
    reader.readAsText(f);
  });

  $('btn-export').addEventListener('click', () => {
    const res = validateDash(file);
    if (!res.ok) { setStatus(`驗證失敗：\n${res.errors.join('\n')}`, 'err'); return; }
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'dash.json'; a.click();
    URL.revokeObjectURL(a.href);
    setStatus('已驗證並下載 dash.json。', 'ok');
  });

  $('btn-apply').addEventListener('click', () => void applyDashToGame());
  $('btn-apply-return').addEventListener('click', () => {
    if (!applyDashToGame()) return;
    setStatus('✅ 已套用，返回遊戲中…', 'ok');
    window.location.href = '../';
  });
  $('btn-clear-apply').addEventListener('click', () => {
    clearOverride(EDITOR_STORE_KEYS.dash);
    setStatus('已清除套用，遊戲將回到打包預設衝刺參數。', 'info');
  });
}

/** 套用 dash 設定到遊戲（匯入機制）：validate 過才存 localStorage。回傳是否成功。 */
function applyDashToGame(): boolean {
  const res = validateDash(file);
  if (!res.ok) { setStatus(`套用失敗（驗證未過）：\n${res.errors.join('\n')}`, 'err'); return false; }
  const ok = applyToGame(EDITOR_STORE_KEYS.dash, res.data);
  setStatus(ok ? '✅ 已套用到遊戲（存入瀏覽器）。重開遊戲即生效。' : '套用失敗：瀏覽器 localStorage 不可用。', ok ? 'ok' : 'err');
  return ok;
}

// ---- mount 化（方案 A' 遊戲內展開 + 獨立頁並存） -------------------------

/** 編輯器 body HTML（從 dash-editor/index.html <body> 搬來，去 <script>）。 */
const EDITOR_BODY_HTML = `
<header>
  <h1>衝刺編輯器</h1>
  <span class="badge" id="schema-version"></span>
  <div class="spacer"></div>
  <button id="btn-load-default">載入預設</button>
  <button id="btn-load-file">載入 JSON 檔…</button>
  <input id="file-input" type="file" accept="application/json,.json" hidden />
  <button id="btn-reset">重設為預設值</button>
  <button id="btn-export" class="primary">驗證並下載 JSON</button>
  <button id="btn-apply" class="primary" title="驗證後存入瀏覽器，重開遊戲即生效">套用到遊戲</button>
  <button id="btn-apply-return" class="primary" title="套用並立即返回遊戲">套用並回到遊戲</button>
  <button id="btn-clear-apply" title="移除套用，遊戲回打包預設">清除套用</button>
</header>
<div class="layout">
  <div class="stage-wrap">
    <canvas id="preview" width="640" height="360"></canvas>
    <div style="font-size:12px;color:#9a9ab5;display:flex;align-items:center;gap:8px;width:640px;">
      <span>放大檢視</span>
      <input id="preview-zoom" type="range" min="1" max="6" step="0.5" value="1" style="flex:1;" />
      <span id="preview-zoom-val">1×</span>
      <span>（1×＝完整場景真實比例）</span>
    </div>
    <div class="dist" id="dist-label"></div>
  </div>
  <div class="col-inspector">
    <div class="section-title">衝刺參數（Dash）</div>
    <div id="dash-inspector"></div>
    <div class="hint">距離 = 速度 × 持續時間（unit）。調完按「套用到遊戲」，重開遊戲即生效。</div>
  </div>
</div>
<div id="status">就緒。右側調衝刺參數，中間預覽衝刺距離（角色參照 + 真實比例）。</div>
`;

/** 編輯器樣式（命名空間 .tb-editor-root）。 */
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
.tb-editor-root .stage-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #14141f; overflow: auto; gap: 6px; }
.tb-editor-root #preview { background: var(--stage); outline: 1px solid var(--line); }
.tb-editor-root .col-inspector { width: 360px; border-left: 1px solid var(--line); padding: 12px; overflow-y: auto; background: var(--panel); }
.tb-editor-root .section-title { color: var(--muted); font-size: 12px; text-transform: uppercase; margin: 10px 0 8px; letter-spacing: 0.5px; }
.tb-editor-root .row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tb-editor-root .row label { width: 150px; color: var(--muted); }
.tb-editor-root .row input[type=range] { flex: 1; }
.tb-editor-root .row input[type=number] { width: 74px; text-align: right; }
.tb-editor-root #status { padding: 8px 16px; font-size: 13px; white-space: pre-wrap; border-top: 1px solid var(--line); background: var(--panel); max-height: 120px; overflow-y: auto; flex: 0 0 auto; }
.tb-editor-root .status-ok { color: var(--ok); } .tb-editor-root .status-err { color: var(--danger); }
.tb-editor-root .hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
.tb-editor-root .dist { font-size: 13px; color: var(--text); margin-top: 8px; }
.tb-editor-root .dist b { color: var(--accent); }
`;

const EDITOR_STYLE_ID = 'tb-dash-editor-style';

function ensureEditorStyle(): void {
  if (document.getElementById(EDITOR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = EDITOR_STYLE_ID;
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}

/**
 * 掛載衝刺編輯器到指定容器（EditorMountFn）：注入 HTML+樣式 → main()（含 initLoad 回顯 + 綁事件）。
 * 回傳 { unmount() } 清 DOM。dash 無全域 keydown / 無試玩 iframe，unmount 只清容器。
 */
export function mount(container: HTMLElement): { unmount(): void } {
  ensureEditorStyle();
  container.classList.add('tb-editor-root');
  container.innerHTML = EDITOR_BODY_HTML;
  editorRoot = container;
  mounted = true;

  // 重置狀態（反覆開關 overlay）。
  file = defaultDashFile();

  main(); // 含 $('schema-version') + initLoad 回顯 + 綁全部事件

  return {
    unmount(): void {
      mounted = false;
      container.innerHTML = '';
      container.classList.remove('tb-editor-root');
    },
  };
}

/** 獨立頁自動啟動（並存）：有 #tb-editor-standalone 掛載點才自動 mount；overlay lazy import 時無此元素 → 不自動跑。 */
const standaloneHost = document.getElementById('tb-editor-standalone');
if (standaloneHost) {
  mount(standaloneHost);
}

