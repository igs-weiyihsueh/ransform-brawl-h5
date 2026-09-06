/**
 * 守護波編輯器（獨立進入點）— 可視化調整守護波 preset 參數（七輪#2）。
 *
 * 架構（對齊 dash-editor/firerain-editor）：獨立 Vite entry，與遊戲分開打包。
 * 只 import guardSchema（零 Phaser，型別 + 驗證 + GUARD_PRESETS 當初值）+ editorStore（套用契約）。
 * 功能：preset 下拉 → 守護/開場/敵種權重 numberRow（含小數）→ canvas 預覽四角定位 + spotlight →
 *      驗證並下載 JSON / 載入 JSON / 套用到遊戲 / 套用並回到遊戲 / 清除。
 */
import {
  GUARD_SCHEMA_VERSION,
  defaultGuardFile,
  validateGuard,
  assertValidGuard,
  type GuardFile,
} from '@/config/guardSchema';
import type { GuardPreset } from '@/config/guardConfig';
import { getEnemyTypeKeys } from '@/config/enemySchema';
import {
  EDITOR_STORE_KEYS,
  applyToGame,
  clearOverride,
  loadOverride,
} from '@/config/editorStore';

const SCENE_W = 1920;
let previewZoom = 1;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

let file: GuardFile = defaultGuardFile();
let currentPreset: string = Object.keys(file.presets)[0] ?? 'Guard60';

function setStatus(msg: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  const el = $('status');
  el.textContent = msg;
  el.className = kind === 'ok' ? 'status-ok' : kind === 'err' ? 'status-err' : '';
}

function numberRow(
  label: string,
  value: number,
  set: (v: number) => void,
  opts: { min: number; max: number; step: number; int?: boolean },
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
    set(c); render();
  };
  slider.addEventListener('input', () => commit(slider.value));
  num.addEventListener('change', () => commit(num.value));
  row.appendChild(lab); row.appendChild(slider); row.appendChild(num);
  return row;
}

function preset(): GuardPreset {
  return file.presets[currentPreset];
}

function buildPresetSelect(): void {
  const sel = $<HTMLSelectElement>('preset-select');
  sel.innerHTML = '';
  for (const name of Object.keys(file.presets)) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if (name === currentPreset) opt.selected = true;
    sel.appendChild(opt);
  }
}

function buildInspector(): void {
  const p = preset();
  if (!p) return;

  const guard = $('guard-inspector');
  guard.innerHTML = '';
  guard.appendChild(numberRow('時間限制 timeLimit (s)', p.timeLimit, (v) => { p.timeLimit = v; }, { min: 0, max: 300, step: 1 }));
  guard.appendChild(numberRow('雕像 HP targetHP', p.targetHP, (v) => { p.targetHP = v; }, { min: 1, max: 1000, step: 5 }));
  guard.appendChild(numberRow('獎券 rewardTickets', p.rewardTickets, (v) => { p.rewardTickets = v; }, { min: 0, max: 100, step: 1 }));
  guard.appendChild(numberRow('場上上限 maxAlive', p.maxAlive, (v) => { p.maxAlive = v; }, { min: 0, max: 30, step: 1, int: true }));
  guard.appendChild(numberRow('補怪門檻 spawnThreshold', p.spawnThreshold, (v) => { p.spawnThreshold = v; }, { min: 0, max: 30, step: 1, int: true }));
  guard.appendChild(numberRow('補怪間隔 spawnInterval (s)', p.spawnInterval, (v) => { p.spawnInterval = v; }, { min: 0, max: 10, step: 0.1 }));
  guard.appendChild(numberRow('生成環繞半徑 spawnRadius (px)', p.spawnRadiusPx, (v) => { p.spawnRadiusPx = v; }, { min: 0, max: 800, step: 10 }));

  const intro = $('intro-inspector');
  intro.innerHTML = '';
  intro.appendChild(numberRow('四角 X 偏移 cornerOffsetX (px)', p.cornerOffsetXPx, (v) => { p.cornerOffsetXPx = v; }, { min: 0, max: 600, step: 10 }));
  intro.appendChild(numberRow('四角 Y 偏移 cornerOffsetY (px)', p.cornerOffsetYPx, (v) => { p.cornerOffsetYPx = v; }, { min: 0, max: 600, step: 10 }));
  intro.appendChild(numberRow('聚焦壓暗 introFocus (s)', p.introFocusSec, (v) => { p.introFocusSec = v; }, { min: 0, max: 8, step: 0.1 }));
  intro.appendChild(numberRow('走位逾時 maxWalk (s)', p.maxWalkSec, (v) => { p.maxWalkSec = v; }, { min: 0, max: 10, step: 0.1 }));
  intro.appendChild(numberRow('spotlight 半徑 (px)', p.spotlightRadiusPx, (v) => { p.spotlightRadiusPx = v; }, { min: 0, max: 800, step: 10 }));

  const spawns = $('spawns-inspector');
  spawns.innerHTML = '';
  p.spawns.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    const inner = numberRow(`${s.enemyType} 權重`, s.weight, (v) => { p.spawns[i].weight = v; }, { min: 0, max: 1, step: 0.05 });
    // 移到 row 裡並加刪除鈕。
    while (inner.firstChild) row.appendChild(inner.firstChild);
    const del = document.createElement('button');
    del.textContent = '✕'; del.title = '移除此敵種';
    del.addEventListener('click', () => { p.spawns.splice(i, 1); buildInspector(); render(); });
    row.appendChild(del);
    spawns.appendChild(row);
  });
  // 可維護性根治：「＋新增敵種」下拉＝動態讀 enemies 單一來源，列出尚未在 spawns 的怪。
  const already = new Set(p.spawns.map((s) => s.enemyType));
  const addable = getEnemyTypeKeys().filter((k) => !already.has(k));
  if (addable.length > 0) {
    const addRow = document.createElement('div');
    addRow.className = 'row';
    const sel = document.createElement('select');
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = '＋新增敵種…'; sel.appendChild(ph);
    for (const k of addable) {
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = k; sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      p.spawns.push({ enemyType: sel.value, weight: 0.2 });
      buildInspector(); render();
    });
    addRow.appendChild(sel);
    spawns.appendChild(addRow);
  }
}

/** 預覽：畫雕像（場中央）+ 四角定位藍點 + spotlight 黃圈 + 生成環繞圈（真實比例）。 */
function render(): void {
  const cv = $<HTMLCanvasElement>('preview');
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#10101c'; ctx.fillRect(0, 0, W, H);

  const sceneScale = (W / SCENE_W) * previewZoom;
  const cx = W / 2, cy = H / 2;
  const p = preset();
  if (!p) return;

  // spotlight 亮圈（黃）。
  ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, p.spotlightRadiusPx * sceneScale, 0, Math.PI * 2); ctx.stroke();
  // 生成環繞圈（灰）。
  ctx.strokeStyle = '#59d98e'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.arc(cx, cy, p.spawnRadiusPx * sceneScale, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  // 雕像（場中央方塊示意）。
  const stW = 60 * sceneScale, stH = 90 * sceneScale;
  ctx.fillStyle = '#6c8cff'; ctx.fillRect(cx - stW / 2, cy - stH / 2, stW, stH);
  ctx.fillStyle = '#9a9ab5'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('雕像', cx, cy + stH / 2 + 14);

  // 四角定位藍點（玩家走位目標）。
  const ox = p.cornerOffsetXPx * sceneScale, oy = p.cornerOffsetYPx * sceneScale;
  const corners = [[cx - ox, cy - oy], [cx + ox, cy - oy], [cx - ox, cy + oy], [cx + ox, cy + oy]];
  ctx.fillStyle = '#59d98e';
  corners.forEach(([x, y], i) => {
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e6e6f0'; ctx.fillText(`P${i + 1}`, x, y - 10); ctx.fillStyle = '#59d98e';
  });

  ctx.fillStyle = '#9a9ab5'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`HP ${p.targetHP}｜${p.timeLimit}s｜四角±(${p.cornerOffsetXPx},${p.cornerOffsetYPx})px｜spotlight ${p.spotlightRadiusPx}px（顯示 ×${sceneScale.toFixed(2)}）`, 8, H - 10);
}

function refreshAll(): void { buildPresetSelect(); buildInspector(); render(); }

/** 開啟載入（匯入回顯）：優先讀 localStorage override 回填 file（override presets 疊打包預設上），無/壞→打包預設。 */
function initLoad(): void {
  const raw = loadOverride(EDITOR_STORE_KEYS.guard);
  if (raw !== null) {
    const r = validateGuard(raw);
    if (r.ok) {
      const base = defaultGuardFile();
      file = { version: base.version, presets: { ...base.presets, ...r.data.presets } };
      currentPreset = Object.keys(file.presets)[0];
      refreshAll();
      setStatus('已載入你上次套用到遊戲的守護設定（可繼續編）。', 'ok');
      return;
    }
    setStatus('已套用的守護設定驗證失敗，退回打包預設。', 'err');
  }
  file = defaultGuardFile();
  currentPreset = Object.keys(file.presets)[0];
  refreshAll();
}

function main(): void {
  $('schema-version').textContent = `schema v${GUARD_SCHEMA_VERSION}`;
  initLoad(); // 匯入回顯：開啟優先讀 localStorage override 回填，無則打包預設

  $<HTMLSelectElement>('preset-select').addEventListener('change', (e) => {
    currentPreset = (e.target as HTMLSelectElement).value;
    buildInspector(); render();
  });

  $('preview-zoom').addEventListener('input', (e) => {
    previewZoom = parseFloat((e.target as HTMLInputElement).value);
    $('preview-zoom-val').textContent = `${previewZoom}×`;
    render();
  });

  $('btn-load-default').addEventListener('click', () => { file = defaultGuardFile(); currentPreset = Object.keys(file.presets)[0]; refreshAll(); setStatus('已載入打包預設守護 preset。', 'info'); });
  $('btn-reset').addEventListener('click', () => { file = defaultGuardFile(); currentPreset = Object.keys(file.presets)[0]; refreshAll(); setStatus('已重設為預設值。', 'info'); });

  $('btn-load-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        file = assertValidGuard(json);
        currentPreset = Object.keys(file.presets)[0];
        refreshAll();
        const applied = applyToGame(EDITOR_STORE_KEYS.guard, file);
        setStatus(applied ? '已載入 JSON 並套用到遊戲（重開仍在）。' : '已載入 JSON（套用失敗：localStorage 不可用）。', applied ? 'ok' : 'err');
      } catch (err) {
        setStatus(`載入失敗：${(err as Error).message}`, 'err');
      }
    };
    reader.readAsText(f);
  });

  $('btn-export').addEventListener('click', () => {
    const res = validateGuard(file);
    if (!res.ok) { setStatus(`驗證失敗：\n${res.errors.join('\n')}`, 'err'); return; }
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'guard.json'; a.click();
    URL.revokeObjectURL(a.href);
    setStatus('已驗證並下載 guard.json。', 'ok');
  });

  $('btn-apply').addEventListener('click', () => void applyGuardToGame());
  $('btn-apply-return').addEventListener('click', () => {
    if (!applyGuardToGame()) return;
    setStatus('✅ 已套用，返回遊戲中…', 'ok');
    window.location.href = '../';
  });
  $('btn-clear-apply').addEventListener('click', () => {
    clearOverride(EDITOR_STORE_KEYS.guard);
    setStatus('已清除套用，遊戲將回到打包預設守護參數。', 'info');
  });
}

/** 套用守護 preset 到遊戲（匯入機制）：validate 過才存 localStorage。回傳是否成功。 */
function applyGuardToGame(): boolean {
  const res = validateGuard(file);
  if (!res.ok) { setStatus(`套用失敗（驗證未過）：\n${res.errors.join('\n')}`, 'err'); return false; }
  const ok = applyToGame(EDITOR_STORE_KEYS.guard, res.data);
  setStatus(ok ? '✅ 已套用到遊戲（存入瀏覽器）。重開遊戲即生效。' : '套用失敗：瀏覽器 localStorage 不可用。', ok ? 'ok' : 'err');
  return ok;
}

main();
