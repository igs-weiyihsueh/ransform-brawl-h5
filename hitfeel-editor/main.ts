/**
 * 打擊手感編輯器（獨立進入點）— 即時調 hitFeelConfig 的 HIT_FEEL 參數 + canvas 預覽。
 *
 * 架構：獨立 Vite entry（hitfeel-editor/index.html），與遊戲分開打包，純前端零 Phaser。
 * 只 import hitFeelConfig（純資料/純函式、無 Phaser runtime）當初始值。
 *
 * 功能：右側控制項（slider/number/color/checkbox）改 HIT_FEEL 副本 → 左側 canvas 打擊預覽
 * （用當前參數重演 白閃/punch/火花/擊退/頓幀/死亡粒子；預覽用 canvas 2D 自繪，行為對齊遊戲
 * EffectSystem 的視覺）→ 複製參數 / 下載 JSON 貼回 hitFeelConfig / 第十一輪：套用到遊戲（localStorage override）。
 */
import { HIT_FEEL, type HitFeelConfig } from '@/config/hitFeelConfig';
import {
  HIT_FEEL_SCHEMA_VERSION,
  validateHitFeel,
  type HitFeelFile,
} from '@/config/hitFeelSchema';
import { applyToGame, clearOverride, loadOverride, EDITOR_STORE_KEYS } from '@/config/editorStore';

/** 對照 gameConfig.PPU=100（本檔自持，不 import 遊戲 runtime）。 */
const PPU = 100;

/**
 * mount 化（方案 A' 遊戲內展開）：DOM 查找 scope 進 editorRoot（overlay 容器），不吃 document 全域。
 * 獨立頁 /hitfeel-editor/ 仍可用（並存）。hitfeel 無 localStorage 套用機制（複製/下載工作流）→ 唯讀：
 * 保留下載/複製 JSON 鈕，無「套用到遊戲」鈕；「回到遊戲」導覽鈕在 overlay 內禁用（會離開遊戲頁）。
 */
let editorRoot: HTMLElement = document.body;
let mounted = false;
let rafId = 0;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = editorRoot.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

// ---- 狀態：HIT_FEEL 的可編輯副本 ----
let cfg: HitFeelConfig = { ...HIT_FEEL };

function hexColor(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}
function parseHex(s: string): number {
  return parseInt(s.replace('#', ''), 16) || 0;
}

// ---- 控制項建構 ----

interface NumSpec {
  key: keyof HitFeelConfig;
  label: string;
  min: number;
  max: number;
  step: number;
}

function numberRow(spec: NumSpec): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';
  const label = document.createElement('label');
  label.textContent = spec.label;
  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(spec.min);
  range.max = String(spec.max);
  range.step = String(spec.step);
  range.value = String(cfg[spec.key]);
  const num = document.createElement('input');
  num.type = 'number';
  num.min = String(spec.min);
  num.max = String(spec.max);
  num.step = String(spec.step);
  num.value = String(cfg[spec.key]);
  const sync = (v: number): void => {
    (cfg[spec.key] as number) = v;
    range.value = String(v);
    num.value = String(v);
    refreshExport();
  };
  range.addEventListener('input', () => sync(Number(range.value)));
  num.addEventListener('input', () => sync(Number(num.value)));
  row.append(label, range, num);
  return row;
}

function colorRow(key: keyof HitFeelConfig, label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const color = document.createElement('input');
  color.type = 'color';
  color.value = hexColor(cfg[key] as number);
  color.addEventListener('input', () => {
    (cfg[key] as number) = parseHex(color.value);
    refreshExport();
  });
  row.append(lab, color);
  return row;
}

function boolRow(key: keyof HitFeelConfig, label: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.checked = cfg[key] as boolean;
  chk.addEventListener('change', () => {
    (cfg[key] as boolean) = chk.checked;
    refreshExport();
  });
  row.append(lab, chk);
  return row;
}

function buildControls(): void {
  $('ctrl-enabled').replaceChildren(boolRow('enabled', '啟用 hitFeel'));
  $('ctrl-flash').replaceChildren(
    colorRow('hitFlashColor', '白閃顏色'),
    numberRow({ key: 'hitFlashDuration', label: '白閃時長(秒)', min: 0, max: 0.5, step: 0.01 }),
  );
  $('ctrl-punch').replaceChildren(
    numberRow({ key: 'punchScale', label: 'punch 幅度', min: 0, max: 1, step: 0.05 }),
  );
  $('ctrl-spark').replaceChildren(
    boolRow('hitSparkEnabled', '啟用火花'),
    colorRow('hitSparkColor', '火花顏色'),
  );
  $('ctrl-freeze').replaceChildren(
    numberRow({ key: 'microFreezeDuration', label: '敵人頓幀(秒)', min: 0, max: 0.3, step: 0.01 }),
    numberRow({ key: 'playerHitlagDuration', label: '玩家 hitlag(秒)', min: 0, max: 0.3, step: 0.01 }),
  );
  $('ctrl-knockback').replaceChildren(
    numberRow({ key: 'knockbackDuration', label: '擊退時長(秒)', min: 0, max: 0.6, step: 0.01 }),
    numberRow({ key: 'knockbackForceScale', label: 'force 比例', min: 0, max: 1, step: 0.01 }),
    numberRow({ key: 'knockbackDistance', label: '距離上限(unit)', min: 0, max: 5, step: 0.1 }),
  );
  $('ctrl-death').replaceChildren(colorRow('deathParticleColor', '死亡粒子顏色'));
}

// ---- 匯出 ----

function refreshExport(): void {
  ($('export-box') as HTMLTextAreaElement).value = JSON.stringify(cfg, null, 2);
}

// ---- Canvas 打擊預覽（純 canvas2D，重演 EffectSystem 的視覺，吃當前 cfg） ----
// mount 化：這些原為 import 時 $('preview') 讀取的 const，改延遲到 mount() 注入 HTML 後才綁定（let）。

let canvas: HTMLCanvasElement = document.createElement('canvas');
let g2: CanvasRenderingContext2D = canvas.getContext('2d')!;
let W = canvas.width;
let H = canvas.height;
const enemy = { x: 0, y: 0, baseSize: 72 };
const attacker = { x: 0, y: 0 };

/** mount 時綁定 canvas 快取（HTML 注入後呼叫）。 */
function bindCanvas(): void {
  canvas = $('preview') as HTMLCanvasElement;
  g2 = canvas.getContext('2d')!;
  W = canvas.width;
  H = canvas.height;
  enemy.x = W * 0.62; enemy.y = H * 0.5;
  attacker.x = W * 0.3; attacker.y = H * 0.5;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; r: number; }
let particles: Particle[] = [];
let flashUntil = 0;
let punchStart = -1;
let kbStart = -1;
let kbDistPx = 0;
let kbDur = 0;
let freezeUntil = 0;
let playerHitlagUntil = 0;
let enemyOffsetX = 0;
let dead = false;
let deathAt = 0;

function now(): number {
  return performance.now() / 1000;
}

/** 觸發一次受擊：套用當前 cfg 的白閃/punch/火花/擊退/頓幀。 */
function triggerHit(): void {
  if (!cfg.enabled) {
    setStatus('hitFeel 已停用（enabled=false）—— 開啟才有表演。', false);
    return;
  }
  const t = now();
  dead = false;
  enemyOffsetX = 0;
  flashUntil = t + cfg.hitFlashDuration;
  punchStart = t;
  freezeUntil = t + cfg.microFreezeDuration;
  playerHitlagUntil = t + cfg.playerHitlagDuration; // 玩家側 hitlag（攻擊者凍）
  // 擊退：方向 = 遠離攻擊者（攻擊者在左 → 往右退）。距離 = clamp(force×scale, 0, dist)×PPU。
  const force = 3; // 預覽用一個代表性攻擊力道
  const distUnit = Math.min(Math.max(force * cfg.knockbackForceScale, 0), cfg.knockbackDistance);
  kbDistPx = distUnit * PPU;
  kbDur = cfg.knockbackDuration;
  kbStart = t;
  // 火花：從敵人往右噴。
  if (cfg.hitSparkEnabled) spawnSpark(enemy.x, enemy.y, 1, 0, hexColor(cfg.hitSparkColor), 5);
  setStatus('▶ 觸發受擊：白閃/punch/火花/擊退/頓幀（當前參數）。', true);
}

function triggerDeath(): void {
  if (!cfg.enabled) {
    setStatus('hitFeel 已停用。', false);
    return;
  }
  dead = true;
  deathAt = now();
  spawnSpark(enemy.x + enemyOffsetX, enemy.y, 0, 0, hexColor(cfg.deathParticleColor), 10, true);
  setStatus('💀 觸發死亡粒子（當前顏色）。', true);
}

function spawnSpark(x: number, y: number, dx: number, dy: number, color: string, count: number, radial = false): void {
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 0; i < count; i += 1) {
    let ax: number;
    let ay: number;
    if (radial) {
      const a = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      ax = Math.cos(a);
      ay = Math.sin(a);
    } else {
      const spread = (i - (count - 1) / 2) * 0.4;
      const nx = dx / len;
      const ny = dy / len;
      ax = nx * Math.cos(spread) - ny * Math.sin(spread);
      ay = nx * Math.sin(spread) + ny * Math.cos(spread);
    }
    const speed = radial ? 60 + Math.random() * 60 : 90 + Math.random() * 90;
    particles.push({
      x, y, vx: ax * speed, vy: ay * speed,
      life: 0, max: radial ? 0.4 : 0.22, color, r: radial ? 5 : 4,
    });
  }
}

function setStatus(msg: string, ok: boolean): void {
  const s = $('status');
  s.textContent = msg;
  s.className = ok ? 'status-ok' : 'status-err';
}

let lastFrame = now();
function loop(): void {
  const t = now();
  const dt = Math.min(0.05, t - lastFrame);
  lastFrame = t;

  // 擊退推進（快進快出：kbDur 內線性到 kbDistPx，往右）。
  if (kbStart >= 0) {
    const p = (t - kbStart) / (kbDur || 0.0001);
    if (p >= 1) { enemyOffsetX = kbDistPx; kbStart = -1; }
    else enemyOffsetX = kbDistPx * p;
  }

  // 粒子推進。
  for (const pt of particles) {
    pt.life += dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
  }
  particles = particles.filter((p) => p.life < p.max);

  draw(t);
  if (mounted) rafId = requestAnimationFrame(loop);
}

function draw(t: number): void {
  g2.clearRect(0, 0, W, H);
  // 背景格
  g2.fillStyle = '#10101c';
  g2.fillRect(0, 0, W, H);

  // 攻擊者（左，藍方塊）標示方向。hitlag 期間高亮 + 標記（玩家自身凍住）。
  const inPlayerHitlag = t < playerHitlagUntil;
  g2.fillStyle = inPlayerHitlag ? '#8fb6ff' : '#4f80c0';
  g2.fillRect(attacker.x - 16, attacker.y - 24, 32, 48);
  g2.fillStyle = '#9ab';
  g2.font = '12px sans-serif';
  g2.fillText('攻擊者', attacker.x - 20, attacker.y + 42);
  if (inPlayerHitlag) {
    g2.fillStyle = '#fff';
    g2.fillText('❄hitlag', attacker.x - 24, attacker.y - 32);
  }

  // 敵人 sprite（假：橘方塊）+ punch scale + 白閃 + 擊退位移。
  let scale = 1;
  if (punchStart >= 0) {
    const pd = t - punchStart;
    const total = 0.12; // 快彈快回
    if (pd < total) {
      const half = total / 2;
      const k = pd < half ? pd / half : 1 - (pd - half) / half;
      scale = 1 + cfg.punchScale * k;
    } else punchStart = -1;
  }
  const size = enemy.baseSize * scale;
  const ex = enemy.x + enemyOffsetX;
  const ey = enemy.y;

  if (!dead) {
    g2.fillStyle = '#c8783c';
    g2.fillRect(ex - size / 2, ey - size / 2, size, size);
    // 白閃（setTintFill 等效：整塊覆蓋白閃色）。
    if (t < flashUntil) {
      g2.fillStyle = hexColor(cfg.hitFlashColor);
      g2.fillRect(ex - size / 2, ey - size / 2, size, size);
    }
  } else {
    // 死亡淡出。
    const dp = Math.min(1, (t - deathAt) / 0.4);
    g2.globalAlpha = 1 - dp;
    g2.fillStyle = '#c8783c';
    g2.fillRect(ex - size / 2, ey - size / 2, size, size);
    g2.globalAlpha = 1;
  }

  // 頓幀提示（被凍時畫個小標記）。
  if (t < freezeUntil) {
    g2.fillStyle = '#fff';
    g2.font = '12px sans-serif';
    g2.fillText('❄頓幀', ex - 20, ey - size / 2 - 8);
  }

  // 粒子（火花/死亡）。
  for (const p of particles) {
    g2.globalAlpha = Math.max(0, 1 - p.life / p.max);
    g2.fillStyle = p.color;
    g2.beginPath();
    g2.arc(p.x, p.y, p.r * (1 - p.life / p.max * 0.7), 0, Math.PI * 2);
    g2.fill();
  }
  g2.globalAlpha = 1;
}

// ---- 綁定 ----

/** 目前編輯中的 cfg 包成匯出檔（{version, hitFeel}）。 */
function currentFile(): HitFeelFile {
  return { version: HIT_FEEL_SCHEMA_VERSION, hitFeel: { ...cfg } };
}

/**
 * 套用打擊感到遊戲（第十一輪，對齊其他編輯器）：validate 過才存 localStorage override；
 * @param andReturn true=套用成功後導覽回遊戲（獨立頁 window.location；overlay 內不導覽）。
 * @param standalone 是否獨立頁（overlay 內 andReturn 不導覽，避免離開遊戲頁弄壞 overlay）。
 */
function applyHitFeel(andReturn: boolean, standalone: boolean): boolean {
  const file = currentFile();
  const res = validateHitFeel(file);
  if (!res.ok) { setStatus(`套用失敗（驗證未過）：\n${res.errors.join('\n')}`, false); return false; }
  const ok = applyToGame(EDITOR_STORE_KEYS.hitfeel, res.data);
  if (!ok) { setStatus('套用失敗：瀏覽器 localStorage 不可用。', false); return false; }
  if (andReturn && standalone) {
    setStatus('✅ 已套用，返回遊戲中…', true);
    window.location.href = '../';
    return true;
  }
  setStatus(andReturn
    ? '✅ 已套用到遊戲（存入瀏覽器）。重開遊戲即生效（overlay 內請關閉面板重開遊戲）。'
    : '✅ 已套用到遊戲（存入瀏覽器）。重開遊戲即生效。', true);
  return true;
}

/** 匯入回顯（第十一輪）：開啟優先讀 localStorage override 回填 cfg；無/壞則用打包預設。 */
function initLoad(): void {
  const raw = loadOverride(EDITOR_STORE_KEYS.hitfeel);
  if (raw !== null) {
    const r = validateHitFeel(raw);
    if (r.ok) {
      cfg = { ...r.data.hitFeel };
      buildControls();
      refreshExport();
      setStatus('已載入你上次套用到遊戲的打擊感設定（可繼續編）。', true);
      return;
    }
    setStatus('已套用的打擊感設定驗證失敗，退回打包預設。', false);
  }
  cfg = { ...HIT_FEEL };
  buildControls();
  refreshExport();
}

/** 綁定所有 UI 事件（mount 時呼叫；原為 import 時的頂層綁定，改包成函式延遲到 HTML 注入後）。 */
function bindUI(standalone: boolean): void {
  $('btn-hit').addEventListener('click', triggerHit);
  $('btn-death').addEventListener('click', triggerDeath);
  $('btn-reset').addEventListener('click', () => {
    cfg = { ...HIT_FEEL };
    buildControls();
    refreshExport();
    setStatus('已重設為 hitFeelConfig 預設值。', true);
  });
  $('btn-copy').addEventListener('click', async () => {
    const text = JSON.stringify(cfg, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('已複製參數到剪貼簿，貼回 hitFeelConfig 的 HIT_FEEL 即可。', true);
    } catch {
      setStatus('複製失敗（瀏覽器權限）——請手動從「匯出」框選取複製。', false);
    }
  });
  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hitFeel.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('已下載 hitFeel.json。', true);
  });

  // 第十四輪：載入 JSON 檔（對齊 dash/enemy/skill 等編輯器「上傳即套用」）。
  $('btn-load-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let json: unknown;
      try { json = JSON.parse(String(reader.result)); }
      catch (err) { setStatus(`不是合法 JSON：${(err as Error).message}`, false); return; }
      // 接受兩種格式：{version, hitFeel}（下載/套用的完整檔）或裸 HitFeelConfig（舊複製貼上）。
      const wrapped = (json && typeof json === 'object' && 'hitFeel' in (json as object))
        ? json
        : { version: HIT_FEEL_SCHEMA_VERSION, hitFeel: json };
      const r = validateHitFeel(wrapped);
      if (!r.ok) { setStatus(`載入失敗（驗證未過）：\n${r.errors.join('\n')}`, false); return; }
      // 回填編輯器 cfg（套進參數面板，對齊 initLoad 回填邏輯）。
      cfg = { ...r.data.hitFeel };
      buildControls();
      refreshExport();
      // 上傳即套用（對齊其他編輯器上傳即套用慣例：存 localStorage override，重開仍在）。
      const applied = applyToGame(EDITOR_STORE_KEYS.hitfeel, r.data);
      setStatus(applied
        ? '已載入 JSON 並套用到遊戲（重開仍在）。'
        : '已載入 JSON（套用失敗：localStorage 不可用）。', applied);
    };
    reader.readAsText(f);
    (e.target as HTMLInputElement).value = ''; // 允許重選同檔再觸發 change
  });

  // 第十一輪：套用到遊戲（存 localStorage hitfeel override，對齊其他編輯器）。
  $('btn-apply').addEventListener('click', () => void applyHitFeel(false, standalone));
  $('btn-apply-return').addEventListener('click', () => void applyHitFeel(true, standalone));
  $('btn-clear-apply').addEventListener('click', () => {
    clearOverride(EDITOR_STORE_KEYS.hitfeel);
    setStatus('已清除套用，遊戲將回到打包預設打擊感（重開生效）。', true);
  });

  // hitfeel-editor 無 localStorage 套用機制（複製/下載貼回 hitFeelConfig 的工作流），
  // 「回到遊戲」只是純導覽 window.location.href='../'（獨立頁專用）。
  // ⚠️ overlay 內（standalone=false）此鈕會離開遊戲頁弄壞 overlay → 直接移除。
  const btnReturn = editorRoot.querySelector<HTMLButtonElement>('#btn-return');
  if (btnReturn) {
    if (standalone) {
      btnReturn.addEventListener('click', () => { window.location.href = '../'; });
    } else {
      btnReturn.remove(); // overlay 內：關閉走 overlay 自身的 ✕，不用這顆
    }
  }
}

// ---- mount 化（方案 A' 遊戲內展開 + 獨立頁並存） -------------------------

/** 編輯器 body HTML（從 hitfeel-editor/index.html <body> 搬來，去 <script>）。 */
const EDITOR_BODY_HTML = `
<header>
  <h1>打擊手感編輯器</h1>
  <span class="badge">hitFeelConfig · HIT_FEEL</span>
  <div class="spacer"></div>
  <button id="btn-reset">重設為預設值</button>
  <button id="btn-copy" class="primary">複製參數</button>
  <button id="btn-load-file">載入 JSON 檔…</button>
  <input id="file-input" type="file" accept="application/json,.json" hidden />
  <button id="btn-export">下載 JSON</button>
  <button id="btn-apply" class="primary" title="驗證後存入瀏覽器，重開遊戲即生效">套用到遊戲</button>
  <button id="btn-apply-return" class="primary" title="套用並立即返回遊戲">套用並回到遊戲</button>
  <button id="btn-clear-apply" title="移除套用，遊戲回打包預設">清除套用</button>
  <button id="btn-return" class="primary" title="回到遊戲頁">回到遊戲</button>
</header>
<div class="layout">
  <div class="stage-wrap">
    <canvas id="preview" width="480" height="420"></canvas>
    <div class="preview-controls">
      <button id="btn-hit" class="primary">▶ 觸發受擊（白閃+punch+火花+擊退+頓幀）</button>
      <button id="btn-death">💀 觸發死亡粒子</button>
    </div>
    <div class="hint">按鈕用「當前參數」即時播打擊表演，不用進遊戲。</div>
  </div>
  <div class="col-inspector">
    <div class="section-title">總開關</div>
    <div id="ctrl-enabled"></div>
    <div class="section-title">受擊白閃</div>
    <div id="ctrl-flash"></div>
    <div class="section-title">Punch 彈跳</div>
    <div id="ctrl-punch"></div>
    <div class="section-title">命中火花</div>
    <div id="ctrl-spark"></div>
    <div class="section-title">局部頓幀</div>
    <div id="ctrl-freeze"></div>
    <div class="section-title">擊退（快進快出）</div>
    <div id="ctrl-knockback"></div>
    <div class="section-title">死亡粒子</div>
    <div id="ctrl-death"></div>
    <div class="section-title">匯出</div>
    <textarea id="export-box" readonly></textarea>
  </div>
</div>
<div id="status">就緒。右側調參數，左側按「觸發受擊」即時預覽。調好按「套用到遊戲」即生效（重開讀新值）；亦可「下載 JSON」保存或貼回 hitFeelConfig。</div>
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
.tb-editor-root .layout { display: flex; flex: 1; min-height: 0; }
.tb-editor-root .stage-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #14141f; gap: 14px; overflow: auto; }
.tb-editor-root #preview { background: var(--stage); outline: 1px solid var(--line); }
.tb-editor-root .preview-controls { display: flex; gap: 10px; }
.tb-editor-root .col-inspector { width: 360px; border-left: 1px solid var(--line); padding: 12px; overflow-y: auto; background: var(--panel); }
.tb-editor-root .section-title { color: var(--muted); font-size: 12px; text-transform: uppercase; margin: 12px 0 8px; letter-spacing: 0.5px; }
.tb-editor-root .row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.tb-editor-root .row label { width: 150px; color: var(--muted); }
.tb-editor-root .row input[type="range"] { flex: 1; }
.tb-editor-root .row input[type="number"] { width: 72px; }
.tb-editor-root .row .val { width: 56px; text-align: right; color: var(--muted); }
.tb-editor-root #status { padding: 8px 16px; font-size: 13px; white-space: pre-wrap; border-top: 1px solid var(--line); background: var(--panel); max-height: 120px; overflow-y: auto; flex: 0 0 auto; }
.tb-editor-root .status-ok { color: var(--ok); } .tb-editor-root .status-err { color: var(--danger); }
.tb-editor-root .hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
.tb-editor-root textarea#export-box { width: 100%; height: 160px; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; font-family: monospace; font-size: 12px; padding: 8px; }
`;

const EDITOR_STYLE_ID = 'tb-hitfeel-editor-style';

function ensureEditorStyle(): void {
  if (document.getElementById(EDITOR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = EDITOR_STYLE_ID;
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}

/**
 * 掛載打擊感編輯器到指定容器（EditorMountFn）：注入 HTML+樣式 → 綁 canvas/事件 → initLoad 回顯 → 起預覽 rAF。
 * 第十一輪：加套用機制（applyToGame + initLoad 回顯）。unmount 停 rAF + 清 DOM。overlay 內移除「回到遊戲」導覽鈕。
 */
export function mount(container: HTMLElement): { unmount(): void } {
  ensureEditorStyle();
  container.classList.add('tb-editor-root');
  container.innerHTML = EDITOR_BODY_HTML;
  editorRoot = container;

  // 重置狀態（反覆開關 overlay）。
  cfg = { ...HIT_FEEL };
  particles = [];

  bindCanvas();
  bindUI(container.id === 'tb-editor-standalone'); // 獨立頁才保留「回到遊戲」導覽
  initLoad(); // 匯入回顯：開啟優先讀 override 回填（含 buildControls + refreshExport）

  mounted = true;
  rafId = requestAnimationFrame(loop);

  return {
    unmount(): void {
      mounted = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
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
