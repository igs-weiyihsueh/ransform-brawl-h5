/**
 * 事件編輯器（獨立進入點）— firerain-editor + guard-editor 併頁（七輪，異靈拍板）。
 *
 * 火雨 tab + 守護波 tab 切換。守護 tab 去 drip（補怪 maxAlive/spawnThreshold/spawnInterval/spawns
 * 已搬 level editor 守護節點 per-wave，見 EventNodeData drip / resolveGuardDrip），此處只留 preset 共用
 * 參數（時限/HP/獎勵/開場定位/4常數）。
 *
 * EDITOR_STORE_KEYS firerain/guard 兩 key 保留：遊戲端 resolveFireRain/resolveGuard 零改動，
 * 本頁只 UI 併頁，套用時「分別存兩 key」。開啟各自 initLoad 回顯（火雨、守護各讀自己的 override）。
 * 零 Phaser。
 */
import {
  FIRE_RAIN_SCHEMA_VERSION,
  defaultFireRainFile,
  validateFireRain,
  assertValidFireRain,
  type FireRainFile,
} from '@/config/fireRainSchema';
import type { FireRainPreset } from '@/config/fireRainConfig';
import {
  GUARD_SCHEMA_VERSION,
  defaultGuardFile,
  validateGuard,
  assertValidGuard,
  type GuardFile,
} from '@/config/guardSchema';
import type { GuardPreset } from '@/config/guardConfig';
import {
  EDITOR_STORE_KEYS,
  applyToGame,
  clearOverride,
  loadOverride,
} from '@/config/editorStore';

const SCENE_W = 1920;

/**
 * mount 化（方案 A' 遊戲內展開）：DOM 查找 scope 進 editorRoot（overlay 容器），不吃 document 全域。
 * 獨立頁 /event-editor/ 仍可用（並存）。event-editor 是火雨+守護併頁（內部 tab），mount 化後整個當一個 overlay tab。
 */
let editorRoot: HTMLElement = document.body;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = editorRoot.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

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
  opts: { min: number; max: number; step: number; int?: boolean },
  onChange: () => void,
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
  num.min = String(opts.min); num.max = String(opts.max); num.step = 'any';
  num.value = String(value);
  const clamp = (v: number): number => Math.min(opts.max, Math.max(opts.min, v));
  const commit = (raw: string): void => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    let c = clamp(v);
    if (opts.int) c = Math.round(c);
    slider.value = String(c); num.value = String(c);
    set(c); onChange();
  };
  slider.addEventListener('input', () => commit(slider.value));
  num.addEventListener('change', () => commit(num.value));
  row.appendChild(lab); row.appendChild(slider); row.appendChild(num);
  return row;
}

// ═══════════════════════════════════════ 火雨 tab ═══════════════════════════════════════
let frFile: FireRainFile = defaultFireRainFile();
let frCurrent: string = Object.keys(frFile.presets)[0] ?? 'FireRain';
let frZoom = 1;
const frRef = new Image();
let frRefLoaded = false;
frRef.addEventListener('load', () => { frRefLoaded = true; frRender(); });
frRef.src = '../assets/images/characters/SunWukong/idle/frame_00.png';

function frPreset(): FireRainPreset { return frFile.presets[frCurrent]; }

function frBuildSelect(): void {
  const sel = $<HTMLSelectElement>('fr-preset-select');
  sel.innerHTML = '';
  for (const name of Object.keys(frFile.presets)) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if (name === frCurrent) opt.selected = true;
    sel.appendChild(opt);
  }
}
function frBuildInspector(): void {
  const insp = $('fr-inspector'); insp.innerHTML = '';
  const p = frPreset(); if (!p) return;
  const on = () => frRender();
  insp.appendChild(numberRow('落下間隔 interval (s)', p.intervalSec, (v) => { p.intervalSec = v; }, { min: 0, max: 5, step: 0.1 }, on));
  insp.appendChild(numberRow('火柱半徑 radius (px)', p.radiusPx, (v) => { p.radiusPx = v; }, { min: 0, max: 300, step: 5 }, on));
  insp.appendChild(numberRow('預警時間 warning (s)', p.warningSec, (v) => { p.warningSec = v; }, { min: 0, max: 3, step: 0.1 }, on));
  insp.appendChild(numberRow('傷害 damage', p.damage, (v) => { p.damage = v; }, { min: 0, max: 20, step: 1 }, on));
  insp.appendChild(numberRow('同時在途上限 maxConcurrent', p.maxConcurrent, (v) => { p.maxConcurrent = Math.round(v); }, { min: 1, max: 12, step: 1, int: true }, on));
  insp.appendChild(numberRow('每批道數 burstCount', p.burstCount, (v) => { p.burstCount = Math.round(v); }, { min: 1, max: 8, step: 1, int: true }, on));
  insp.appendChild(numberRow('縮邊距離 edgeMargin (px)', p.edgeMarginPx, (v) => { p.edgeMarginPx = v; }, { min: 0, max: 400, step: 10 }, on));
  insp.appendChild(numberRow('持續時間 duration (s)', p.durationSec, (v) => { p.durationSec = v; }, { min: 0, max: 120, step: 1 }, on));
}
function frRender(): void {
  const cv = $<HTMLCanvasElement>('fr-preview'); const ctx = cv.getContext('2d'); if (!ctx) return;
  const W = cv.width, H = cv.height; ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#10101c'; ctx.fillRect(0, 0, W, H);
  const scale = (W / SCENE_W) * frZoom; const cx = W / 2, cy = H / 2;
  const p = frPreset(); if (!p) return;
  const rPx = p.radiusPx * scale;
  ctx.strokeStyle = '#ff9d5c'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, rPx, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,120,40,0.18)'; ctx.beginPath(); ctx.arc(cx, cy, rPx, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff6c3c'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
  const sprPx = 269 * scale; const px = cx + rPx + sprPx * 0.6;
  if (frRefLoaded) ctx.drawImage(frRef, px - sprPx / 2, cy - sprPx / 2, sprPx, sprPx);
  ctx.fillStyle = '#9a9ab5'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`火柱半徑 ${p.radiusPx.toFixed(0)}px（顯示 ×${scale.toFixed(2)}）｜每批 ${p.burstCount} 道／${p.intervalSec}s，同時上限 ${p.maxConcurrent}`, 8, H - 10);
}
function frRefreshAll(): void { frBuildSelect(); frBuildInspector(); frRender(); }
function frInitLoad(): void {
  const raw = loadOverride(EDITOR_STORE_KEYS.firerain);
  if (raw !== null) {
    const r = validateFireRain(raw);
    if (r.ok) {
      const base = defaultFireRainFile();
      frFile = { version: base.version, presets: { ...base.presets, ...r.data.presets } };
      frCurrent = Object.keys(frFile.presets)[0]; frRefreshAll();
      setStatus('已載入你上次套用到遊戲的火雨設定（可繼續編）。', 'ok'); return;
    }
    setStatus('已套用的火雨設定驗證失敗，退回打包預設。', 'err');
  }
  frFile = defaultFireRainFile(); frCurrent = Object.keys(frFile.presets)[0]; frRefreshAll();
}
/** 套用火雨到遊戲。回傳是否成功。 */
function frApply(): boolean {
  const res = validateFireRain(frFile);
  if (!res.ok) { setStatus(`火雨套用失敗（驗證未過）：\n${res.errors.join('\n')}`, 'err'); return false; }
  return applyToGame(EDITOR_STORE_KEYS.firerain, res.data);
}

// ═══════════════════════════════════════ 守護波 tab（無 drip）═══════════════════════════════════════
let gdFile: GuardFile = defaultGuardFile();
let gdCurrent: string = Object.keys(gdFile.presets)[0] ?? 'Guard60';
let gdZoom = 1;

function gdPreset(): GuardPreset { return gdFile.presets[gdCurrent]; }

function gdBuildSelect(): void {
  const sel = $<HTMLSelectElement>('gd-preset-select');
  sel.innerHTML = '';
  for (const name of Object.keys(gdFile.presets)) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if (name === gdCurrent) opt.selected = true;
    sel.appendChild(opt);
  }
}
function gdBuildInspector(): void {
  const p = gdPreset(); if (!p) return;
  const on = () => gdRender();
  const guard = $('gd-inspector'); guard.innerHTML = '';
  guard.appendChild(numberRow('時間限制 timeLimit (s)', p.timeLimit, (v) => { p.timeLimit = v; }, { min: 0, max: 300, step: 1 }, on));
  guard.appendChild(numberRow('雕像 HP targetHP', p.targetHP, (v) => { p.targetHP = v; }, { min: 1, max: 1000, step: 5 }, on));
  guard.appendChild(numberRow('獎券 rewardTickets', p.rewardTickets, (v) => { p.rewardTickets = v; }, { min: 0, max: 100, step: 1 }, on));
  guard.appendChild(numberRow('生成環繞半徑 spawnRadius (px)', p.spawnRadiusPx, (v) => { p.spawnRadiusPx = v; }, { min: 0, max: 800, step: 10 }, on));
  // ※補怪 drip（maxAlive/spawnThreshold/spawnInterval/spawns）已搬 level editor 守護節點，此處不編。

  const intro = $('gd-intro-inspector'); intro.innerHTML = '';
  intro.appendChild(numberRow('四角 X 偏移 cornerOffsetX (px)', p.cornerOffsetXPx, (v) => { p.cornerOffsetXPx = v; }, { min: 0, max: 600, step: 10 }, on));
  intro.appendChild(numberRow('四角 Y 偏移 cornerOffsetY (px)', p.cornerOffsetYPx, (v) => { p.cornerOffsetYPx = v; }, { min: 0, max: 600, step: 10 }, on));
  intro.appendChild(numberRow('聚焦壓暗 introFocus (s)', p.introFocusSec, (v) => { p.introFocusSec = v; }, { min: 0, max: 8, step: 0.1 }, on));
  intro.appendChild(numberRow('走位逾時 maxWalk (s)', p.maxWalkSec, (v) => { p.maxWalkSec = v; }, { min: 0, max: 10, step: 0.1 }, on));
  intro.appendChild(numberRow('spotlight 半徑 (px)', p.spotlightRadiusPx, (v) => { p.spotlightRadiusPx = v; }, { min: 0, max: 800, step: 10 }, on));
}
function gdRender(): void {
  const cv = $<HTMLCanvasElement>('gd-preview'); const ctx = cv.getContext('2d'); if (!ctx) return;
  const W = cv.width, H = cv.height; ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#10101c'; ctx.fillRect(0, 0, W, H);
  const scale = (W / SCENE_W) * gdZoom; const cx = W / 2, cy = H / 2;
  const p = gdPreset(); if (!p) return;
  ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, p.spotlightRadiusPx * scale, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#59d98e'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.arc(cx, cy, p.spawnRadiusPx * scale, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  const stW = 60 * scale, stH = 90 * scale;
  ctx.fillStyle = '#6c8cff'; ctx.fillRect(cx - stW / 2, cy - stH / 2, stW, stH);
  ctx.fillStyle = '#9a9ab5'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('雕像', cx, cy + stH / 2 + 14);
  const ox = p.cornerOffsetXPx * scale, oy = p.cornerOffsetYPx * scale;
  const corners = [[cx - ox, cy - oy], [cx + ox, cy - oy], [cx - ox, cy + oy], [cx + ox, cy + oy]];
  corners.forEach(([x, y], i) => {
    ctx.fillStyle = '#59d98e'; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e6e6f0'; ctx.fillText(`P${i + 1}`, x, y - 10);
  });
  ctx.fillStyle = '#9a9ab5'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`HP ${p.targetHP}｜${p.timeLimit}s｜四角±(${p.cornerOffsetXPx},${p.cornerOffsetYPx})px｜spotlight ${p.spotlightRadiusPx}px（顯示 ×${scale.toFixed(2)}）`, 8, H - 10);
}
function gdRefreshAll(): void { gdBuildSelect(); gdBuildInspector(); gdRender(); }
function gdInitLoad(): void {
  const raw = loadOverride(EDITOR_STORE_KEYS.guard);
  if (raw !== null) {
    const r = validateGuard(raw);
    if (r.ok) {
      const base = defaultGuardFile();
      gdFile = { version: base.version, presets: { ...base.presets, ...r.data.presets } };
      gdCurrent = Object.keys(gdFile.presets)[0]; gdRefreshAll();
      setStatus('已載入你上次套用到遊戲的守護設定（可繼續編）。', 'ok'); return;
    }
    setStatus('已套用的守護設定驗證失敗，退回打包預設。', 'err');
  }
  gdFile = defaultGuardFile(); gdCurrent = Object.keys(gdFile.presets)[0]; gdRefreshAll();
}
/** 套用守護到遊戲。回傳是否成功。 */
function gdApply(): boolean {
  const res = validateGuard(gdFile);
  if (!res.ok) { setStatus(`守護套用失敗（驗證未過）：\n${res.errors.join('\n')}`, 'err'); return false; }
  return applyToGame(EDITOR_STORE_KEYS.guard, res.data);
}

// ═══════════════════════════════════════ 分頁 + 共用按鈕 ═══════════════════════════════════════
type Tab = 'firerain' | 'guard';
let activeTab: Tab = 'firerain';

function switchTab(tab: Tab): void {
  activeTab = tab;
  for (const t of ['firerain', 'guard'] as Tab[]) {
    $(`tab-${t}`).classList.toggle('active', t === tab);
    $(`pane-${t}`).classList.toggle('active', t === tab);
  }
}

/** 兩份都套用（火雨 + 守護分存兩 key）。回傳是否兩者都成功。 */
function applyBoth(): boolean {
  const fr = frApply(); const gd = gdApply();
  if (fr && gd) { setStatus('✅ 火雨 + 守護都已套用到遊戲（各存一份，重開仍在）。', 'ok'); return true; }
  if (!fr || !gd) setStatus(`套用結果：火雨 ${fr ? '✓' : '✗'}、守護 ${gd ? '✓' : '✗'}。`, fr && gd ? 'ok' : 'err');
  return fr && gd;
}

function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

function main(): void {
  $('schema-version').textContent = `火雨 v${FIRE_RAIN_SCHEMA_VERSION} · 守護 v${GUARD_SCHEMA_VERSION}`;
  frInitLoad();
  gdInitLoad();

  // 分頁切換。
  for (const t of ['firerain', 'guard'] as Tab[]) {
    $(`tab-${t}`).addEventListener('click', () => switchTab(t));
  }

  // 各 tab 的 preset 下拉 + 放大。
  $<HTMLSelectElement>('fr-preset-select').addEventListener('change', (e) => { frCurrent = (e.target as HTMLSelectElement).value; frBuildInspector(); frRender(); });
  $('fr-zoom').addEventListener('input', (e) => { frZoom = parseFloat((e.target as HTMLInputElement).value); $('fr-zoom-val').textContent = `${frZoom}×`; frRender(); });
  $<HTMLSelectElement>('gd-preset-select').addEventListener('change', (e) => { gdCurrent = (e.target as HTMLSelectElement).value; gdBuildInspector(); gdRender(); });
  $('gd-zoom').addEventListener('input', (e) => { gdZoom = parseFloat((e.target as HTMLInputElement).value); $('gd-zoom-val').textContent = `${gdZoom}×`; gdRender(); });

  // 共用按鈕：對「當前分頁」載入/下載；套用/清除則兩者都動（分存兩 key）。
  $('btn-load-default').addEventListener('click', () => {
    frFile = defaultFireRainFile(); frCurrent = Object.keys(frFile.presets)[0]; frRefreshAll();
    gdFile = defaultGuardFile(); gdCurrent = Object.keys(gdFile.presets)[0]; gdRefreshAll();
    setStatus('已載入火雨 + 守護打包預設。', 'info');
  });
  $('btn-reset').addEventListener('click', () => {
    frFile = defaultFireRainFile(); frCurrent = Object.keys(frFile.presets)[0]; frRefreshAll();
    gdFile = defaultGuardFile(); gdCurrent = Object.keys(gdFile.presets)[0]; gdRefreshAll();
    setStatus('已重設火雨 + 守護為預設值。', 'info');
  });

  $('btn-load-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      // 依當前分頁判斷檔案是火雨還是守護（試 validate）；上傳即套用該類。
      let json: unknown;
      try { json = JSON.parse(String(reader.result)); }
      catch (err) { setStatus(`不是合法 JSON：${(err as Error).message}`, 'err'); return; }
      if (activeTab === 'firerain') {
        try {
          frFile = assertValidFireRain(json); frCurrent = Object.keys(frFile.presets)[0]; frRefreshAll();
          const ok = applyToGame(EDITOR_STORE_KEYS.firerain, frFile);
          setStatus(ok ? '已載入火雨 JSON 並套用（重開仍在）。' : '已載入火雨 JSON（套用失敗：localStorage 不可用）。', ok ? 'ok' : 'err');
        } catch (err) { setStatus(`火雨載入失敗：${(err as Error).message}`, 'err'); }
      } else {
        try {
          gdFile = assertValidGuard(json); gdCurrent = Object.keys(gdFile.presets)[0]; gdRefreshAll();
          const ok = applyToGame(EDITOR_STORE_KEYS.guard, gdFile);
          setStatus(ok ? '已載入守護 JSON 並套用（重開仍在）。' : '已載入守護 JSON（套用失敗：localStorage 不可用）。', ok ? 'ok' : 'err');
        } catch (err) { setStatus(`守護載入失敗：${(err as Error).message}`, 'err'); }
      }
    };
    reader.readAsText(f);
  });

  // 下載：當前分頁那份。
  $('btn-export').addEventListener('click', () => {
    if (activeTab === 'firerain') {
      const res = validateFireRain(frFile);
      if (!res.ok) { setStatus(`火雨驗證失敗：\n${res.errors.join('\n')}`, 'err'); return; }
      downloadJson('firerain.json', res.data); setStatus('已下載 firerain.json。', 'ok');
    } else {
      const res = validateGuard(gdFile);
      if (!res.ok) { setStatus(`守護驗證失敗：\n${res.errors.join('\n')}`, 'err'); return; }
      downloadJson('guard.json', res.data); setStatus('已下載 guard.json。', 'ok');
    }
  });

  // 套用（兩份都存）。
  $('btn-apply').addEventListener('click', () => void applyBoth());
  $('btn-apply-return').addEventListener('click', () => {
    if (!applyBoth()) return;
    setStatus('✅ 已套用，返回遊戲中…', 'ok');
    window.location.href = '../';
  });
  // 清除（兩 key 都清）。
  $('btn-clear-apply').addEventListener('click', () => {
    clearOverride(EDITOR_STORE_KEYS.firerain);
    clearOverride(EDITOR_STORE_KEYS.guard);
    setStatus('已清除火雨 + 守護套用，遊戲回打包預設。', 'info');
  });
}

// ---- mount 化（方案 A' 遊戲內展開 + 獨立頁並存） -------------------------

/** 編輯器 body HTML（從 event-editor/index.html <body> 搬來，去 <script>）。內部火雨/守護子 tab 保留。 */
const EDITOR_BODY_HTML = `
<header>
  <h1>事件編輯器</h1>
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
<div class="tabs">
  <div class="tab active" data-tab="firerain" id="tab-firerain">🔥 火雨</div>
  <div class="tab" data-tab="guard" id="tab-guard">🛡 守護波</div>
</div>
<div class="tabpane active" id="pane-firerain">
  <div class="layout">
    <div class="stage-wrap">
      <canvas id="fr-preview" class="preview" width="640" height="360"></canvas>
      <div class="zoom-row">
        <span>放大檢視</span>
        <input id="fr-zoom" type="range" min="1" max="6" step="0.5" value="1" style="flex:1;" />
        <span id="fr-zoom-val">1×</span>
        <span>（1×＝完整場景真實比例）</span>
      </div>
    </div>
    <div class="col-inspector">
      <div class="preset-row">
        <label for="fr-preset-select">火雨 Preset</label>
        <select id="fr-preset-select"></select>
      </div>
      <div class="section-title">火雨參數（FireRain）</div>
      <div id="fr-inspector"></div>
      <div class="hint">radius＝火柱半徑（預覽橘圈）；interval＝每批落下間隔；burstCount＝每批幾道；maxConcurrent＝同時在途上限。</div>
    </div>
  </div>
</div>
<div class="tabpane" id="pane-guard">
  <div class="layout">
    <div class="stage-wrap">
      <canvas id="gd-preview" class="preview" width="640" height="360"></canvas>
      <div class="zoom-row">
        <span>放大檢視</span>
        <input id="gd-zoom" type="range" min="1" max="6" step="0.5" value="1" style="flex:1;" />
        <span id="gd-zoom-val">1×</span>
        <span>（1×＝完整場景真實比例）</span>
      </div>
    </div>
    <div class="col-inspector">
      <div class="preset-row">
        <label for="gd-preset-select">守護波 Preset</label>
        <select id="gd-preset-select"></select>
      </div>
      <div class="section-title">守護參數（Guard）</div>
      <div id="gd-inspector"></div>
      <div class="section-title">開場演出（Intro）</div>
      <div id="gd-intro-inspector"></div>
      <div class="hint">補怪設定（同時上限／間隔／敵種權重）已移到「關卡編輯器」的守護節點 per-wave 設定。此處只設 preset 共用參數。</div>
    </div>
  </div>
</div>
<div id="status">就緒。上方切換火雨／守護波分頁，各自調參數。套用時分別存兩份 override（火雨、守護），遊戲端各自讀取。</div>
`;

/** 編輯器樣式（命名空間 .tb-editor-root）；原 100vh 併頁改吃容器高。 */
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
.tb-editor-root .tabs { display: flex; gap: 4px; padding: 8px 16px 0; background: var(--panel); border-bottom: 1px solid var(--line); flex: 0 0 auto; }
.tb-editor-root .tab { padding: 8px 18px; border: 1px solid var(--line); border-bottom: none; border-radius: 8px 8px 0 0; background: var(--panel2); cursor: pointer; color: var(--muted); }
.tb-editor-root .tab.active { background: var(--bg); color: var(--text); border-color: var(--accent); font-weight: bold; }
.tb-editor-root .tabpane { display: none; flex: 1; min-height: 0; }
.tb-editor-root .tabpane.active { display: flex; flex-direction: column; }
.tb-editor-root .layout { display: flex; flex: 1; min-height: 0; }
.tb-editor-root .stage-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #14141f; overflow: auto; gap: 6px; }
.tb-editor-root canvas.preview { background: var(--stage); outline: 1px solid var(--line); }
.tb-editor-root .col-inspector { width: 400px; border-left: 1px solid var(--line); padding: 12px; overflow-y: auto; background: var(--panel); }
.tb-editor-root .section-title { color: var(--muted); font-size: 12px; text-transform: uppercase; margin: 12px 0 8px; letter-spacing: 0.5px; }
.tb-editor-root .row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tb-editor-root .row label { width: 190px; color: var(--muted); }
.tb-editor-root .row input[type=range] { flex: 1; }
.tb-editor-root .row input[type=number] { width: 74px; text-align: right; }
.tb-editor-root #status { padding: 8px 16px; font-size: 13px; white-space: pre-wrap; border-top: 1px solid var(--line); background: var(--panel); max-height: 110px; overflow-y: auto; flex: 0 0 auto; }
.tb-editor-root .status-ok { color: var(--ok); } .tb-editor-root .status-err { color: var(--danger); }
.tb-editor-root .hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
.tb-editor-root .preset-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.tb-editor-root .preset-row label { color: var(--muted); }
.tb-editor-root .zoom-row { font-size:12px;color:#9a9ab5;display:flex;align-items:center;gap:8px;width:640px; }
`;

const EDITOR_STYLE_ID = 'tb-event-editor-style';

function ensureEditorStyle(): void {
  if (document.getElementById(EDITOR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = EDITOR_STYLE_ID;
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}

/**
 * 掛載事件編輯器（火雨+守護併頁）到指定容器（EditorMountFn）：注入 HTML+樣式 → main()
 * （含 fr/gdInitLoad 雙回顯 + 內部 tab 切換 + 綁事件）。回傳 { unmount() } 清 DOM。無全域 keydown / 無試玩 iframe。
 */
export function mount(container: HTMLElement): { unmount(): void } {
  ensureEditorStyle();
  container.classList.add('tb-editor-root');
  container.innerHTML = EDITOR_BODY_HTML;
  editorRoot = container;

  // 重置狀態（反覆開關 overlay：回乾淨初值，fr/gdInitLoad 再讀 override 回顯）。
  frFile = defaultFireRainFile();
  frCurrent = Object.keys(frFile.presets)[0] ?? 'FireRain';
  gdFile = defaultGuardFile();
  gdCurrent = Object.keys(gdFile.presets)[0] ?? 'Guard60';
  activeTab = 'firerain';

  main(); // schema-version + fr/gdInitLoad 回顯 + 內部 tab + 綁事件

  return {
    unmount(): void {
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

