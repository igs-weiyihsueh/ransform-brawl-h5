/**
 * 寶盒編輯器（獨立進入點）— 可視化調整寶盒開放設定（開箱門檻 + 各怪擊殺給的能量）。
 *   用戶第九輪 #6：CHEST_OPEN_THRESHOLD + CHEST_CHARGE_BY_ENEMY 原本 hardcode，開放編輯。
 *
 * 架構（對齊 dash-editor 等）：獨立 Vite entry + mount 化（方案 A'）。只 import chestSchema（零 Phaser，
 * 型別 + 驗證 + resolveChest + chestConfig 打包預設當初值）+ editorStore（套用契約）+ getEnemyTypeKeys（敵種動態單一來源）。
 * 功能：開箱門檻 number + 各怪 charge（敵種讀 getEnemyTypeKeys 動態，新增怪自動出現）→
 *      驗證並下載 JSON / 載入 JSON（上傳即套用）/ 套用到遊戲（localStorage override）/ 套用並回到遊戲 / 清除。
 * ★0-nullish：能量 0 合法（parseFloat + 允許 0），resolveChest 用 ?? 保留 0。
 */
import {
  CHEST_SCHEMA_VERSION,
  defaultChestFile,
  validateChest,
  assertValidChest,
  type ChestFile,
} from '@/config/chestSchema';
import {
  EDITOR_STORE_KEYS,
  applyToGame,
  clearOverride,
  loadOverride,
} from '@/config/editorStore';
import { getEnemyTypeKeys } from '@/config/enemySchema';

/**
 * mount 化：DOM 查找 scope 進 editorRoot（overlay 容器），不吃 document 全域。獨立頁 /chest-editor/ 並存。
 */
let editorRoot: HTMLElement = document.body;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = editorRoot.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

let file: ChestFile = defaultChestFile();

function setStatus(msg: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  const el = $('status');
  el.textContent = msg;
  el.className = kind === 'ok' ? 'status-ok' : kind === 'err' ? 'status-err' : '';
}

/** 數字列：label + 數字框（parseFloat 小數、允許 0、超界夾回 min）。 */
function numberRow(
  label: string,
  value: number,
  set: (v: number) => void,
  opts: { min: number; step: number } = { min: 0, step: 1 },
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const num = document.createElement('input');
  num.type = 'number';
  num.min = String(opts.min);
  num.step = 'any'; // 可打小數
  num.value = String(value);
  num.addEventListener('change', () => {
    const v = parseFloat(num.value);
    if (!Number.isFinite(v)) return;
    const c = Math.max(opts.min, v); // 夾回 min（0 合法）
    num.value = String(c);
    set(c);
  });
  row.appendChild(lab);
  row.appendChild(num);
  return row;
}

function buildInspector(): void {
  const insp = $('chest-inspector');
  insp.innerHTML = '';

  // 開箱門檻。
  const thTitle = document.createElement('div');
  thTitle.className = 'section-title';
  thTitle.textContent = '開箱門檻';
  insp.appendChild(thTitle);
  insp.appendChild(numberRow('門檻 openThreshold', file.openThreshold ?? 0, (v) => { file.openThreshold = v; }, { min: 0, step: 1 }));
  const thHint = document.createElement('div');
  thHint.className = 'hint';
  thHint.textContent = 'chestCharge 累積 ≥ 此值自動開箱、扣此值（超過排隊連開）。';
  insp.appendChild(thHint);

  // 各怪擊殺給的能量（敵種動態讀 getEnemyTypeKeys ∪ 現有 chargeByEnemy 鍵，避免自訂鍵遺失）。
  const cbeTitle = document.createElement('div');
  cbeTitle.className = 'section-title';
  cbeTitle.style.marginTop = '12px';
  cbeTitle.textContent = '各怪擊殺給的能量 chargeByEnemy';
  insp.appendChild(cbeTitle);

  if (!file.chargeByEnemy) file.chargeByEnemy = {};
  const cbe = file.chargeByEnemy;
  const dyn = getEnemyTypeKeys();
  const keys = Array.from(new Set([...dyn, ...Object.keys(cbe)]));
  if (keys.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = '（尚無敵種——在敵人編輯器新增敵人後會自動出現。）';
    insp.appendChild(empty);
  }
  for (const k of keys) {
    // 0-nullish：某怪能量可為 0（合法），用 ?? 取值（?? 而非 ||，別把 0 當 falsy）。
    insp.appendChild(numberRow(k, cbe[k] ?? 0, (v) => { cbe[k] = v; }, { min: 0, step: 1 }));
  }
  const cbeHint = document.createElement('div');
  cbeHint.className = 'hint';
  cbeHint.textContent = '每擊殺對應敵人給的 chestCharge（0 合法）。敵種清單來自敵人設定（新增怪自動出現）。';
  insp.appendChild(cbeHint);
}

function refreshAll(): void { buildInspector(); }

/** 開啟載入（匯入回顯）：優先讀 localStorage override 回填 file，無/壞→打包預設（不炸）。 */
function initLoad(): void {
  const raw = loadOverride(EDITOR_STORE_KEYS.chest);
  if (raw !== null) {
    const r = validateChest(raw);
    if (r.ok) {
      file = r.data;
      refreshAll();
      setStatus('已載入你上次套用到遊戲的寶盒設定（可繼續編）。', 'ok');
      return;
    }
    setStatus('已套用的寶盒設定驗證失敗，退回打包預設。', 'err');
  }
  file = defaultChestFile();
  refreshAll();
}

/** 套用寶盒設定到遊戲（匯入機制）：validate 過才存 localStorage。回傳是否成功。 */
function applyChestToGame(): boolean {
  const res = validateChest(file);
  if (!res.ok) { setStatus(`套用失敗（驗證未過）：\n${res.errors.join('\n')}`, 'err'); return false; }
  const ok = applyToGame(EDITOR_STORE_KEYS.chest, res.data);
  setStatus(ok ? '✅ 已套用到遊戲（存入瀏覽器）。重開遊戲即生效。' : '套用失敗：瀏覽器 localStorage 不可用。', ok ? 'ok' : 'err');
  return ok;
}

function main(): void {
  $('schema-version').textContent = `schema v${CHEST_SCHEMA_VERSION}`;
  initLoad(); // 匯入回顯：開啟優先讀 localStorage override 回填，無則打包預設

  $('btn-load-default').addEventListener('click', () => { file = defaultChestFile(); refreshAll(); setStatus('已載入打包預設寶盒設定。', 'info'); });
  $('btn-reset').addEventListener('click', () => { file = defaultChestFile(); refreshAll(); setStatus('已重設為預設值。', 'info'); });

  $('btn-load-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        file = assertValidChest(json);
        refreshAll();
        // 上傳即生效：載入編輯器 + 同時套用到遊戲。
        const applied = applyToGame(EDITOR_STORE_KEYS.chest, file);
        setStatus(applied ? '已載入 JSON 並套用到遊戲（重開仍在）。' : '已載入 JSON（套用失敗：localStorage 不可用）。', applied ? 'ok' : 'err');
      } catch (err) {
        setStatus(`載入失敗：${(err as Error).message}`, 'err');
      }
    };
    reader.readAsText(f);
  });

  $('btn-export').addEventListener('click', () => {
    const res = validateChest(file);
    if (!res.ok) { setStatus(`驗證失敗：\n${res.errors.join('\n')}`, 'err'); return; }
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'chest.json'; a.click();
    URL.revokeObjectURL(a.href);
    setStatus('已驗證並下載 chest.json。', 'ok');
  });

  $('btn-apply').addEventListener('click', () => void applyChestToGame());
  $('btn-apply-return').addEventListener('click', () => {
    if (!applyChestToGame()) return;
    setStatus('✅ 已套用，返回遊戲中…', 'ok');
    window.location.href = '../';
  });
  $('btn-clear-apply').addEventListener('click', () => {
    clearOverride(EDITOR_STORE_KEYS.chest);
    setStatus('已清除套用，遊戲將回到打包預設寶盒設定。', 'info');
  });
}

// ---- mount 化（方案 A' 遊戲內展開 + 獨立頁並存） -------------------------

const EDITOR_BODY_HTML = `
<header>
  <h1>寶盒編輯器</h1>
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
  <div class="col-inspector wide">
    <div id="chest-inspector"></div>
    <div class="hint">寶盒能量≠技能能量：每「擊殺」給、滿門檻自動開箱。調完按「套用到遊戲」，重開遊戲即生效。</div>
  </div>
</div>
<div id="status">就緒。調開箱門檻 + 各怪擊殺給的能量。</div>
`;

const EDITOR_CSS = `
.tb-editor-root {
  --bg: #1a1a2e; --panel: #23233a; --panel2: #2c2c48; --line: #3a3a5c;
  --text: #e6e6f0; --muted: #9a9ab5; --accent: #6c8cff; --danger: #ff6c7a; --ok: #59d98e;
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
.tb-editor-root input { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; font-size: 13px; }
.tb-editor-root .layout { display: flex; flex: 1; min-height: 0; }
.tb-editor-root .col-inspector { width: 420px; padding: 16px; overflow-y: auto; background: var(--panel); }
.tb-editor-root .col-inspector.wide { width: 100%; max-width: 560px; margin: 0 auto; }
.tb-editor-root .section-title { color: var(--muted); font-size: 12px; text-transform: uppercase; margin: 10px 0 8px; letter-spacing: 0.5px; }
.tb-editor-root .row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tb-editor-root .row label { width: 220px; color: var(--muted); }
.tb-editor-root .row input[type=number] { width: 110px; text-align: right; }
.tb-editor-root #status { padding: 8px 16px; font-size: 13px; white-space: pre-wrap; border-top: 1px solid var(--line); background: var(--panel); max-height: 120px; overflow-y: auto; flex: 0 0 auto; }
.tb-editor-root .status-ok { color: var(--ok); } .tb-editor-root .status-err { color: var(--danger); }
.tb-editor-root .hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
`;

const EDITOR_STYLE_ID = 'tb-chest-editor-style';

function ensureEditorStyle(): void {
  if (document.getElementById(EDITOR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = EDITOR_STYLE_ID;
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}

/** 掛載寶盒編輯器到指定容器（EditorMountFn）：注入 HTML+樣式 → main()（含 initLoad 回顯 + 綁事件）。 */
export function mount(container: HTMLElement): { unmount(): void } {
  ensureEditorStyle();
  container.classList.add('tb-editor-root');
  container.innerHTML = EDITOR_BODY_HTML;
  editorRoot = container;

  file = defaultChestFile(); // 重置狀態（反覆開關 overlay）
  main();

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
