/**
 * 火雨編輯器（獨立進入點）— 可視化調整火雨 preset 參數（七輪#1）。
 *
 * 架構（對齊 dash-editor）：獨立 Vite entry（firerain-editor/index.html），與遊戲分開打包。
 * 只 import fireRainSchema（零 Phaser，型別 + 驗證 + FIRE_RAIN_PRESETS 當初值）+ editorStore（套用契約）。
 * 功能：preset 下拉 → 8 欄拖軸+數字框（含小數）→ canvas 預覽火柱半徑（角色參照 + 真實比例 + 放大）→
 *      驗證並下載 JSON / 載入 JSON / 套用到遊戲（localStorage override）/ 套用並回到遊戲 / 清除。
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
  EDITOR_STORE_KEYS,
  applyToGame,
  clearOverride,
  loadOverride,
} from '@/config/editorStore';

const PPU = 100; // 對照 gameConfig.PPU=100（本檔自持，不 import 遊戲檔）
const REF_SPRITE_SIZE = 269; // 角色 sprite 顯示尺寸
const SCENE_W = 1920;
let previewZoom = 1;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

let file: FireRainFile = defaultFireRainFile();
let currentPreset: string = Object.keys(file.presets)[0] ?? 'FireRain';

const refSprite = new Image();
let refLoaded = false;
refSprite.addEventListener('load', () => { refLoaded = true; render(); });
refSprite.addEventListener('error', () => { refLoaded = false; render(); });
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
  num.min = String(opts.min); num.max = String(opts.max); num.step = 'any';
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

function preset(): FireRainPreset {
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
  const insp = $('firerain-inspector');
  insp.innerHTML = '';
  const p = preset();
  if (!p) return;
  insp.appendChild(numberRow('落下間隔 interval (s)', p.intervalSec, (v) => { p.intervalSec = v; }, { min: 0, max: 5, step: 0.1 }));
  insp.appendChild(numberRow('火柱半徑 radius (px)', p.radiusPx, (v) => { p.radiusPx = v; }, { min: 0, max: 300, step: 5 }));
  insp.appendChild(numberRow('預警時間 warning (s)', p.warningSec, (v) => { p.warningSec = v; }, { min: 0, max: 3, step: 0.1 }));
  insp.appendChild(numberRow('傷害 damage', p.damage, (v) => { p.damage = v; }, { min: 0, max: 20, step: 1 }));
  insp.appendChild(numberRow('同時在途上限 maxConcurrent', p.maxConcurrent, (v) => { p.maxConcurrent = Math.round(v); }, { min: 1, max: 12, step: 1 }));
  insp.appendChild(numberRow('每批道數 burstCount', p.burstCount, (v) => { p.burstCount = Math.round(v); }, { min: 1, max: 8, step: 1 }));
  insp.appendChild(numberRow('縮邊距離 edgeMargin (px)', p.edgeMarginPx, (v) => { p.edgeMarginPx = v; }, { min: 0, max: 400, step: 10 }));
  insp.appendChild(numberRow('持續時間 duration (s)', p.durationSec, (v) => { p.durationSec = v; }, { min: 0, max: 120, step: 1 }));
}

/** 預覽：完整場景等比縮 × previewZoom；畫角色參照 + 火柱範圍圈（半徑真實比例）。 */
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
  const rPx = p.radiusPx * sceneScale;

  // 火柱預警圈（橘）+ 中心落點。
  ctx.strokeStyle = '#ff9d5c'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, rPx, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,120,40,0.18)';
  ctx.beginPath(); ctx.arc(cx, cy, rPx, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff6c3c';
  ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();

  // 角色參照（在火柱旁，示意相對大小）。
  const sprPx = REF_SPRITE_SIZE * sceneScale;
  const px = cx + rPx + sprPx * 0.6;
  if (refLoaded) {
    ctx.drawImage(refSprite, px - sprPx / 2, cy - sprPx / 2, sprPx, sprPx);
  } else {
    ctx.strokeStyle = '#8a8aa5'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, cy, sprPx / 3, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = '#9a9ab5'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`火柱半徑 ${p.radiusPx.toFixed(0)}px（顯示 ×${sceneScale.toFixed(2)}）｜每批 ${p.burstCount} 道／${p.intervalSec}s，同時上限 ${p.maxConcurrent}`, 8, H - 10);
}

function refreshAll(): void { buildPresetSelect(); buildInspector(); render(); }

/** 開啟載入（匯入回顯）：優先讀 localStorage override 回填 file（override presets 疊在打包預設上，全 preset 都在），無/壞→打包預設。 */
function initLoad(): void {
  const raw = loadOverride(EDITOR_STORE_KEYS.firerain);
  if (raw !== null) {
    const r = validateFireRain(raw);
    if (r.ok) {
      // 疊在打包預設上：override 覆蓋同名、保留未覆蓋的打包 preset（編輯器看得到全部）。
      const base = defaultFireRainFile();
      file = { version: base.version, presets: { ...base.presets, ...r.data.presets } };
      currentPreset = Object.keys(file.presets)[0];
      refreshAll();
      setStatus('已載入你上次套用到遊戲的火雨設定（可繼續編）。', 'ok');
      return;
    }
    setStatus('已套用的火雨設定驗證失敗，退回打包預設。', 'err');
  }
  file = defaultFireRainFile();
  currentPreset = Object.keys(file.presets)[0];
  refreshAll();
}

function main(): void {
  $('schema-version').textContent = `schema v${FIRE_RAIN_SCHEMA_VERSION}`;
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

  $('btn-load-default').addEventListener('click', () => { file = defaultFireRainFile(); currentPreset = Object.keys(file.presets)[0]; refreshAll(); setStatus('已載入打包預設火雨 preset。', 'info'); });
  $('btn-reset').addEventListener('click', () => { file = defaultFireRainFile(); currentPreset = Object.keys(file.presets)[0]; refreshAll(); setStatus('已重設為預設值。', 'info'); });

  $('btn-load-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        file = assertValidFireRain(json);
        currentPreset = Object.keys(file.presets)[0];
        refreshAll();
        const applied = applyToGame(EDITOR_STORE_KEYS.firerain, file);
        setStatus(applied ? '已載入 JSON 並套用到遊戲（重開仍在）。' : '已載入 JSON（套用失敗：localStorage 不可用）。', applied ? 'ok' : 'err');
      } catch (err) {
        setStatus(`載入失敗：${(err as Error).message}`, 'err');
      }
    };
    reader.readAsText(f);
  });

  $('btn-export').addEventListener('click', () => {
    const res = validateFireRain(file);
    if (!res.ok) { setStatus(`驗證失敗：\n${res.errors.join('\n')}`, 'err'); return; }
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'firerain.json'; a.click();
    URL.revokeObjectURL(a.href);
    setStatus('已驗證並下載 firerain.json。', 'ok');
  });

  $('btn-apply').addEventListener('click', () => void applyFireRainToGame());
  $('btn-apply-return').addEventListener('click', () => {
    if (!applyFireRainToGame()) return;
    setStatus('✅ 已套用，返回遊戲中…', 'ok');
    window.location.href = '../';
  });
  $('btn-clear-apply').addEventListener('click', () => {
    clearOverride(EDITOR_STORE_KEYS.firerain);
    setStatus('已清除套用，遊戲將回到打包預設火雨參數。', 'info');
  });
}

/** 套用火雨 preset 到遊戲（匯入機制）：validate 過才存 localStorage。回傳是否成功。 */
function applyFireRainToGame(): boolean {
  const res = validateFireRain(file);
  if (!res.ok) { setStatus(`套用失敗（驗證未過）：\n${res.errors.join('\n')}`, 'err'); return false; }
  const ok = applyToGame(EDITOR_STORE_KEYS.firerain, res.data);
  setStatus(ok ? '✅ 已套用到遊戲（存入瀏覽器）。重開遊戲即生效。' : '套用失敗：瀏覽器 localStorage 不可用。', ok ? 'ok' : 'err');
  return ok;
}

main();
