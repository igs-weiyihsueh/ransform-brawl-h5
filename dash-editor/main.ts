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
  type DashConfig,
  type DashFile,
} from '@/config/dashSchema';
import {
  EDITOR_STORE_KEYS,
  applyToGame,
  clearOverride,
} from '@/config/editorStore';

const PPU = 100; // 對照 gameConfig.PPU=100（本檔自持，不 import 遊戲檔）
const REF_SPRITE_SIZE = 269; // 角色 sprite 顯示尺寸（FRAME_SIZE256×SPRITE_SCALE≈1.05）
const SCENE_W = 1920;
const SCENE_H = 1080;
let previewZoom = 1;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

let file: DashFile = defaultDashFile();

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

function main(): void {
  $('schema-version').textContent = `schema v${DASH_SCHEMA_VERSION}`;
  refreshAll();

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
        setStatus('已載入 JSON 並驗證通過。', 'ok');
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

  $('btn-apply').addEventListener('click', () => {
    const res = validateDash(file);
    if (!res.ok) { setStatus(`套用失敗（驗證未過）：\n${res.errors.join('\n')}`, 'err'); return; }
    const ok = applyToGame(EDITOR_STORE_KEYS.dash, res.data);
    setStatus(ok ? '✅ 已套用到遊戲（存入瀏覽器）。重開遊戲即生效。' : '套用失敗：瀏覽器 localStorage 不可用。', ok ? 'ok' : 'err');
  });
  $('btn-clear-apply').addEventListener('click', () => {
    clearOverride(EDITOR_STORE_KEYS.dash);
    setStatus('已清除套用，遊戲將回到打包預設衝刺參數。', 'info');
  });
}

main();
