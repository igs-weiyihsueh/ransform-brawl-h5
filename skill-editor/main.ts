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
} from '@/config/editorStore';

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

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

// ---- 狀態 -----------------------------------------------------------------

function cloneFile(f: SkillFile): SkillFile {
  return JSON.parse(JSON.stringify(f)) as SkillFile;
}

let file: SkillFile = defaultSkillFile();
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
  setStatus(`已載入 ${fileName}：${Object.keys(result.data.characters).length} 個角色。`, 'ok');
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

/** 套用到遊戲（匯入機制）：validate 過才存 localStorage，遊戲啟動優先讀。 */
function applyToGameFromEditor(): void {
  const result = validateSkills(file);
  if (!result.ok) {
    setStatus(`套用被擋下：資料不合法（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return;
  }
  const ok = applyToGame(EDITOR_STORE_KEYS.skills, assertValidSkills(file));
  setStatus(
    ok ? '✅ 已套用到遊戲（存入瀏覽器）。重開遊戲即生效。' : '套用失敗：瀏覽器 localStorage 不可用。',
    ok ? 'ok' : 'err',
  );
}

/** 清除套用（回打包預設）：移除 localStorage override。 */
function clearAppliedFromEditor(): void {
  clearOverride(EDITOR_STORE_KEYS.skills);
  setStatus('已清除套用，遊戲將回到打包預設招式設定。', 'info');
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
  $('btn-clear-apply').addEventListener('click', clearAppliedFromEditor);

  // 預覽放大滑桿（1×=完整場景真實比例；放大只為看細節，比例仍真實）。
  const zoomInput = document.getElementById('preview-zoom') as HTMLInputElement | null;
  if (zoomInput) {
    zoomInput.addEventListener('input', () => {
      previewZoom = Number(zoomInput.value) || 1;
      const val = document.getElementById('preview-zoom-val');
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

  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });
  updateHistoryButtons();
}

bindUI();
renderAll();
