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
import { GUARD_STATUE_UI_DEFAULTS, GUARD_MESSAGE_DEFAULTS, type GuardPreset } from '@/config/guardConfig';
import {
  MINE_SCHEMA_VERSION,
  defaultMineFile,
  validateMine,
  assertValidMine,
  type MineFile,
} from '@/config/mineSchema';
import type { MinePreset } from '@/config/mineConfig';
import {
  TOWER_SCHEMA_VERSION,
  defaultTowerFile,
  validateTower,
  assertValidTower,
  type TowerFile,
} from '@/config/towerSchema';
import type { TowerPreset } from '@/config/towerConfig';
import { TOWER_MESSAGE_DEFAULTS } from '@/config/towerConfig';
import { TOWER_UI_DEFAULTS } from '@/config/towerConfig';
import { TOWER_INTRO_DEFAULTS } from '@/config/towerConfig';
import {
  EDITOR_STORE_KEYS,
  applyToGame,
  clearOverride,
  loadOverride,
} from '@/config/editorStore';

const SCENE_W = 1920;
const SCENE_H = 1080;

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

/** 文字列：label + text input（第十四輪 守護波訊息文字，允許空字串＝清空）。 */
function textRow(
  label: string,
  value: string,
  set: (v: string) => void,
  onChange: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.style.flex = '1';
  input.addEventListener('input', () => { set(input.value); onChange(); });
  row.appendChild(lab); row.appendChild(input);
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
// 實際雕像圖（遊戲用 ui-statue = assets/images/ui/statue.png，148×292 直式）：預覽畫真圖非文字方塊。
const gdStatueRef = new Image();
let gdStatueLoaded = false;
gdStatueRef.addEventListener('load', () => { gdStatueLoaded = true; gdRender(); });
gdStatueRef.src = '../assets/images/ui/statue.png';

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
  // 雕像 / 血條 UI（用戶第十輪 #1#4，5 optional 欄位覆蓋 GUARD_STATUE_UI_DEFAULTS）：
  //   省略=沿用打包預設，調了才存進 guard preset override。遊戲端 resolveGuardStatueUi 讀。
  const d = GUARD_STATUE_UI_DEFAULTS;
  guard.appendChild(numberRow('雕像高度 statueHeightPx', p.statueHeightPx ?? d.statueHeightPx, (v) => { p.statueHeightPx = v; }, { min: 50, max: 400, step: 5 }, on));
  guard.appendChild(numberRow('血條寬 barWidthPx', p.barWidthPx ?? d.barWidthPx, (v) => { p.barWidthPx = v; }, { min: 20, max: 400, step: 5 }, on));
  guard.appendChild(numberRow('血條高 barHeightPx', p.barHeightPx ?? d.barHeightPx, (v) => { p.barHeightPx = v; }, { min: 2, max: 60, step: 1 }, on));
  guard.appendChild(numberRow('血條 Y 位移 barOffsetYPx', p.barOffsetYPx ?? d.barOffsetYPx, (v) => { p.barOffsetYPx = v; }, { min: -200, max: 300, step: 5 }, on));
  guard.appendChild(numberRow('標籤 Y 位移 labelOffsetYPx', p.labelOffsetYPx ?? d.labelOffsetYPx, (v) => { p.labelOffsetYPx = v; }, { min: -300, max: 200, step: 5 }, on));
  // 守護波訊息（用戶第十四輪，3 optional 欄位覆蓋 GUARD_MESSAGE_DEFAULTS）：文字空字串＝清空(?? 保留)、秒數 0＝不顯示/立即。
  const md = GUARD_MESSAGE_DEFAULTS;
  guard.appendChild(textRow('限時事件文字 introEventText', p.introEventText ?? md.introEventText, (v) => { p.introEventText = v; }, on));
  guard.appendChild(textRow('守護訊息文字 guardMessageText', p.guardMessageText ?? md.guardMessageText, (v) => { p.guardMessageText = v; }, on));
  guard.appendChild(numberRow('限時事件顯示秒數 eventTextDurationSec', p.eventTextDurationSec ?? md.eventTextDurationSec, (v) => { p.eventTextDurationSec = v; }, { min: 0, max: 10, step: 0.5 }, on));
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
  // 雕像：實際 ui-statue 圖（148×292 直式），等比縮到視覺高 statueHeightPx（對齊遊戲 GuardTarget）；未載到退回方塊佔位。
  const d2 = GUARD_STATUE_UI_DEFAULTS;
  const statueHpx = (p.statueHeightPx ?? d2.statueHeightPx) * scale;
  let dispW: number;
  if (gdStatueLoaded && gdStatueRef.naturalWidth > 0) {
    const ratio = gdStatueRef.naturalWidth / gdStatueRef.naturalHeight; // 148/292
    dispW = statueHpx * ratio;
    ctx.drawImage(gdStatueRef, cx - dispW / 2, cy - statueHpx / 2, dispW, statueHpx);
  } else {
    dispW = statueHpx * 0.507; // 148:292 比例佔位
    ctx.fillStyle = '#6c8cff'; ctx.fillRect(cx - dispW / 2, cy - statueHpx / 2, dispW, statueHpx);
    ctx.fillStyle = '#9a9ab5'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('雕像(圖載入中)', cx, cy + statueHpx / 2 + 14);
  }
  // 「守護目標」標籤（labelOffsetYPx，負=上方；對齊遊戲）。
  const labelOy = (p.labelOffsetYPx ?? d2.labelOffsetYPx) * scale;
  ctx.fillStyle = '#ffe64d'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('守護目標', cx, cy + labelOy);
  // 血條視覺（barWidthPx/barHeightPx/barOffsetYPx，底框 0x333333 + 填充 0x66bb6a，對齊遊戲 GuardTarget；預覽填滿示意）。
  const barW = (p.barWidthPx ?? d2.barWidthPx) * scale;
  const barH = (p.barHeightPx ?? d2.barHeightPx) * scale;
  const barOy = cy + (p.barOffsetYPx ?? d2.barOffsetYPx) * scale;
  ctx.fillStyle = '#333333'; ctx.fillRect(cx - barW / 2, barOy - barH / 2, barW, barH); // 底框
  ctx.fillStyle = '#66bb6a'; ctx.fillRect(cx - barW / 2, barOy - (barH - 2 * scale) / 2, barW, Math.max(1, barH - 2 * scale)); // 填充（滿）
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

// ═══════════════════════════════════════ 地雷 tab（附加類，全域 preset）═══════════════════════════════════════
let mnFile: MineFile = defaultMineFile();
let mnCurrent: string = Object.keys(mnFile.presets)[0] ?? 'Mine';
function mnPreset(): MinePreset { return mnFile.presets[mnCurrent]; }
function mnBuildSelect(): void {
  const sel = $<HTMLSelectElement>('mn-preset-select');
  sel.innerHTML = '';
  for (const name of Object.keys(mnFile.presets)) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if (name === mnCurrent) opt.selected = true;
    sel.appendChild(opt);
  }
}
function mnBuildInspector(): void {
  const insp = $('mn-inspector'); insp.innerHTML = '';
  const p = mnPreset(); if (!p) return;
  const on = () => { /* 純數值，無預覽 */ };
  insp.appendChild(numberRow('初始撒雷數 count', p.count, (v) => { p.count = Math.max(1, Math.round(v)); }, { min: 1, max: 40, step: 1, int: true }, on));
  insp.appendChild(numberRow('維持數量 maintainCount', p.maintainCount, (v) => { p.maintainCount = Math.max(1, Math.round(v)); }, { min: 1, max: 60, step: 1, int: true }, on));
  insp.appendChild(numberRow('再生時間 respawnDelay (s)', p.respawnDelaySec, (v) => { p.respawnDelaySec = v; }, { min: 0, max: 20, step: 0.5 }, on));
  insp.appendChild(numberRow('觸發倒數 delay (s)', p.delaySec, (v) => { p.delaySec = v; }, { min: 0, max: 10, step: 0.5 }, on));
  insp.appendChild(numberRow('爆炸半徑 radius (px)', p.radiusPx, (v) => { p.radiusPx = v; }, { min: 0, max: 300, step: 5 }, on));
  insp.appendChild(numberRow('麻痺秒數 paralyze (s)', p.paralyzeSec, (v) => { p.paralyzeSec = v; }, { min: 0, max: 10, step: 0.5 }, on));
  insp.appendChild(numberRow('縮邊 edgeMargin (px)', p.edgeMarginPx ?? 0, (v) => { p.edgeMarginPx = v; }, { min: 0, max: 200, step: 5 }, on));
}
function mnRefreshAll(): void { mnBuildSelect(); mnBuildInspector(); }
function mnInitLoad(): void {
  const raw = loadOverride(EDITOR_STORE_KEYS.mine);
  if (raw !== null) {
    const r = validateMine(raw);
    if (r.ok) { mnFile = r.data; mnCurrent = Object.keys(mnFile.presets)[0] ?? 'Mine'; mnRefreshAll(); return; }
  }
  mnFile = defaultMineFile(); mnCurrent = Object.keys(mnFile.presets)[0] ?? 'Mine'; mnRefreshAll();
}
/** 套用地雷到遊戲。回傳是否成功。 */
function mnApply(): boolean {
  const res = validateMine(mnFile);
  if (!res.ok) { setStatus(`地雷套用失敗（驗證未過）：\n${res.errors.join('\n')}`, 'err'); return false; }
  return applyToGame(EDITOR_STORE_KEYS.mine, res.data);
}

// ═══════════════════════════════════════ 魔尖塔 tab（單獨波次，全域 preset）═══════════════════════════════════════
let twFile: TowerFile = defaultTowerFile();
let twCurrent: string = Object.keys(twFile.presets)[0] ?? 'Tower4';
function twPreset(): TowerPreset { return twFile.presets[twCurrent]; }
function twBuildSelect(): void {
  const sel = $<HTMLSelectElement>('tw-preset-select');
  sel.innerHTML = '';
  for (const name of Object.keys(twFile.presets)) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    if (name === twCurrent) opt.selected = true;
    sel.appendChild(opt);
  }
}
function twBuildInspector(): void {
  const insp = $('tw-inspector'); insp.innerHTML = '';
  const p = twPreset(); if (!p) return;
  const on = () => twRender();
  insp.appendChild(numberRow('尖塔數 towerCount', p.towerCount, (v) => { p.towerCount = Math.max(1, Math.round(v)); }, { min: 1, max: 12, step: 1, int: true }, on));
  insp.appendChild(numberRow('限時 timeLimit (s)', p.timeLimitSec, (v) => { p.timeLimitSec = v; }, { min: 1, max: 300, step: 5 }, on));
  insp.appendChild(numberRow('尖塔血量 towerHp', p.towerHp, (v) => { p.towerHp = v; }, { min: 1, max: 1000, step: 10 }, on));
  insp.appendChild(numberRow('塔大小 towerScale (×)', p.towerScale ?? 1, (v) => { p.towerScale = v; }, { min: 0.2, max: 4, step: 0.1 }, on));
  // ★真空帶＝塔 body 碰撞半徑（角色/怪能貼多近塔）；≠魂力環內圈半徑（那是環狀攻擊、下方 ringSkill）。省略＝現行預設(~45×scale)。
  insp.appendChild(numberRow('真空帶半徑（碰撞距離）towerCollisionRadiusPx (px)', p.towerCollisionRadiusPx ?? 67.5, (v) => { p.towerCollisionRadiusPx = v; }, { min: 0, max: 400, step: 5 }, on));
  insp.appendChild(numberRow('　碰撞圓偏移 X towerCollisionOffsetXPx (px)', p.towerCollisionOffsetXPx ?? 0, (v) => { p.towerCollisionOffsetXPx = v; }, { min: -300, max: 300, step: 2 }, on));
  insp.appendChild(numberRow('　碰撞圓偏移 Y towerCollisionOffsetYPx (px)', p.towerCollisionOffsetYPx ?? 0, (v) => { p.towerCollisionOffsetYPx = v; }, { min: -300, max: 300, step: 2 }, on));
  // 登場訊息（照搬守護波兩段：事件宣告大字 + 提示 + 顯示時間）。
  const msgTitle = document.createElement('div');
  msgTitle.className = 'section-title'; msgTitle.style.marginTop = '12px';
  msgTitle.textContent = '登場訊息（兩段，比照守護波）';
  insp.appendChild(msgTitle);
  const md = TOWER_MESSAGE_DEFAULTS;
  insp.appendChild(textRow('事件宣告大字 introEventText', p.introEventText ?? md.introEventText, (v) => { p.introEventText = v; }, on));
  insp.appendChild(textRow('提示訊息 towerMessageText', p.towerMessageText ?? md.towerMessageText, (v) => { p.towerMessageText = v; }, on));
  insp.appendChild(numberRow('宣告顯示秒數 eventTextDuration (s)', p.eventTextDurationSec ?? md.eventTextDurationSec, (v) => { p.eventTextDurationSec = v; }, { min: 0, max: 10, step: 0.5 }, on));
  // E：過關獎勵券。（★塔血條顯示已移除 game-side，故移除殘留 barWidth/barHeight/barOffsetY/labelOffsetY editor 欄——調了也沒用。）
  const uiTitle = document.createElement('div');
  uiTitle.className = 'section-title'; uiTitle.style.marginTop = '12px';
  uiTitle.textContent = '過關獎勵';
  insp.appendChild(uiTitle);
  const ud = TOWER_UI_DEFAULTS;
  insp.appendChild(numberRow('過關獎勵券 rewardTickets', p.rewardTickets ?? ud.rewardTickets, (v) => { p.rewardTickets = Math.max(0, Math.round(v)); }, { min: 0, max: 100, step: 1, int: true }, on));
  // B：開場演出（玩家聚集中央 + 聚焦壓黑 + 定格，比照守護波但走位目標＝中央非四角）。
  const introTitle = document.createElement('div');
  introTitle.className = 'section-title'; introTitle.style.marginTop = '12px';
  introTitle.textContent = '開場演出（玩家聚集中央+聚焦壓黑）';
  insp.appendChild(introTitle);
  const id = TOWER_INTRO_DEFAULTS;
  insp.appendChild(numberRow('聚焦壓黑時長 introFocus (s)', p.introFocusSec ?? id.introFocusSec, (v) => { p.introFocusSec = v; }, { min: 0, max: 10, step: 0.5 }, on));
  insp.appendChild(numberRow('聚焦亮圈半徑 spotlightRadius (px)', p.spotlightRadiusPx ?? id.spotlightRadiusPx, (v) => { p.spotlightRadiusPx = v; }, { min: 0, max: 600, step: 10 }, on));
  insp.appendChild(numberRow('走位逾時 maxWalk (s)', p.maxWalkSec ?? id.maxWalkSec, (v) => { p.maxWalkSec = v; }, { min: 0, max: 10, step: 0.5 }, on));
  insp.appendChild(numberRow('聚集點 X gatherX (px)', p.gatherPointPx?.x ?? id.gatherPointPx.x, (v) => { p.gatherPointPx = { x: v, y: p.gatherPointPx?.y ?? id.gatherPointPx.y }; }, { min: 0, max: 1920, step: 10 }, on));
  insp.appendChild(numberRow('聚集點 Y gatherY (px)', p.gatherPointPx?.y ?? id.gatherPointPx.y, (v) => { p.gatherPointPx = { x: p.gatherPointPx?.x ?? id.gatherPointPx.x, y: v }; }, { min: 0, max: 1080, step: 10 }, on));
  const r = p.ringSkill;
  insp.appendChild(numberRow('環數 ringCount', r.ringCount, (v) => { r.ringCount = Math.max(1, Math.round(v)); }, { min: 1, max: 8, step: 1, int: true }, on));
  insp.appendChild(numberRow('最內環半徑 baseRadius (px)', r.baseRadiusPx, (v) => { r.baseRadiusPx = v; }, { min: 0, max: 400, step: 5 }, on));
  insp.appendChild(numberRow('每層遞增 radiusStep (px)', r.radiusStepPx, (v) => { r.radiusStepPx = v; }, { min: 0, max: 200, step: 5 }, on));
  insp.appendChild(numberRow('每層間隔 ringInterval (s)', r.ringIntervalSec, (v) => { r.ringIntervalSec = v; }, { min: 0.05, max: 5, step: 0.05 }, on));
  insp.appendChild(numberRow('環厚 ringThickness (px)', r.ringThicknessPx, (v) => { r.ringThicknessPx = v; }, { min: 1, max: 100, step: 1 }, on));
  insp.appendChild(numberRow('環預警秒數 warning (s)', r.warningSec, (v) => { r.warningSec = v; }, { min: 0, max: 3, step: 0.1 }, on));
  insp.appendChild(numberRow('魂力環內圈半徑 vacuumRadius (px)', r.vacuumRadiusPx ?? r.baseRadiusPx, (v) => { r.vacuumRadiusPx = v; }, { min: 0, max: 400, step: 5 }, on));
  insp.appendChild(numberRow('扣能量段數 energyCost', r.energyCost, (v) => { r.energyCost = Math.round(v); }, { min: 0, max: 6, step: 1, int: true }, on));
  // A2：塔位置區塊——按鈕清除自訂位置（回預設環形）。拖曳在 tw-preview canvas。
  const posTitle = document.createElement('div');
  posTitle.className = 'section-title'; posTitle.style.marginTop = '12px';
  posTitle.textContent = '塔位置（拖曳左側預覽圓點；未設＝預設環形）';
  insp.appendChild(posTitle);
  const posBtn = document.createElement('button');
  posBtn.textContent = p.positions && p.positions.length > 0 ? '清除自訂位置（回預設環形）' : '（目前用預設環形）';
  posBtn.disabled = !(p.positions && p.positions.length > 0);
  posBtn.addEventListener('click', () => { delete p.positions; twBuildInspector(); twRender(); });
  insp.appendChild(posBtn);

  // ①預覽切換：多塔佈局 ↔ 單塔放大校對（塞太多/多塔時每座太小→放大單塔看清碰撞圓/魂力環）。
  const soloRow = document.createElement('div');
  soloRow.className = 'row'; soloRow.style.marginTop = '8px';
  const soloBtn = document.createElement('button');
  soloBtn.textContent = twSoloView ? '預覽：單塔放大校對（點回多塔佈局）' : '預覽：多塔佈局（點切單塔放大校對）';
  soloBtn.addEventListener('click', () => { twSoloView = !twSoloView; twBuildInspector(); twRender(); });
  soloRow.appendChild(soloBtn);
  if (twSoloView && p.towerCount > 1) {
    const nextBtn = document.createElement('button');
    nextBtn.textContent = `校對第 ${Math.min(twSoloIndex, p.towerCount - 1) + 1}/${p.towerCount} 座（點下一座）`;
    nextBtn.addEventListener('click', () => { twSoloIndex = (twSoloIndex + 1) % p.towerCount; twBuildInspector(); twRender(); });
    soloRow.appendChild(nextBtn);
  }
  insp.appendChild(soloRow);
}
function twRefreshAll(): void { twBuildSelect(); twBuildInspector(); twRender(); }

/** 取得目前 preset 的有效塔位（自訂 positions 補足到 towerCount；未設＝預設環形）。回傳場景座標 {x,y}[]。 */
function twEffectivePositions(p: TowerPreset): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const cx = SCENE_W / 2, cy = SCENE_H / 2;
  const ringR = Math.min(SCENE_W, SCENE_H) * 0.3; // 預設環形半徑
  for (let i = 0; i < p.towerCount; i += 1) {
    const custom = p.positions?.[i];
    if (custom) { out.push({ x: custom.x, y: custom.y }); continue; }
    const ang = -Math.PI / 2 + (i / p.towerCount) * Math.PI * 2; // 由正上方順時針均分
    out.push({ x: cx + Math.cos(ang) * ringR, y: cy + Math.sin(ang) * ringR });
  }
  return out;
}

/** 場景→canvas 座標（fit 1920×1080 進畫布、置中 letterbox）。回傳 {toCv, toScene, s, ox, oy}。 */
function twMapping(cv: HTMLCanvasElement) {
  const s = Math.min(cv.width / SCENE_W, cv.height / SCENE_H);
  const ox = (cv.width - SCENE_W * s) / 2;
  const oy = (cv.height - SCENE_H * s) / 2;
  return {
    s, ox, oy,
    toCv: (x: number, y: number) => ({ x: ox + x * s, y: oy + y * s }),
    toScene: (cxp: number, cyp: number) => ({ x: (cxp - ox) / s, y: (cyp - oy) / s }),
  };
}

let twDragIndex = -1; // 目前拖曳的塔索引（-1=無）
let twSoloView = false; // ①單塔放大校對：true=只顯一座塔放大置中（1:1 校對碰撞圓）；false=多塔佈局（現況）
let twSoloIndex = 0; // 單塔校對模式顯示第幾座（0-based）
// ★真實塔立繪（game-side setStaticTexture('fx_tower_spire', 0.5, 1.0)＝origin 底部錨點）：單塔校對畫真圖，碰撞圓 1:1 疊塔身中央。
const twSpireRef = new Image();
let twSpireLoaded = false;
twSpireRef.addEventListener('load', () => { twSpireLoaded = true; twRender(); });
twSpireRef.src = '../assets/images/vfx/fx_tower_spire.png';
// game-side 塔碰撞半徑省略時的預設＝ENEMY_BODY_RADIUS_PX(45) × PER_CHAR_SCALE['Enemy_Elite'](1.5)＝67.5（Enemy_Tower 沿用 elite scale）。
const TOWER_DEFAULT_COLLISION_RADIUS_PX = 67.5;

function twRender(): void {
  const cv = $<HTMLCanvasElement>('tw-preview'); const ctx = cv.getContext('2d'); if (!ctx) return;
  const W = cv.width, H = cv.height; ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#10101c'; ctx.fillRect(0, 0, W, H);
  const p = twPreset(); if (!p) return;
  const r = p.ringSkill;
  const scale = p.towerScale ?? 1;
  const GROUND_SQUASH = 0.5; // 貼地觀感：Y 壓扁（同 runtime 貼地橢圓感）

  // 一座塔的裝飾圈（魂力環同心圓紫 + 魂力環內圈綠虛線 + 碰撞圓橘虛線含 offset）。sc＝場景 px→canvas px 比例。
  const drawTowerDecorations = (c: { x: number; y: number }, sc: number): void => {
    for (let n = 0; n < Math.max(1, r.ringCount); n += 1) {
      const rx = (r.baseRadiusPx + n * r.radiusStepPx) * sc;
      ctx.strokeStyle = 'rgba(140,120,255,0.65)'; // 魂力環紫
      ctx.lineWidth = Math.max(1, (r.ringThicknessPx * sc) || 1);
      ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, rx * GROUND_SQUASH, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // 魂力環內圈（ring.vacuumRadiusPx，環狀攻擊安全區）：綠色虛線圈。
    const vac = (r.vacuumRadiusPx ?? r.baseRadiusPx) * sc;
    ctx.save();
    ctx.strokeStyle = 'rgba(89,217,142,0.8)'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, vac, vac * GROUND_SQUASH, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // ★真空帶＝塔 body 碰撞半徑（towerCollisionRadiusPx，省略＝67.5＝45×1.5 elite scale）：橘色虛線圈，圓心含 offset。
    const col = (p.towerCollisionRadiusPx ?? TOWER_DEFAULT_COLLISION_RADIUS_PX) * sc;
    const offX = (p.towerCollisionOffsetXPx ?? 0) * sc;
    const offY = (p.towerCollisionOffsetYPx ?? 0) * sc * GROUND_SQUASH;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,170,60,0.9)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(c.x + offX, c.y + offY, col, col * GROUND_SQUASH, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  };

  if (twSoloView) {
    // ①單塔放大校對（1:1 對遊戲）：只畫真實塔立繪 + 碰撞圓（正圓，圓心對塔視覺中心+offset）；★不畫魂力環。
    //   全照 game-side 真實值：圓心＝getTowerCollisionCenter（塔視覺中心+offset）、半徑＝towerCollisionRadiusPx??67.5、
    //   塔立繪 fx_tower_spire origin(0.5,1.0) 底部錨點 × towerScale。編輯器看到的＝進遊戲看到的。
    const idx = Math.min(twSoloIndex, Math.max(0, p.towerCount - 1));
    const colR = p.towerCollisionRadiusPx ?? TOWER_DEFAULT_COLLISION_RADIUS_PX; // 場景 px
    // 塔立繪自然尺寸（載入後才有）→ 顯示尺寸 = 自然 × towerScale（場景 px，比照 game finalScale 觀感）。
    const natW = twSpireLoaded ? twSpireRef.naturalWidth : 90;
    const natH = twSpireLoaded ? twSpireRef.naturalHeight : 180;
    const towerH = natH * scale; // 顯示高（場景 px）
    const towerW = natW * scale;
    // 放大比例 sc：讓 max(塔高, 碰撞圓直徑) 約佔畫布 70%。
    const extent = Math.max(towerH, colR * 2 + Math.abs(p.towerCollisionOffsetYPx ?? 0) * 2, towerW);
    const sc = (Math.min(W, H) * 0.7) / Math.max(1, extent);
    // 版面：塔視覺中心置於畫布中央；腳底 = 中心 + 半個塔高。
    const centerX = W / 2;
    const centerY = H / 2;
    const footY = centerY + (towerH / 2) * sc; // origin 1.0 → sprite 底邊在腳底
    // 畫真實塔立繪（底部錨點：x 置中、底邊在 footY）。
    if (twSpireLoaded) {
      const dw = towerW * sc, dh = towerH * sc;
      ctx.drawImage(twSpireRef, centerX - dw / 2, footY - dh, dw, dh);
    } else {
      // 圖未載入的暫時佔位（極簡，不誤導；載入後即重繪成真圖）。
      ctx.fillStyle = '#3a3a5c';
      ctx.fillRect(centerX - (towerW * sc) / 2, footY - towerH * sc, towerW * sc, towerH * sc);
    }
    // ★碰撞圓（正圓）：圓心＝塔視覺中心(centerX,centerY) + offset（offset 不壓扁），半徑 colR。橘色。
    const ccx = centerX + (p.towerCollisionOffsetXPx ?? 0) * sc;
    const ccy = centerY + (p.towerCollisionOffsetYPx ?? 0) * sc;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,170,60,0.95)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ccx, ccy, colR * sc, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // 圓心十字（標塔視覺中心+offset 的實際圓心）。
    ctx.save();
    ctx.strokeStyle = 'rgba(255,170,60,0.95)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ccx - 6, ccy); ctx.lineTo(ccx + 6, ccy);
    ctx.moveTo(ccx, ccy - 6); ctx.lineTo(ccx, ccy + 6); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#9a9ab5'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`單塔放大校對（1:1 對遊戲）｜塔 ${idx + 1}/${p.towerCount}｜碰撞圓 ${colR}px（正圓，圓心＝塔視覺中心＋偏移 ${p.towerCollisionOffsetXPx ?? 0},${p.towerCollisionOffsetYPx ?? 0}）｜塔 ×${scale.toFixed(1)}`, 8, H - 8);
    return;
  }

  const m = twMapping(cv);
  // 場景參考框（1920×1080 完整場景）。
  ctx.strokeStyle = '#3a3a5c'; ctx.lineWidth = 1;
  ctx.strokeRect(m.ox, m.oy, SCENE_W * m.s, SCENE_H * m.s);
  const positions = twEffectivePositions(p);
  positions.forEach((pos) => drawTowerDecorations(m.toCv(pos.x, pos.y), m.s));
  positions.forEach((pos, i) => {
    const c = m.toCv(pos.x, pos.y);
    const isCustom = !!p.positions?.[i];
    const mk = 8 * scale;
    ctx.fillStyle = i === twDragIndex ? '#ffd45c' : (isCustom ? '#6c8cff' : '#59d98e');
    ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(4, mk), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#e6e6f0'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#e6e6f0'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), c.x, c.y - Math.max(4, mk) - 3);
  });
  ctx.fillStyle = '#9a9ab5'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`${p.towerCount} 塔｜魂力環 ${r.ringCount} 圈（紫，最內 ${r.baseRadiusPx}px＋每層 ${r.radiusStepPx}px）｜塔 ×${scale.toFixed(1)}｜拖曳設位置`, 8, H - 8);
}

/** 綁定 tw-preview 的拖曳（在 main() 呼叫一次）。 */
function twBindDrag(): void {
  const cv = $<HTMLCanvasElement>('tw-preview');
  const pick = (ev: PointerEvent): number => {
    if (twSoloView) return -1; // 單塔放大校對模式不拖曳位置（回多塔佈局才拖）
    const rect = cv.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (cv.width / rect.width);
    const py = (ev.clientY - rect.top) * (cv.height / rect.height);
    const p = twPreset(); if (!p) return -1;
    const m = twMapping(cv);
    const positions = twEffectivePositions(p);
    let best = -1, bestD = 16 * 16; // 命中半徑 16px
    positions.forEach((pos, i) => {
      const c = m.toCv(pos.x, pos.y);
      const d = (c.x - px) ** 2 + (c.y - py) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };
  cv.addEventListener('pointerdown', (ev) => {
    twDragIndex = pick(ev);
    if (twDragIndex >= 0) { cv.setPointerCapture(ev.pointerId); twRender(); }
  });
  cv.addEventListener('pointermove', (ev) => {
    if (twDragIndex < 0) return;
    const p = twPreset(); if (!p) return;
    const rect = cv.getBoundingClientRect();
    const px = (ev.clientX - rect.left) * (cv.width / rect.width);
    const py = (ev.clientY - rect.top) * (cv.height / rect.height);
    const m = twMapping(cv);
    const sc = m.toScene(px, py);
    // clamp 進場景範圍。
    const x = Math.max(0, Math.min(SCENE_W, Math.round(sc.x)));
    const y = Math.max(0, Math.min(SCENE_H, Math.round(sc.y)));
    // 寫入 positions（不足補足到目前拖曳索引，用有效位置當初值）。
    if (!p.positions) p.positions = [];
    const eff = twEffectivePositions(p);
    while (p.positions.length <= twDragIndex) {
      const idx = p.positions.length;
      p.positions.push({ x: Math.round(eff[idx].x), y: Math.round(eff[idx].y) });
    }
    p.positions[twDragIndex] = { x, y };
    twRender();
  });
  const end = (ev: PointerEvent) => {
    if (twDragIndex >= 0) {
      twDragIndex = -1;
      try { cv.releasePointerCapture(ev.pointerId); } catch { /* noop */ }
      twBuildInspector(); twRender(); // 更新「清除自訂位置」按鈕態
    }
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}
function twInitLoad(): void {
  const raw = loadOverride(EDITOR_STORE_KEYS.tower);
  if (raw !== null) {
    const r = validateTower(raw);
    if (r.ok) { twFile = r.data; twCurrent = Object.keys(twFile.presets)[0] ?? 'Tower4'; twRefreshAll(); return; }
  }
  twFile = defaultTowerFile(); twCurrent = Object.keys(twFile.presets)[0] ?? 'Tower4'; twRefreshAll();
}
/** 套用魔尖塔到遊戲。回傳是否成功。 */
function twApply(): boolean {
  const res = validateTower(twFile);
  if (!res.ok) { setStatus(`魔尖塔套用失敗（驗證未過）：\n${res.errors.join('\n')}`, 'err'); return false; }
  return applyToGame(EDITOR_STORE_KEYS.tower, res.data);
}

// ═══════════════════════════════════════ 分頁 + 共用按鈕 ═══════════════════════════════════════
type Tab = 'firerain' | 'guard' | 'mine' | 'tower';
let activeTab: Tab = 'firerain';

function switchTab(tab: Tab): void {
  activeTab = tab;
  for (const t of ['firerain', 'guard', 'mine', 'tower'] as Tab[]) {
    $(`tab-${t}`).classList.toggle('active', t === tab);
    $(`pane-${t}`).classList.toggle('active', t === tab);
  }
  if (tab === 'firerain') frRender();
  else if (tab === 'guard') gdRender();
  else if (tab === 'tower') twRender(); // A2：切到魔尖塔重繪塔位預覽
}

/** 四份都套用（火雨/守護/地雷/魔尖塔分存四 key）。回傳是否全成功。 */
function applyBoth(): boolean {
  const fr = frApply(); const gd = gdApply(); const mn = mnApply(); const tw = twApply();
  const all = fr && gd && mn && tw;
  setStatus(all
    ? '✅ 火雨/守護/地雷/魔尖塔都已套用到遊戲（各存一份，重開仍在）。'
    : `套用結果：火雨 ${fr ? '✓' : '✗'}、守護 ${gd ? '✓' : '✗'}、地雷 ${mn ? '✓' : '✗'}、魔尖塔 ${tw ? '✓' : '✗'}。`,
    all ? 'ok' : 'err');
  return all;
}

function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

function main(): void {
  $('schema-version').textContent = `火雨 v${FIRE_RAIN_SCHEMA_VERSION} · 守護 v${GUARD_SCHEMA_VERSION} · 地雷 v${MINE_SCHEMA_VERSION} · 魔尖塔 v${TOWER_SCHEMA_VERSION}`;
  frInitLoad();
  gdInitLoad();
  mnInitLoad();
  twInitLoad();

  // 分頁切換。
  for (const t of ['firerain', 'guard', 'mine', 'tower'] as Tab[]) {
    $(`tab-${t}`).addEventListener('click', () => switchTab(t));
  }

  // 各 tab 的 preset 下拉 + 放大。
  $<HTMLSelectElement>('fr-preset-select').addEventListener('change', (e) => { frCurrent = (e.target as HTMLSelectElement).value; frBuildInspector(); frRender(); });
  $('fr-zoom').addEventListener('input', (e) => { frZoom = parseFloat((e.target as HTMLInputElement).value); $('fr-zoom-val').textContent = `${frZoom}×`; frRender(); });
  $<HTMLSelectElement>('gd-preset-select').addEventListener('change', (e) => { gdCurrent = (e.target as HTMLSelectElement).value; gdBuildInspector(); gdRender(); });
  $('gd-zoom').addEventListener('input', (e) => { gdZoom = parseFloat((e.target as HTMLInputElement).value); $('gd-zoom-val').textContent = `${gdZoom}×`; gdRender(); });
  $<HTMLSelectElement>('mn-preset-select').addEventListener('change', (e) => { mnCurrent = (e.target as HTMLSelectElement).value; mnBuildInspector(); });
  $<HTMLSelectElement>('tw-preset-select').addEventListener('change', (e) => { twCurrent = (e.target as HTMLSelectElement).value; twBuildInspector(); twRender(); });
  twBindDrag(); // A2：塔位置拖曳

  // 共用按鈕：對「當前分頁」載入/下載；套用/清除則兩者都動（分存兩 key）。
  $('btn-load-default').addEventListener('click', () => {
    frFile = defaultFireRainFile(); frCurrent = Object.keys(frFile.presets)[0]; frRefreshAll();
    gdFile = defaultGuardFile(); gdCurrent = Object.keys(gdFile.presets)[0]; gdRefreshAll();
    mnFile = defaultMineFile(); mnCurrent = Object.keys(mnFile.presets)[0]; mnRefreshAll();
    twFile = defaultTowerFile(); twCurrent = Object.keys(twFile.presets)[0]; twRefreshAll();
    setStatus('已載入火雨/守護/地雷/魔尖塔打包預設。', 'info');
  });
  $('btn-reset').addEventListener('click', () => {
    frFile = defaultFireRainFile(); frCurrent = Object.keys(frFile.presets)[0]; frRefreshAll();
    gdFile = defaultGuardFile(); gdCurrent = Object.keys(gdFile.presets)[0]; gdRefreshAll();
    mnFile = defaultMineFile(); mnCurrent = Object.keys(mnFile.presets)[0]; mnRefreshAll();
    twFile = defaultTowerFile(); twCurrent = Object.keys(twFile.presets)[0]; twRefreshAll();
    setStatus('已重設火雨/守護/地雷/魔尖塔為預設值。', 'info');
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
      } else if (activeTab === 'guard') {
        try {
          gdFile = assertValidGuard(json); gdCurrent = Object.keys(gdFile.presets)[0]; gdRefreshAll();
          const ok = applyToGame(EDITOR_STORE_KEYS.guard, gdFile);
          setStatus(ok ? '已載入守護 JSON 並套用（重開仍在）。' : '已載入守護 JSON（套用失敗：localStorage 不可用）。', ok ? 'ok' : 'err');
        } catch (err) { setStatus(`守護載入失敗：${(err as Error).message}`, 'err'); }
      } else if (activeTab === 'mine') {
        try {
          mnFile = assertValidMine(json); mnCurrent = Object.keys(mnFile.presets)[0]; mnRefreshAll();
          const ok = applyToGame(EDITOR_STORE_KEYS.mine, mnFile);
          setStatus(ok ? '已載入地雷 JSON 並套用（重開仍在）。' : '已載入地雷 JSON（套用失敗：localStorage 不可用）。', ok ? 'ok' : 'err');
        } catch (err) { setStatus(`地雷載入失敗：${(err as Error).message}`, 'err'); }
      } else {
        try {
          twFile = assertValidTower(json); twCurrent = Object.keys(twFile.presets)[0]; twRefreshAll();
          const ok = applyToGame(EDITOR_STORE_KEYS.tower, twFile);
          setStatus(ok ? '已載入魔尖塔 JSON 並套用（重開仍在）。' : '已載入魔尖塔 JSON（套用失敗：localStorage 不可用）。', ok ? 'ok' : 'err');
        } catch (err) { setStatus(`魔尖塔載入失敗：${(err as Error).message}`, 'err'); }
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
    } else if (activeTab === 'guard') {
      const res = validateGuard(gdFile);
      if (!res.ok) { setStatus(`守護驗證失敗：\n${res.errors.join('\n')}`, 'err'); return; }
      downloadJson('guard.json', res.data); setStatus('已下載 guard.json。', 'ok');
    } else if (activeTab === 'mine') {
      const res = validateMine(mnFile);
      if (!res.ok) { setStatus(`地雷驗證失敗：\n${res.errors.join('\n')}`, 'err'); return; }
      downloadJson('mine.json', res.data); setStatus('已下載 mine.json。', 'ok');
    } else {
      const res = validateTower(twFile);
      if (!res.ok) { setStatus(`魔尖塔驗證失敗：\n${res.errors.join('\n')}`, 'err'); return; }
      downloadJson('tower.json', res.data); setStatus('已下載 tower.json。', 'ok');
    }
  });

  // 套用（四份都存）。
  $('btn-apply').addEventListener('click', () => void applyBoth());
  $('btn-apply-return').addEventListener('click', () => {
    if (!applyBoth()) return;
    setStatus('✅ 已套用，返回遊戲中…', 'ok');
    window.location.href = '../';
  });
  // 清除（四 key 都清）。
  $('btn-clear-apply').addEventListener('click', () => {
    clearOverride(EDITOR_STORE_KEYS.firerain);
    clearOverride(EDITOR_STORE_KEYS.guard);
    clearOverride(EDITOR_STORE_KEYS.mine);
    clearOverride(EDITOR_STORE_KEYS.tower);
    setStatus('已清除火雨/守護/地雷/魔尖塔套用，遊戲回打包預設。', 'info');
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
  <div class="tab" data-tab="mine" id="tab-mine">💣 地雷</div>
  <div class="tab" data-tab="tower" id="tab-tower">🗼 魔尖塔</div>
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
<div class="tabpane" id="pane-mine">
  <div class="layout">
    <div class="col-inspector">
      <div class="preset-row">
        <label for="mn-preset-select">地雷 Preset</label>
        <select id="mn-preset-select"></select>
      </div>
      <div class="section-title">地雷參數（Mine，附加類）</div>
      <div id="mn-inspector"></div>
      <div class="hint">地雷=附加類（踩雷式）：關卡「刷怪波／守護／魔尖塔」節點可選「附加地雷」引用此 preset。撒在場上靜置不閃→玩家踩到（進半徑）才出現閃爍預警圈+觸發倒數→倒數完爆、範圍內玩家+怪麻痺。count＝初始撒幾顆、maintainCount＝場上維持上限、respawnDelay＝每爆一顆隔多久補一顆、delay＝踩到後倒數秒數。（比照火雨：波次文字顯完才開始撒）</div>
    </div>
  </div>
</div>
<div class="tabpane" id="pane-tower">
  <div class="layout">
    <div class="stage-wrap">
      <canvas id="tw-preview" class="preview" width="640" height="360"></canvas>
      <div class="zoom-row">
        <span>塔位置：滑鼠拖曳圓點調整（場景 1920×1080 座標）。</span>
      </div>
    </div>
    <div class="col-inspector">
      <div class="preset-row">
        <label for="tw-preset-select">魔尖塔 Preset</label>
        <select id="tw-preset-select"></select>
      </div>
      <div class="section-title">魔尖塔參數（Tower，單獨波次）</div>
      <div id="tw-inspector"></div>
      <div class="hint">魔尖塔=單獨波次：關卡「事件」節點 preset 選此即為魔尖塔波（限時內打完全部尖塔＝過關，限時到沒打完＝失敗但不 GameOver、直接進下關）。環狀技＝尖塔週期放的同心環攻擊（依序往外擴、命中扣能量、炸前顯紅圈預警 warningSec）。塔位置預覽可拖曳（未設＝預設環形）。</div>
    </div>
  </div>
</div>
<div id="status">就緒。上方切換火雨／守護波／地雷／魔尖塔分頁，各自調 preset 參數。套用時分別存四份 override，遊戲端各自讀取。</div>
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

