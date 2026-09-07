/**
 * 招式編輯器（獨立進入點）— 可視化編輯 CHARACTER_COMBAT 角色招式。
 *
 * 架構：獨立 Vite entry（skill-editor/index.html），與遊戲分開打包，純前端零 Phaser。
 * 只 import skillSchema（其只讀 import skillConfig 型別 + CHARACTER_COMBAT 值當初值，無遊戲 runtime）。
 *
 * 兩層選擇：角色（Human/SunWukong，可複製新增）→ 4 招（普攻/技能1/技能2/大招）。
 * 角色層欄位（mode/energyCap/damageMultiplier）獨立一區；招式層編當前招的 AttackData。
 * canvas 預覽：circle 圓 / rectangle 矩形 / fan 扇形（面向 ±angle/2 填色），×PPU 縮放置中 + 面向箭頭。
 */
import {
  ENERGY_MODES,
  SHAPE_TYPES,
  SKILL_KEYS,
  SKILL_LABELS,
  SKILL_SCHEMA_VERSION,
  assertValidSkills,
  defaultSkillFile,
  validateSkills,
  type AttackData,
  type CharacterCombatProfile,
  type CharacterSkillSet,
  type EnergyMode,
  type ShapeType,
  type SkillFile,
} from '@/config/skillSchema';
import {
  EDITOR_STORE_KEYS,
  applyToGame,
  clearOverride,
  loadOverride,
} from '@/config/editorStore';
import {
  ATTACK_SPEED_DEFAULT_MULT,
  ATTACK_SPEED_CHAR_KEYS,
  defaultAttackSpeedFile,
  validateAttackSpeed,
  type AttackSpeedFile,
} from '@/config/attackSpeedSchema';

const PPU = 100; // 對照 gameConfig.PPU=100（本檔自持，不 import 遊戲檔）

// 角色參照（招式範圍預覽用，用戶 UX 修正）：角色 sprite 顯示尺寸 = FRAME_SIZE×SPRITE_SCALE。
// 對齊遊戲：FRAME_SIZE=256、SPRITE_SCALE≈1.05 → ≈269px。sprite 與範圍同乘 viewScale，
// 故「招式相對角色」比例恆等遊戲實際（PPU=100，1 unit=100px）。
const REF_SPRITE_SIZE = 269;
/** 遊戲場景尺寸（完整場景視野，對齊 GAME 1920×1080）。 */
const SCENE_W = 1920;
const SCENE_H = 1080;
/** 預覽放大倍率（1=完整場景真實比例；>1 選擇性放大看細節，等比、以中心為錨）。 */
let previewZoom = 1;
/** 角色 idle sprite 路徑（skill-editor 在 /skill-editor/，資產在網站根）。依角色 key 載，載不到 fallback。 */
function spriteUrl(charKey: string): string {
  return `../assets/images/characters/${charKey}/idle/frame_00.png`;
}

/** sprite 影像快取：載入完成後重繪預覽（canvas drawImage 需等圖 load）。 */
const spriteCache = new Map<string, HTMLImageElement>();
function getSprite(charKey: string): HTMLImageElement | null {
  if (!charKey) return null;
  const cached = spriteCache.get(charKey);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
  const img = new Image();
  img.src = spriteUrl(charKey);
  img.addEventListener('load', () => renderPreview());
  img.addEventListener('error', () => renderPreview());
  spriteCache.set(charKey, img);
  return null;
}

/**
 * mount 化（方案 A' 遊戲內展開）：DOM 查找 scope 進 editorRoot（overlay 容器），不吃 document 全域。
 * 獨立頁 /skill-editor/ 仍可用（並存）。
 */
let editorRoot: HTMLElement = document.body;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = editorRoot.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

// ---- 狀態 -----------------------------------------------------------------

function cloneFile(f: SkillFile): SkillFile {
  return JSON.parse(JSON.stringify(f)) as SkillFile;
}

let file: SkillFile = defaultSkillFile();
// 攻擊速度倍率（用戶第十一輪 #1）：獨立 attackSpeed key，與 skills 併於本編輯器編（玩家攻擊節奏屬招式範疇）。
let attackSpeedFile: AttackSpeedFile = defaultAttackSpeedFile();
let selectedChar: string | null = Object.keys(file.characters)[0] ?? null;
let selectedSkill: keyof CharacterSkillSet = 'normalAttack';

// ---- Undo / Redo ----------------------------------------------------------

const HISTORY_CAP = 50;
let undoStack: SkillFile[] = [];
let redoStack: SkillFile[] = [];
let pendingSnapshot: string | null = null;

function beginEdit(): void { pendingSnapshot = JSON.stringify(file); }
function commitEdit(): void {
  if (pendingSnapshot === null) return;
  if (JSON.stringify(file) !== pendingSnapshot) {
    undoStack.push(JSON.parse(pendingSnapshot) as SkillFile);
    if (undoStack.length > HISTORY_CAP) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }
  pendingSnapshot = null;
}
function pushHistory(): void {
  undoStack.push(cloneFile(file));
  if (undoStack.length > HISTORY_CAP) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}
function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(cloneFile(file));
  file = prev;
  ensureSelection();
  renderAll();
  updateHistoryButtons();
  setStatus('已復原（Undo）。', 'info');
}
function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(cloneFile(file));
  file = next;
  ensureSelection();
  renderAll();
  updateHistoryButtons();
  setStatus('已重做（Redo）。', 'info');
}
function updateHistoryButtons(): void {
  ($('btn-undo') as HTMLButtonElement).disabled = undoStack.length === 0;
  ($('btn-redo') as HTMLButtonElement).disabled = redoStack.length === 0;
}

// ---- 共用 -----------------------------------------------------------------

function setStatus(msg: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  const el = $('status');
  el.textContent = msg;
  el.className = kind === 'ok' ? 'status-ok' : kind === 'err' ? 'status-err' : '';
}

const CHAR_LABELS: Record<string, string> = { Human: '凡人', SunWukong: '悟空' };
function charLabel(key: string): string {
  const zh = CHAR_LABELS[key];
  return zh ? `${zh}（${key}）` : key;
}
function fmt(v: number): string { return Number.isInteger(v) ? String(v) : v.toFixed(2); }

function currentProfile(): CharacterCombatProfile | undefined {
  return selectedChar ? file.characters[selectedChar] : undefined;
}
function currentSkill(): AttackData | undefined {
  const p = currentProfile();
  return p ? p.skills[selectedSkill] : undefined;
}
function ensureSelection(): void {
  if (!selectedChar || !file.characters[selectedChar]) {
    selectedChar = Object.keys(file.characters)[0] ?? null;
  }
  if (!SKILL_KEYS.includes(selectedSkill)) selectedSkill = 'normalAttack';
}

// ---- 角色清單 + 招式 tab --------------------------------------------------

function renderCharList(): void {
  const list = $('char-list');
  list.innerHTML = '';
  for (const key of Object.keys(file.characters)) {
    const item = document.createElement('div');
    item.className = 'list-item' + (key === selectedChar ? ' selected' : '');
    const label = document.createElement('span');
    label.className = 'grow';
    label.textContent = charLabel(key);
    item.appendChild(label);

    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = '刪除角色';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Object.keys(file.characters).length <= 1) { setStatus('至少要保留一個角色。', 'err'); return; }
      pushHistory();
      delete file.characters[key];
      if (selectedChar === key) selectedChar = Object.keys(file.characters)[0] ?? null;
      renderAll();
    });
    item.appendChild(del);

    item.addEventListener('click', () => { selectedChar = key; renderAll(); });
    list.appendChild(item);
  }
}

function renderSkillTabs(): void {
  const tabs = $('skill-tabs');
  tabs.innerHTML = '';
  for (const sk of SKILL_KEYS) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (sk === selectedSkill ? ' active' : '');
    btn.textContent = SKILL_LABELS[sk];
    btn.addEventListener('click', () => { selectedSkill = sk; renderAll(); });
    tabs.appendChild(btn);
  }
}

// ---- Inspector 通用列 -----------------------------------------------------

function numberRow(
  label: string, value: number, onChange: (v: number) => void,
  opts: { min?: number; max?: number; step?: number; slider?: boolean } = {},
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  row.appendChild(lab);

  // 夾範圍（有 min/max 時把值夾回界內）。
  const clamp = (v: number): number => {
    let x = v;
    if (opts.min !== undefined && x < opts.min) x = opts.min;
    if (opts.max !== undefined && x > opts.max) x = opts.max;
    return x;
  };
  const stepStr = String(opts.step ?? 'any'); // 'any'/小數 step → 支援小數

  const input = document.createElement('input');
  input.type = opts.slider ? 'range' : 'number';
  input.step = stepStr;
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  input.value = String(value);

  // slider 專用：旁邊放「可輸入的數字框」(取代舊唯讀 span)，支援打字/小數/雙向同步。
  let numInput: HTMLInputElement | null = null;
  if (opts.slider) {
    numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'val-input';
    numInput.step = stepStr;
    if (opts.min !== undefined) numInput.min = String(opts.min);
    if (opts.max !== undefined) numInput.max = String(opts.max);
    numInput.value = fmt(value);
    numInput.style.width = '72px';
  }

  const apply = (raw: string, from: 'range' | 'number'): void => {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    const v = clamp(parsed);
    onChange(v);
    if (from !== 'range') input.value = String(v);
    if (numInput && from !== 'number') numInput.value = fmt(v);
    renderPreview();
  };

  input.addEventListener('focus', () => beginEdit());
  input.addEventListener('pointerdown', () => beginEdit());
  input.addEventListener('change', () => commitEdit());
  input.addEventListener('input', () => apply(input.value, 'range'));
  row.appendChild(input);

  if (numInput) {
    numInput.addEventListener('focus', () => beginEdit());
    numInput.addEventListener('change', () => {
      const v = clamp(parseFloat(numInput!.value));
      if (Number.isFinite(v)) numInput!.value = fmt(v);
      commitEdit();
    });
    numInput.addEventListener('input', () => apply(numInput!.value, 'number'));
    row.appendChild(numInput);
  }
  return row;
}

function textRow(label: string, value: string, onChange: (v: string) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('focus', () => beginEdit());
  input.addEventListener('change', () => commitEdit());
  input.addEventListener('input', () => onChange(input.value));
  row.appendChild(lab);
  row.appendChild(input);
  return row;
}

function selectRow(label: string, value: string, options: readonly string[], onChange: (v: string) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const sel = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    if (o === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    beginEdit(); onChange(sel.value); commitEdit();
    renderSkillInspector(); renderPreview();
  });
  row.appendChild(lab);
  row.appendChild(sel);
  return row;
}

// ---- 角色層 Inspector -----------------------------------------------------

function renderCharInspector(): void {
  const insp = $('char-inspector');
  insp.innerHTML = '';
  const p = currentProfile();
  if (!p) { insp.innerHTML = '<div class="hint">左側選一個角色。</div>'; return; }

  insp.appendChild(selectRow('能量模式 mode', p.mode, ENERGY_MODES as readonly string[], (v) => { p.mode = v as EnergyMode; }));
  insp.appendChild(numberRow('充能上限 energyCap', p.energyCap, (v) => { p.energyCap = v; }, { min: 1, step: 1 }));
  insp.appendChild(numberRow('傷害倍率 damageMultiplier', p.damageMultiplier, (v) => { p.damageMultiplier = v; }, { min: 0, max: 3, step: 0.1, slider: true }));

  // 攻擊速度倍率（用戶第十一輪，per-character）：每個可變身角色一個 slider，統一調該角色攻擊節奏。存 byChar override key。
  const spTitle = document.createElement('div');
  spTitle.className = 'section-title';
  spTitle.style.marginTop = '12px';
  spTitle.textContent = '攻擊速度（各可變身角色，全域非單招）';
  insp.appendChild(spTitle);
  if (!attackSpeedFile.byChar) attackSpeedFile.byChar = {};
  const byChar = attackSpeedFile.byChar;
  for (const ck of ATTACK_SPEED_CHAR_KEYS) {
    insp.appendChild(numberRow(`${ck} 攻速倍率`, byChar[ck] ?? ATTACK_SPEED_DEFAULT_MULT, (v) => { byChar[ck] = v; }, { min: 0.5, max: 3, step: 0.05, slider: true }));
  }
  const spHint = document.createElement('div');
  spHint.className = 'hint';
  spHint.textContent = '各可變身角色獨立：1.0=原本節奏；>1 攻擊更快（動畫加速＋冷卻÷＋前搖÷連動）。玩家變身切角色時攻速跟著換。套用時與招式一起存。';
  insp.appendChild(spHint);
}

// ---- 招式層 Inspector -----------------------------------------------------

function renderSkillInspector(): void {
  const insp = $('skill-inspector');
  insp.innerHTML = '';
  const a = currentSkill();
  if (!a) { insp.innerHTML = '<div class="hint">選一個招式以編輯。</div>'; return; }

  const title = document.createElement('div');
  title.className = 'hint';
  title.textContent = `編輯：${SKILL_LABELS[selectedSkill]}（${selectedSkill}）`;
  insp.appendChild(title);

  insp.appendChild(selectRow('形狀 shapeType', a.shapeType, SHAPE_TYPES as readonly string[], (v) => {
    a.shapeType = v as ShapeType;
    // 切形狀時補上該形狀需要的欄位預設，避免 undefined。
    if (v === 'circle' && a.radius === undefined) a.radius = 1;
    if (v === 'fan') { if (a.radius === undefined) a.radius = 1.5; if (a.angle === undefined) a.angle = 160; }
    if (v === 'rectangle') { if (a.length === undefined) a.length = 2; if (a.width === undefined) a.width = 0.8; }
  }));

  if (a.shapeType === 'circle') {
    insp.appendChild(numberRow('半徑 radius', a.radius ?? 1, (v) => { a.radius = v; }, { min: 0, max: 5, step: 0.05, slider: true }));
  } else if (a.shapeType === 'fan') {
    insp.appendChild(numberRow('半徑 radius', a.radius ?? 1.5, (v) => { a.radius = v; }, { min: 0, max: 5, step: 0.05, slider: true }));
    insp.appendChild(numberRow('張角 angle°', a.angle ?? 160, (v) => { a.angle = v; }, { min: 0, max: 360, step: 5, slider: true }));
  } else {
    insp.appendChild(numberRow('長 length', a.length ?? 2, (v) => { a.length = v; }, { min: 0, max: 6, step: 0.05, slider: true }));
    insp.appendChild(numberRow('寬 width', a.width ?? 0.8, (v) => { a.width = v; }, { min: 0, max: 5, step: 0.05, slider: true }));
  }

  insp.appendChild(numberRow('offsetX', a.offsetX, (v) => { a.offsetX = v; }, { min: -3, max: 4, step: 0.05, slider: true }));
  insp.appendChild(numberRow('offsetY', a.offsetY, (v) => { a.offsetY = v; }, { min: -3, max: 3, step: 0.05, slider: true }));
  insp.appendChild(numberRow('傷害 damage', a.damage, (v) => { a.damage = v; }, { min: 0, step: 1 }));
  insp.appendChild(numberRow('前搖 hitDelay', a.hitDelay, (v) => { a.hitDelay = v; }, { min: 0, max: 3, step: 0.05, slider: true }));
  insp.appendChild(numberRow('擊退 knockback', a.knockback, (v) => { a.knockback = v; }, { min: 0, max: 20, step: 0.5, slider: true }));
  insp.appendChild(textRow('特效 vfxKey', a.vfxKey ?? '', (v) => {
    if (v.length === 0) delete a.vfxKey; else a.vfxKey = v;
  }));
}

// ---- canvas 預覽 ----------------------------------------------------------

function getCss(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#fff';
}

function renderPreview(): void {
  const canvas = $('preview') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;

  const a = currentSkill();
  if (!a) return;

  const reach = shapeReach(a); // 招式最大延伸（供敵人參照定位）

  // 完整場景真實比例（用戶比例修正）：不再動態聚焦招式範圍，改成固定顯示整個遊戲場景 1920×1080
  // 等比縮進畫布 → 角色/招式在完整場景裡是「實際大小」。previewZoom 選擇性放大看細節（預設 1）。
  const sceneScale = (W / SCENE_W) * previewZoom;
  const viewScale = sceneScale; // 角色 + 招式範圍全用同一固定場景比例
  const s = PPU * viewScale;

  // 完整場景範圍框（1920×1080 等比縮）＋底色，讓用戶看得出整個場景。
  const sceneWpx = SCENE_W * sceneScale;
  const sceneHpx = SCENE_H * sceneScale;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.fillRect(cx - sceneWpx / 2, cy - sceneHpx / 2, sceneWpx, sceneHpx);
  ctx.strokeRect(cx - sceneWpx / 2, cy - sceneHpx / 2, sceneWpx, sceneHpx);
  ctx.fillStyle = 'rgba(150,150,180,0.6)';
  ctx.font = '10px Arial, sans-serif';
  ctx.fillText(`遊戲場景 ${SCENE_W}×${SCENE_H}`, cx - sceneWpx / 2 + 4, cy - sceneHpx / 2 + 12);
  ctx.restore();

  // 角色參照：畫在場景中心(=角色攻擊錨點/getBodyCenter)，尺寸=遊戲實際 269px×sceneScale（完整場景裡的實際大小）。
  const spr = selectedChar ? getSprite(selectedChar) : null;
  const sprPx = REF_SPRITE_SIZE * viewScale;
  if (spr) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(spr, cx - sprPx / 2, cy - sprPx / 2, sprPx, sprPx);
    ctx.restore();
  } else {
    // fallback：sprite 未載到 → 佔位人形，仍給尺度。
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.font = `${Math.round(sprPx * 0.5)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(180,180,200,0.5)';
    ctx.fillText('🧍', cx, cy);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  const offX = a.offsetX * s;
  const offY = a.offsetY * s;
  const hx = cx + offX; // 判定中心
  const hy = cy + offY;

  ctx.strokeStyle = getCss('--hit');
  ctx.fillStyle = 'rgba(255,157,92,0.22)';
  ctx.lineWidth = 2;

  if (a.shapeType === 'circle') {
    const rPx = (a.radius ?? 0) * s;
    if (rPx > 0) { ctx.beginPath(); ctx.arc(hx, hy, rPx, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  } else if (a.shapeType === 'fan') {
    const rPx = (a.radius ?? 0) * s;
    const ang = ((a.angle ?? 0) * Math.PI) / 180;
    if (rPx > 0 && ang > 0) {
      // 面向朝右(0 rad)，扇形從 -angle/2 到 +angle/2。
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.arc(hx, hy, rPx, -ang / 2, ang / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else {
    // rectangle：length 沿面向(x)、width 垂直(y)；判定中心在矩形中心。
    const lPx = (a.length ?? 0) * s;
    const wPx = (a.width ?? 0) * s;
    ctx.beginPath();
    ctx.rect(hx - lPx / 2, hy - wPx / 2, lPx, wPx);
    ctx.fill();
    ctx.stroke();
  }

  // 標籤
  ctx.fillStyle = getCss('--hit');
  ctx.font = '12px Arial, "Microsoft JhengHei", sans-serif';
  ctx.fillText(shapeDesc(a), hx + 6, hy - 6);

  // 面向箭頭（sprite 已示意本體；標面向朝右，offset/扇形以此為準）。
  ctx.strokeStyle = 'rgba(230,230,240,0.85)';
  ctx.lineWidth = 2;
  const arrow = Math.max(26, sprPx * 0.35);
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + arrow, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + arrow, cy); ctx.lineTo(cx + arrow - 6, cy - 5); ctx.lineTo(cx + arrow - 6, cy + 5); ctx.closePath(); ctx.fill();

  // 敵人參照（距離感）：在招式最大延伸(reach)邊緣、面向前方放一個敵人示意,
  // 看「招式打得到站在該距離的敵人嗎」。
  const enemySpr = getSprite('Enemy_Rush');
  const enemyX = cx + reach * s; // 面向右方、招式延伸處
  const ePx = REF_SPRITE_SIZE * viewScale * 0.9;
  if (enemySpr) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.drawImage(enemySpr, enemyX - ePx / 2, cy - ePx / 2, ePx, ePx);
    ctx.restore();
  }
  ctx.fillStyle = '#ff9d5c';
  ctx.font = '11px Arial, "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('敵人（招式延伸處）', enemyX, cy + ePx / 2 + 12);
  ctx.textAlign = 'start';

  // 比例尺
  ctx.fillStyle = '#9a9ab5';
  ctx.font = '11px Arial, sans-serif';
  ctx.fillText(
    `完整場景 ${SCENE_W}×${SCENE_H}｜比例 ×${viewScale.toFixed(3)}（1 unit=${PPU}px）${previewZoom !== 1 ? `｜放大 ${previewZoom}×` : ''}`,
    8, H - 10,
  );
}

/** 該形狀在 unit 下的最大延伸（供縮放）。 */
function shapeReach(a: AttackData): number {
  const off = Math.hypot(a.offsetX, a.offsetY);
  if (a.shapeType === 'circle' || a.shapeType === 'fan') return off + (a.radius ?? 0);
  return off + Math.max(a.length ?? 0, a.width ?? 0) / 2;
}

function shapeDesc(a: AttackData): string {
  if (a.shapeType === 'circle') return `圓 r=${fmt(a.radius ?? 0)}`;
  if (a.shapeType === 'fan') return `扇 r=${fmt(a.radius ?? 0)} ∠${fmt(a.angle ?? 0)}°`;
  return `矩 ${fmt(a.length ?? 0)}×${fmt(a.width ?? 0)}`;
}

// ---- 載入 / 匯出 / 新增 / 重設 --------------------------------------------

function loadIntoState(f: SkillFile, recordHistory = false): void {
  if (recordHistory) pushHistory();
  file = f;
  ensureSelection();
  renderAll();
}

function loadDefault(): void {
  loadIntoState(defaultSkillFile(), true);
  setStatus('已載入預設（來自遊戲 CHARACTER_COMBAT 權威值）。', 'ok');
}

/** 開啟載入（匯入回顯）：優先讀 localStorage override 回填，無/壞→打包預設（不炸）。不進 undo。 */
function initLoad(): void {
  // 攻擊速度 override 回顯（獨立 key）。
  const aRaw = loadOverride(EDITOR_STORE_KEYS.attackSpeed);
  if (aRaw !== null) {
    const ar = validateAttackSpeed(aRaw);
    if (ar.ok) attackSpeedFile = ar.data;
  }
  const raw = loadOverride(EDITOR_STORE_KEYS.skills);
  if (raw !== null) {
    const r = validateSkills(raw);
    if (r.ok) {
      loadIntoState(r.data, false);
      setStatus('已載入你上次套用到遊戲的招式設定（可繼續編）。', 'ok');
      return;
    }
    setStatus('已套用的招式設定驗證失敗，退回打包預設。', 'err');
  }
  loadIntoState(defaultSkillFile(), false);
}

function loadFromFile(text: string, fileName: string): void {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch (e) { setStatus(`檔案 ${fileName} 不是合法 JSON：${(e as Error).message}`, 'err'); return; }
  const result = validateSkills(raw);
  if (!result.ok) {
    setStatus(`檔案 ${fileName} 驗證失敗（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return;
  }
  loadIntoState(result.data, true);
  const applied = applyToGame(EDITOR_STORE_KEYS.skills, result.data);
  setStatus(
    applied
      ? `已載入 ${fileName}（${Object.keys(result.data.characters).length} 角色）並套用到遊戲（重開仍在）。`
      : `已載入 ${fileName}（套用失敗：localStorage 不可用）。`,
    applied ? 'ok' : 'err',
  );
}

function exportJson(): void {
  const result = validateSkills(file);
  if (!result.ok) {
    setStatus(`匯出被擋下：資料不合法（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return;
  }
  const validated = assertValidSkills(file);
  const text = JSON.stringify(validated, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'skillConfig.json';
  link.click();
  URL.revokeObjectURL(link.href);
  setStatus(`驗證通過，已下載 skillConfig.json（${Object.keys(validated.characters).length} 角色）。`, 'ok');
}

function addChar(): void {
  const base = currentProfile();
  if (!base || !selectedChar) { setStatus('請先選一個角色再複製。', 'err'); return; }
  pushHistory();
  let n = 1;
  let key = `${selectedChar}_copy`;
  while (file.characters[key]) { n += 1; key = `${selectedChar}_copy${n}`; }
  file.characters[key] = JSON.parse(JSON.stringify(base)) as CharacterCombatProfile;
  selectedChar = key;
  renderAll();
  setStatus(`已新增角色「${key}」（複製自「${selectedChar}」）。`, 'info');
}

function resetDefault(): void {
  loadIntoState(defaultSkillFile(), true);
  setStatus('已重設為預設值。', 'info');
}

/** 套用到遊戲（匯入機制）：validate 過才存 localStorage，遊戲啟動優先讀。回傳是否成功。含攻擊速度（獨立 key）。 */
function applyToGameFromEditor(): boolean {
  const result = validateSkills(file);
  if (!result.ok) {
    setStatus(`套用被擋下：資料不合法（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return false;
  }
  // 攻擊速度也驗證（mult>0）——不合法擋整個套用（避免只套一半）。
  const aRes = validateAttackSpeed(attackSpeedFile);
  if (!aRes.ok) {
    setStatus(`套用被擋下：攻擊速度不合法：\n${aRes.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return false;
  }
  const ok = applyToGame(EDITOR_STORE_KEYS.skills, assertValidSkills(file));
  const okA = applyToGame(EDITOR_STORE_KEYS.attackSpeed, aRes.data); // 攻擊速度存獨立 key
  setStatus(
    ok && okA ? '✅ 已套用到遊戲（招式＋攻擊速度，存入瀏覽器）。重開遊戲即生效。' : '套用失敗：瀏覽器 localStorage 不可用。',
    ok && okA ? 'ok' : 'err',
  );
  return ok && okA;
}

/** 套用並回到遊戲：套用成功才跳轉回遊戲頁（../）。 */
function applyAndReturnToGame(): void {
  if (!applyToGameFromEditor()) return;
  setStatus('✅ 已套用，返回遊戲中…', 'ok');
  window.location.href = '../';
}

/** 清除套用（回打包預設）：移除 localStorage override（招式 + 攻擊速度）。 */
function clearAppliedFromEditor(): void {
  clearOverride(EDITOR_STORE_KEYS.skills);
  clearOverride(EDITOR_STORE_KEYS.attackSpeed);
  attackSpeedFile = defaultAttackSpeedFile();
  setStatus('已清除套用，遊戲將回到打包預設招式設定＋攻擊速度。', 'info');
}

// ---- 統一重繪 -------------------------------------------------------------

function renderAll(): void {
  renderCharList();
  renderSkillTabs();
  renderCharInspector();
  renderSkillInspector();
  renderPreview();
}

// ---- 綁定 -----------------------------------------------------------------

function bindUI(): void {
  $('schema-version').textContent = `schema v${SKILL_SCHEMA_VERSION}`;
  $('btn-load-default').addEventListener('click', loadDefault);
  $('btn-export').addEventListener('click', exportJson);
  $('btn-reset').addEventListener('click', resetDefault);
  $('btn-apply').addEventListener('click', applyToGameFromEditor);
  $('btn-apply-return').addEventListener('click', applyAndReturnToGame);
  $('btn-clear-apply').addEventListener('click', clearAppliedFromEditor);

  // 預覽放大滑桿（1×=完整場景真實比例；放大只為看細節，比例仍真實）。
  const zoomInput = editorRoot.querySelector('#preview-zoom') as HTMLInputElement | null;
  if (zoomInput) {
    zoomInput.addEventListener('input', () => {
      previewZoom = Number(zoomInput.value) || 1;
      const val = editorRoot.querySelector('#preview-zoom-val');
      if (val) val.textContent = `${previewZoom}×`;
      renderPreview();
    });
  }
  $('btn-add-char').addEventListener('click', addChar);
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);

  const fileInput = $<HTMLInputElement>('file-input');
  $('btn-load-file').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => loadFromFile(String(reader.result), f.name);
    reader.readAsText(f);
    fileInput.value = '';
  });

  window.addEventListener('keydown', keydownHandler);
  updateHistoryButtons();
}

/** 快捷鍵處理（Ctrl+Z/Y）：具名 handler 供 unmount 移除。 */
function keydownHandler(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
}

// ---- mount 化（方案 A' 遊戲內展開 + 獨立頁並存） -------------------------

/** 編輯器 body HTML（從 skill-editor/index.html <body> 搬來，去 <script>）。 */
const EDITOR_BODY_HTML = `
<header>
  <h1>招式編輯器</h1>
  <span class="badge" id="schema-version"></span>
  <button id="btn-undo" title="復原 (Ctrl+Z)" disabled>↶ 復原</button>
  <button id="btn-redo" title="重做 (Ctrl+Y)" disabled>↷ 重做</button>
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
  <div class="col-list">
    <div class="section-title">角色</div>
    <div id="char-list"></div>
    <button id="btn-add-char" style="width:100%; margin-top:6px;">+ 新增角色（複製選中）</button>
    <div class="section-title">招式</div>
    <div id="skill-tabs" class="tabs"></div>
  </div>
  <div class="stage-wrap">
    <canvas id="preview" width="640" height="360"></canvas>
    <div style="margin-top:6px;font-size:12px;color:#9a9ab5;display:flex;align-items:center;gap:8px;">
      <span>放大檢視</span>
      <input id="preview-zoom" type="range" min="1" max="6" step="0.5" value="1" style="flex:1;" />
      <span id="preview-zoom-val">1×</span>
      <span>（1×＝完整場景真實比例）</span>
    </div>
  </div>
  <div class="col-inspector">
    <div class="section-title">角色設定</div>
    <div id="char-inspector"></div>
    <div class="section-title">招式判定（AttackData）</div>
    <div id="skill-inspector"><div class="hint">選一個招式以編輯。</div></div>
  </div>
</div>
<div id="status">就緒。左側選角色→選招式，右側調數值，中間即時預覽判定形狀（含扇形）。</div>
`;

/** 編輯器樣式（命名空間 .tb-editor-root）。 */
const EDITOR_CSS = `
.tb-editor-root {
  --bg: #1a1a2e; --panel: #23233a; --panel2: #2c2c48; --line: #3a3a5c;
  --text: #e6e6f0; --muted: #9a9ab5; --accent: #6c8cff; --danger: #ff6c7a; --ok: #59d98e;
  --stage: #10101c; --hit: #ff9d5c;
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
.tb-editor-root button:disabled { opacity: 0.4; cursor: not-allowed; }
.tb-editor-root select, .tb-editor-root input { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; font-size: 13px; }
.tb-editor-root .layout { display: flex; flex: 1; min-height: 0; }
.tb-editor-root .col-list { width: 220px; border-right: 1px solid var(--line); padding: 12px; background: var(--panel); overflow-y: auto; }
.tb-editor-root .stage-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #14141f; overflow: auto; }
.tb-editor-root #preview { background: var(--stage); outline: 1px solid var(--line); }
.tb-editor-root .col-inspector { width: 330px; border-left: 1px solid var(--line); padding: 12px; overflow-y: auto; background: var(--panel); }
.tb-editor-root .section-title { color: var(--muted); font-size: 12px; text-transform: uppercase; margin: 10px 0 8px; letter-spacing: 0.5px; }
.tb-editor-root .list-item { padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; margin-bottom: 6px; cursor: pointer; background: var(--panel2); display: flex; align-items: center; gap: 8px; }
.tb-editor-root .list-item.selected { border-color: var(--accent); background: #34345a; }
.tb-editor-root .list-item .grow { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-editor-root .tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.tb-editor-root .tab { padding: 5px 8px; font-size: 12px; }
.tb-editor-root .tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.tb-editor-root .row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.tb-editor-root .row label { width: 128px; color: var(--muted); }
.tb-editor-root .row input, .tb-editor-root .row select { flex: 1; }
.tb-editor-root .row .val { width: 50px; text-align: right; color: var(--muted); }
.tb-editor-root #status { padding: 8px 16px; font-size: 13px; white-space: pre-wrap; border-top: 1px solid var(--line); background: var(--panel); max-height: 120px; overflow-y: auto; flex: 0 0 auto; }
.tb-editor-root .status-ok { color: var(--ok); } .tb-editor-root .status-err { color: var(--danger); }
.tb-editor-root .hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
`;

const EDITOR_STYLE_ID = 'tb-skill-editor-style';

function ensureEditorStyle(): void {
  if (document.getElementById(EDITOR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = EDITOR_STYLE_ID;
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}

/**
 * 掛載招式編輯器到指定容器（EditorMountFn）：注入 HTML+樣式 → bindUI → initLoad（回顯）。
 * 回傳 { unmount() } 清 DOM + 移除全域 keydown。
 */
export function mount(container: HTMLElement): { unmount(): void } {
  ensureEditorStyle();
  container.classList.add('tb-editor-root');
  container.innerHTML = EDITOR_BODY_HTML;
  editorRoot = container;

  // 重置狀態（反覆開關 overlay：回乾淨初值，initLoad 再讀 override 回顯）。
  file = defaultSkillFile();
  attackSpeedFile = defaultAttackSpeedFile();
  selectedChar = Object.keys(file.characters)[0] ?? null;
  selectedSkill = 'normalAttack';
  undoStack = [];
  redoStack = [];

  bindUI();
  initLoad(); // 匯入回顯：開啟優先讀 localStorage override 回填，無則打包預設

  return {
    unmount(): void {
      window.removeEventListener('keydown', keydownHandler);
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

