/**
 * 打擊手感編輯器（獨立進入點）— 即時調 hitFeelConfig 的 HIT_FEEL 參數 + canvas 預覽。
 *
 * 架構：獨立 Vite entry（hitfeel-editor/index.html），與遊戲分開打包，純前端零 Phaser。
 * 只 import hitFeelConfig（純資料/純函式、無 Phaser runtime）當初始值。
 *
 * 功能：右側控制項（slider/number/color/checkbox）改 HIT_FEEL 副本 → 左側 canvas 打擊預覽
 * （用當前參數重演 白閃/punch/火花/擊退/頓幀/死亡粒子；預覽用 canvas 2D 自繪，行為對齊遊戲
 * EffectSystem 的視覺）→ 複製參數 / 下載 JSON 貼回 hitFeelConfig。
 */
import { HIT_FEEL, type HitFeelConfig } from '@/config/hitFeelConfig';

/** 對照 gameConfig.PPU=100（本檔自持，不 import 遊戲 runtime）。 */
const PPU = 100;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
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

const canvas = $('preview') as HTMLCanvasElement;
const g2 = canvas.getContext('2d')!;
const W = canvas.width;
const H = canvas.height;
const enemy = { x: W * 0.62, y: H * 0.5, baseSize: 72 };
const attacker = { x: W * 0.3, y: H * 0.5 };

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; r: number; }
let particles: Particle[] = [];
let flashUntil = 0;
let punchStart = -1;
let kbStart = -1;
let kbFromX = 0;
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
  kbFromX = enemy.x;
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
  requestAnimationFrame(loop);
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

buildControls();
refreshExport();
requestAnimationFrame(loop);
