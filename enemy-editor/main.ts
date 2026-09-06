/**
 * 怪物編輯器（獨立進入點）— 可視化編輯 ENEMY_AI 敵人設定。
 *
 * 架構：獨立 Vite entry（enemy-editor/index.html），與遊戲分開打包，純前端零 Phaser。
 * 只 import enemySchema（其只讀 import enemyConfig 的型別 + ENEMY_AI 值當初值，無遊戲 runtime）。
 *
 * 功能：列敵人 → 選一隻 → Inspector 編各欄位（數字/滑桿、attackKind 下拉、characterKey、
 * attack 子欄位）→ canvas 同心圓即時預覽 detectRange/attackRange/attack.radius（×PPU）→
 * assertValidEnemies 驗過才匯出 JSON；可載入 JSON、新增敵人（複製一筆改 key）、Ctrl+Z undo。
 */
import {
  ENEMY_SCHEMA_VERSION,
  ATTACK_KINDS,
  assertValidEnemies,
  defaultEnemyFile,
  validateEnemies,
  type EnemyAIConfig,
  type EnemyAttackKind,
  type EnemyFile,
} from '@/config/enemySchema';
import {
  EDITOR_STORE_KEYS,
  applyToGame,
  clearOverride,
  loadOverride,
} from '@/config/editorStore';

/** Pixels-Per-Unit：對照 gameConfig.PPU=100（本檔自持常數，不 import 遊戲檔）。 */
const PPU = 100;

// 角色參照（攻擊範圍預覽用，用戶 UX 修正）：敵人 sprite 顯示尺寸 = FRAME_SIZE×SPRITE_SCALE。
// 對齊遊戲：FRAME_SIZE=256、SPRITE_SCALE≈1.05 → ≈269px（設計解析度）。sprite 與範圍同乘 viewScale，
// 故「範圍相對敵人」比例恆等於遊戲實際（PPU=100，1 unit=100px）。
const REF_SPRITE_SIZE = 269;
/** 遊戲場景尺寸（完整場景視野，對齊 GAME 1920×1080）。 */
const SCENE_W = 1920;
const SCENE_H = 1080;
/** 預覽放大倍率（1=完整場景真實比例；>1 選擇性放大看細節，仍等比、以中心為錨）。 */
let previewZoom = 1;
/** 敵人 idle sprite 路徑（enemy-editor 在 /enemy-editor/，資產在網站根）。依 characterKey 載，載不到 fallback。 */
function enemySpriteUrl(characterKey: string): string {
  return `../assets/images/characters/${characterKey}/idle/frame_00.png`;
}

/** sprite 影像快取：載入完成後重繪預覽（canvas drawImage 需等圖 load）。 */
const spriteCache = new Map<string, HTMLImageElement>();
function getSprite(characterKey: string): HTMLImageElement | null {
  if (!characterKey) return null;
  const cached = spriteCache.get(characterKey);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
  const img = new Image();
  img.src = enemySpriteUrl(characterKey);
  img.addEventListener('load', () => renderPreview()); // 載完重繪
  img.addEventListener('error', () => renderPreview()); // 失敗也重繪（走 fallback）
  spriteCache.set(characterKey, img);
  return null; // 首次尚未載完，本次先畫 fallback
}

/**
 * mount 化（方案 A' 遊戲內展開）：DOM 查找 scope 進 editorRoot（overlay 分配的 .tb-editor-root 容器），
 * 不再吃 document 全域（避免與遊戲頁 / 其他編輯器 id 撞）。獨立頁 /enemy-editor/ 仍可用（並存）：
 * index.html 呼叫 mount(document.body 內的容器)。
 */
let editorRoot: HTMLElement = document.body;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = editorRoot.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

// ---- 狀態 -----------------------------------------------------------------

function cloneFile(f: EnemyFile): EnemyFile {
  return JSON.parse(JSON.stringify(f)) as EnemyFile;
}

let file: EnemyFile = defaultEnemyFile();
let selectedKey: string | null = Object.keys(file.enemies)[0] ?? null;

// ---- Undo / Redo ----------------------------------------------------------

const HISTORY_CAP = 50;
let undoStack: EnemyFile[] = [];
let redoStack: EnemyFile[] = [];
let pendingSnapshot: string | null = null;

function beginEdit(): void { pendingSnapshot = JSON.stringify(file); }
function commitEdit(): void {
  if (pendingSnapshot === null) return;
  if (JSON.stringify(file) !== pendingSnapshot) {
    undoStack.push(JSON.parse(pendingSnapshot) as EnemyFile);
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

const ENEMY_LABELS: Record<string, string> = {
  Enemy_Rush: '衝鋒兵', Enemy_Ranged: '遠程兵', Enemy_Elite: '菁英兵',
};
function enemyLabel(key: string): string {
  const zh = ENEMY_LABELS[key];
  return zh ? `${zh}（${key}）` : key;
}

function currentEnemy(): EnemyAIConfig | undefined {
  return selectedKey ? file.enemies[selectedKey] : undefined;
}

function ensureSelection(): void {
  if (!selectedKey || !file.enemies[selectedKey]) {
    selectedKey = Object.keys(file.enemies)[0] ?? null;
  }
}

// ---- 敵人清單 -------------------------------------------------------------

function renderList(): void {
  const list = $('enemy-list');
  list.innerHTML = '';
  for (const key of Object.keys(file.enemies)) {
    const item = document.createElement('div');
    item.className = 'list-item' + (key === selectedKey ? ' selected' : '');
    const label = document.createElement('span');
    label.className = 'grow';
    label.textContent = enemyLabel(key);
    item.appendChild(label);

    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = '刪除敵人';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Object.keys(file.enemies).length <= 1) {
        setStatus('至少要保留一隻敵人。', 'err');
        return;
      }
      pushHistory();
      delete file.enemies[key];
      if (selectedKey === key) selectedKey = Object.keys(file.enemies)[0] ?? null;
      renderAll();
    });
    item.appendChild(del);

    item.addEventListener('click', () => { selectedKey = key; renderAll(); });
    list.appendChild(item);
  }
}

// ---- Inspector ------------------------------------------------------------

function numberRow(
  label: string, value: number, onChange: (v: number) => void,
  opts: { min?: number; max?: number; step?: number; slider?: boolean } = {},
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  row.appendChild(lab);

  // 夾範圍（有 min/max 時把值夾回界內；用戶要求超界夾回）。
  const clamp = (v: number): number => {
    let x = v;
    if (opts.min !== undefined && x < opts.min) x = opts.min;
    if (opts.max !== undefined && x > opts.max) x = opts.max;
    return x;
  };
  const stepStr = String(opts.step ?? 'any'); // 'any' 或小數 step → 支援小數輸入

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

  // 套用值：改 setter + 兩邊(range/number)同步 + 重繪。parseFloat 支援小數。
  const apply = (raw: string, from: 'range' | 'number'): void => {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    const v = clamp(parsed);
    onChange(v);
    // 同步另一個控制項(避免打字時互相打斷：只更新非來源那個)。
    if (from !== 'range') input.value = String(v);
    if (numInput && from !== 'number') numInput.value = fmt(v);
    renderPreview();
    renderList();
  };

  input.addEventListener('focus', () => beginEdit());
  input.addEventListener('pointerdown', () => beginEdit()); // slider 拖動
  input.addEventListener('change', () => commitEdit());
  input.addEventListener('input', () => apply(input.value, 'range'));

  row.appendChild(input);

  if (numInput) {
    numInput.addEventListener('focus', () => beginEdit());
    numInput.addEventListener('change', () => {
      // 失焦/Enter：夾回界內並回填(讓超界輸入視覺上被夾)。
      const v = clamp(parseFloat(numInput!.value));
      if (Number.isFinite(v)) numInput!.value = fmt(v);
      commitEdit();
    });
    numInput.addEventListener('input', () => apply(numInput!.value, 'number'));
    row.appendChild(numInput);
  }
  return row;
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
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
  input.addEventListener('input', () => { onChange(input.value); });
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
    beginEdit();
    onChange(sel.value);
    commitEdit();
    renderInspector();
    renderPreview();
  });
  row.appendChild(lab);
  row.appendChild(sel);
  return row;
}

/** 形狀類型專用列：顯示中文（圓形/直線/扇形），值維持 enum（circle/rectangle/fan）。 */
type AttackShape = 'circle' | 'rectangle' | 'fan';
const SHAPE_LABELS: Record<AttackShape, string> = {
  circle: '圓形（circle）',
  rectangle: '直線 / 矩形（rectangle）',
  fan: '扇形（fan）',
};
function shapeTypeRow(value: string, onChange: (v: AttackShape) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = '攻擊形狀 shapeType';
  const sel = document.createElement('select');
  (['circle', 'rectangle', 'fan'] as AttackShape[]).forEach((o) => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = SHAPE_LABELS[o];
    if (o === value) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    beginEdit();
    onChange(sel.value as AttackShape);
    commitEdit();
    renderInspector();
    renderPreview();
  });
  row.appendChild(lab);
  row.appendChild(sel);
  return row;
}

function renderInspector(): void {
  const insp = $('inspector');
  insp.innerHTML = '';
  const e = currentEnemy();
  if (!e) { insp.innerHTML = '<div class="hint">左側選一隻敵人以編輯。</div>'; return; }

  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = `${selectedKey ? enemyLabel(selectedKey) : ''}`;
  insp.appendChild(title);

  insp.appendChild(textRow('characterKey', e.characterKey, (v) => { e.characterKey = v; }));
  insp.appendChild(numberRow('生命 hp', e.hp, (v) => { e.hp = v; }, { min: 1, step: 1 }));
  insp.appendChild(numberRow('移速 moveSpeed', e.moveSpeed, (v) => { e.moveSpeed = v; }, { min: 0, max: 10, step: 0.1, slider: true }));
  insp.appendChild(numberRow('偵測 detectRange', e.detectRange, (v) => { e.detectRange = v; }, { min: 0, max: 40, step: 0.5, slider: true }));
  insp.appendChild(numberRow('攻擊範圍 attackRange', e.attackRange, (v) => { e.attackRange = v; }, { min: 0, max: 40, step: 0.5, slider: true }));
  insp.appendChild(numberRow('蓄力/前搖 chargeTime', e.chargeTime, (v) => { e.chargeTime = v; }, { min: 0, max: 5, step: 0.1, slider: true }));
  insp.appendChild(numberRow('冷卻 attackCooldown', e.attackCooldown, (v) => { e.attackCooldown = v; }, { min: 0, max: 10, step: 0.1, slider: true }));
  insp.appendChild(numberRow('硬直 hitStun', e.hitStun, (v) => { e.hitStun = v; }, { min: 0, max: 3, step: 0.05, slider: true }));
  // 被擊退力 knockbackForce 已移除 editor 欄位（用戶擊退定案：怪不需要「被擊退力」，擊退看玩家招式）。
  // 欄位值仍保留在資料中（schema/型別 knockbackForce 目前為必填，來自遊戲 enemyConfig），
  // 只是不顯示不可編；schema 相容性由異靈協調（UI-only 移除，遊戲端 takeHit 已不讀 knockbackForce）。

  insp.appendChild(selectRow('攻擊方式 attackKind', e.attackKind, ATTACK_KINDS as readonly string[], (v) => {
    e.attackKind = v as EnemyAttackKind;
    if (v === 'projectile' && e.projectileSpeed === undefined) e.projectileSpeed = 8;
  }));
  if (e.attackKind === 'projectile') {
    insp.appendChild(numberRow('射彈速度 projectileSpeed', e.projectileSpeed ?? 8, (v) => { e.projectileSpeed = v; }, { min: 0, max: 30, step: 0.5, slider: true }));
  }

  // attack 子欄位
  const at = document.createElement('div');
  at.className = 'section-title';
  at.textContent = '攻擊判定 attack';
  insp.appendChild(at);

  // 攻擊形狀：圓形 / 直線(矩形/OBB) / 扇形——預覽會依此畫對應形狀，對齊遊戲 buildAttackCircle/OBB/Fan。
  insp.appendChild(shapeTypeRow(e.attack.shapeType, (v) => {
    e.attack.shapeType = v;
    // 切形狀補該形狀需要的欄位預設，避免 undefined。
    if (v === 'circle' && e.attack.radius === undefined) e.attack.radius = 0.5;
    if (v === 'fan') { if (e.attack.radius === undefined) e.attack.radius = 1; if (e.attack.angle === undefined) e.attack.angle = 90; }
    if (v === 'rectangle') { if (e.attack.length === undefined) e.attack.length = 1; if (e.attack.width === undefined) e.attack.width = 1; }
  }));
  if (e.attack.shapeType === 'circle') {
    insp.appendChild(numberRow('半徑 radius', e.attack.radius ?? 0.5, (v) => { e.attack.radius = v; }, { min: 0, max: 5, step: 0.05, slider: true }));
  } else if (e.attack.shapeType === 'fan') {
    insp.appendChild(numberRow('半徑 radius', e.attack.radius ?? 1, (v) => { e.attack.radius = v; }, { min: 0, max: 5, step: 0.05, slider: true }));
    insp.appendChild(numberRow('張角 angle°', e.attack.angle ?? 90, (v) => { e.attack.angle = v; }, { min: 0, max: 360, step: 5, slider: true }));
  } else {
    insp.appendChild(numberRow('長 length', e.attack.length ?? 1, (v) => { e.attack.length = v; }, { min: 0, max: 5, step: 0.05, slider: true }));
    insp.appendChild(numberRow('寬 width', e.attack.width ?? 1, (v) => { e.attack.width = v; }, { min: 0, max: 5, step: 0.05, slider: true }));
  }
  insp.appendChild(numberRow('offsetX', e.attack.offsetX, (v) => { e.attack.offsetX = v; }, { min: -3, max: 3, step: 0.05, slider: true }));
  insp.appendChild(numberRow('offsetY', e.attack.offsetY, (v) => { e.attack.offsetY = v; }, { min: -3, max: 3, step: 0.05, slider: true }));
  insp.appendChild(numberRow('傷害 damage', e.attack.damage, (v) => { e.attack.damage = v; }, { min: 0, step: 1 }));
  insp.appendChild(numberRow('攻擊擊退 knockback（打玩家）', e.attack.knockback, (v) => { e.attack.knockback = v; }, { min: 0, max: 10, step: 0.1, slider: true }));
  insp.appendChild(numberRow('命中延遲 hitDelay', e.attack.hitDelay, (v) => { e.attack.hitDelay = v; }, { min: 0, max: 3, step: 0.05, slider: true }));
}

// ---- 預覽（同心圓，×PPU）--------------------------------------------------

function renderPreview(): void {
  const canvas = $('preview') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H / 2;

  const e = currentEnemy();
  if (!e) return;

  // 完整場景真實比例（用戶比例修正）：不再動態聚焦範圍，改成固定顯示整個遊戲場景 1920×1080
  // 等比縮進畫布 → 角色/範圍在完整場景裡是「實際大小」。可用 previewZoom 選擇性放大看細節（預設 1=完整場景）。
  const sceneScale = (W / SCENE_W) * previewZoom;
  // 場景中心對齊畫布中心（zoom 時仍以中心為錨）。
  const cxScene = W / 2;
  const cyScene = H / 2;

  // 畫完整場景範圍框（1920×1080 等比縮）＋地面底色，讓用戶看得出「整個場景」。
  const sceneWpx = SCENE_W * sceneScale;
  const sceneHpx = SCENE_H * sceneScale;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.fillRect(cxScene - sceneWpx / 2, cyScene - sceneHpx / 2, sceneWpx, sceneHpx);
  ctx.strokeRect(cxScene - sceneWpx / 2, cyScene - sceneHpx / 2, sceneWpx, sceneHpx);
  ctx.fillStyle = 'rgba(150,150,180,0.6)';
  ctx.font = '10px Arial, sans-serif';
  ctx.fillText(`遊戲場景 ${SCENE_W}×${SCENE_H}`, cxScene - sceneWpx / 2 + 4, cyScene - sceneHpx / 2 + 12);
  ctx.restore();

  const viewScale = sceneScale; // 角色/範圍全用同一固定場景比例
  const cx2 = cxScene;
  const cy2 = cyScene;

  // 敵人角色參照：畫在場景中心(=敵人 getBodyCenter)，尺寸=遊戲實際 269px×sceneScale（完整場景裡的實際大小）。
  const spr = getSprite(e.characterKey);
  const sprPx = REF_SPRITE_SIZE * viewScale;
  if (spr) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(spr, cx2 - sprPx / 2, cy2 - sprPx / 2, sprPx, sprPx);
    ctx.restore();
  } else {
    // fallback：sprite 未載到 → 佔位人形，仍給尺度。
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.font = `${Math.round(sprPx * 0.5)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(180,180,200,0.5)';
    ctx.fillText('🧍', cx2, cy2);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  const ring = (radiusUnit: number, color: string, labelText: string): void => {
    const rPx = radiusUnit * PPU * viewScale;
    if (rPx <= 0) return;
    ctx.beginPath();
    ctx.arc(cx2, cy2, rPx, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = '12px Arial, "Microsoft JhengHei", sans-serif';
    ctx.fillText(labelText, cx2 + 4, cy2 - rPx - 4);
  };

  // 偵測範圍（大）→ 攻擊範圍 → 攻擊判定圈
  ring(e.detectRange, getCss('--detect'), `偵測 ${fmt(e.detectRange)}u`);
  ring(e.attackRange, getCss('--attackR'), `攻擊 ${fmt(e.attackRange)}u`);

  // 攻擊判定形狀（面向朝右示意，以 offset 為中心）：嚴格依 shapeType 畫——
  // circle→圓（buildAttackCircle）、rectangle→矩形/長條（buildAttackOBB）、fan→扇形（buildAttackFan）。
  const offX = e.attack.offsetX * PPU * viewScale;
  const offY = e.attack.offsetY * PPU * viewScale;
  const hx = cx + offX;
  const hy = cy + offY;
  ctx.strokeStyle = getCss('--hit');
  ctx.fillStyle = 'rgba(255,108,122,0.20)';
  ctx.lineWidth = 2;
  if (e.attack.shapeType === 'circle') {
    const rPx = (e.attack.radius ?? 0) * PPU * viewScale;
    if (rPx > 0) { ctx.beginPath(); ctx.arc(hx, hy, rPx, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  } else if (e.attack.shapeType === 'fan') {
    const rPx = (e.attack.radius ?? 0) * PPU * viewScale;
    const ang = ((e.attack.angle ?? 0) * Math.PI) / 180;
    if (rPx > 0 && ang > 0) {
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.arc(hx, hy, rPx, -ang / 2, ang / 2); // 面向朝右(0)，±angle/2
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else {
    // rectangle / 直線(OBB)：length 沿面向(x)、width 垂直(y)，中心在判定中心。
    const lPx = (e.attack.length ?? 0) * PPU * viewScale;
    const wPx = (e.attack.width ?? 0) * PPU * viewScale;
    ctx.beginPath();
    ctx.rect(hx - lPx / 2, hy - wPx / 2, lPx, wPx);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = getCss('--hit');
  ctx.font = '12px Arial, "Microsoft JhengHei", sans-serif';
  ctx.fillText('判定', hx + 6, hy - 6);

  // 面向箭頭（sprite 已示意本體；箭頭標面向朝右，攻擊 offset/扇形以此為準）。
  ctx.strokeStyle = 'rgba(230,230,240,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.max(24, REF_SPRITE_SIZE * viewScale * 0.35), cy);
  ctx.stroke();

  // 玩家參照（距離感）：在攻擊範圍(attackRange)邊緣、敵人面向前方放一個玩家示意,
  // 看「敵人攻擊範圍能不能搆到站在攻擊距離的玩家」。
  const playerSpr = getSprite('SunWukong');
  const playerX = cx + e.attackRange * PPU * viewScale; // 面向右方、攻擊距離處
  const pPx = REF_SPRITE_SIZE * viewScale * 0.9;
  if (playerSpr) {
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.drawImage(playerSpr, playerX - pPx / 2, cy - pPx / 2, pPx, pPx);
    ctx.restore();
  }
  ctx.fillStyle = '#7fd0ff';
  ctx.font = '11px Arial, "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('玩家（攻擊距離處）', playerX, cy + pPx / 2 + 12);
  ctx.textAlign = 'start';

  // 比例尺
  ctx.fillStyle = '#9a9ab5';
  ctx.font = '11px Arial, sans-serif';
  ctx.fillText(
    `完整場景 ${SCENE_W}×${SCENE_H}｜比例 ×${viewScale.toFixed(3)}（1 unit=${PPU}px）${previewZoom !== 1 ? `｜放大 ${previewZoom}×` : ''}`,
    8, H - 10,
  );
}

/** 讀 CSS 變數色值。 */
function getCss(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#fff';
}

// ---- 載入 / 匯出 / 新增 / 重設 --------------------------------------------

function loadIntoState(f: EnemyFile, recordHistory = false): void {
  if (recordHistory) pushHistory();
  file = f;
  ensureSelection();
  renderAll();
}

async function loadDefault(): Promise<void> {
  // 預設直接用打包進來的 ENEMY_AI（權威值），不需 fetch。
  loadIntoState(defaultEnemyFile(), true);
  setStatus('已載入預設（來自遊戲 ENEMY_AI 權威值）。', 'ok');
}

/** 開啟載入（匯入回顯）：優先讀 localStorage override 回填，無/壞→打包預設（不炸）。不進 undo。 */
function initLoad(): void {
  const raw = loadOverride(EDITOR_STORE_KEYS.enemies);
  if (raw !== null) {
    const r = validateEnemies(raw);
    if (r.ok) {
      loadIntoState(r.data, false);
      setStatus('已載入你上次套用到遊戲的敵人設定（可繼續編）。', 'ok');
      return;
    }
    setStatus('已套用的敵人設定驗證失敗，退回打包預設。', 'err');
  }
  loadIntoState(defaultEnemyFile(), false);
}

function loadFromFile(text: string, fileName: string): void {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch (e) { setStatus(`檔案 ${fileName} 不是合法 JSON：${(e as Error).message}`, 'err'); return; }
  const result = validateEnemies(raw);
  if (!result.ok) {
    setStatus(`檔案 ${fileName} 驗證失敗（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return;
  }
  loadIntoState(result.data, true);
  const applied = applyToGame(EDITOR_STORE_KEYS.enemies, result.data);
  setStatus(
    applied
      ? `已載入 ${fileName}（${Object.keys(result.data.enemies).length} 隻）並套用到遊戲（重開仍在）。`
      : `已載入 ${fileName}（套用失敗：localStorage 不可用）。`,
    applied ? 'ok' : 'err',
  );
}

function exportJson(): void {
  const result = validateEnemies(file);
  if (!result.ok) {
    setStatus(`匯出被擋下：資料不合法（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return;
  }
  const validated = assertValidEnemies(file);
  const text = JSON.stringify(validated, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'enemyConfig.json';
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`驗證通過，已下載 enemyConfig.json（${Object.keys(validated.enemies).length} 隻）。`, 'ok');
}

function addEnemy(): void {
  const base = currentEnemy();
  if (!base) { setStatus('請先選一隻敵人再複製。', 'err'); return; }
  pushHistory();
  // 產生不重複的新 key。
  let n = 1;
  let key = `${selectedKey}_copy`;
  while (file.enemies[key]) { n += 1; key = `${selectedKey}_copy${n}`; }
  file.enemies[key] = JSON.parse(JSON.stringify(base)) as EnemyAIConfig;
  selectedKey = key;
  renderAll();
  setStatus(`已新增敵人「${key}」（複製自「${base.characterKey}」），可改 key/數值。`, 'info');
}

function resetDefault(): void {
  loadIntoState(defaultEnemyFile(), true);
  setStatus('已重設為預設值。', 'info');
}

/** 套用到遊戲（匯入機制）：validate 過才存 localStorage，遊戲啟動優先讀。回傳是否成功。 */
function applyToGameFromEditor(): boolean {
  const result = validateEnemies(file);
  if (!result.ok) {
    setStatus(`套用被擋下：資料不合法（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return false;
  }
  const ok = applyToGame(EDITOR_STORE_KEYS.enemies, assertValidEnemies(file));
  setStatus(
    ok ? '✅ 已套用到遊戲（存入瀏覽器）。重開遊戲即生效。' : '套用失敗：瀏覽器 localStorage 不可用。',
    ok ? 'ok' : 'err',
  );
  return ok;
}

/** 套用並回到遊戲：套用成功才跳轉回遊戲頁（../）。 */
function applyAndReturnToGame(): void {
  if (!applyToGameFromEditor()) return;
  setStatus('✅ 已套用，返回遊戲中…', 'ok');
  window.location.href = '../';
}

/** 清除套用（回打包預設）：移除 localStorage override。 */
function clearAppliedFromEditor(): void {
  clearOverride(EDITOR_STORE_KEYS.enemies);
  setStatus('已清除套用，遊戲將回到打包預設敵人設定。', 'info');
}

// ---- 統一重繪 -------------------------------------------------------------

function renderAll(): void {
  renderList();
  renderInspector();
  renderPreview();
}

// ---- 綁定 -----------------------------------------------------------------

function bindUI(): void {
  $('schema-version').textContent = `schema v${ENEMY_SCHEMA_VERSION}`;
  $('btn-load-default').addEventListener('click', () => void loadDefault());
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
  $('btn-add').addEventListener('click', addEnemy);
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

/** 快捷鍵處理（Ctrl+Z/Y）：抽成具名 handler 供 unmount 移除（overlay 收合不殘留全域監聽）。 */
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

/**
 * 編輯器 body HTML（從 enemy-editor/index.html 的 <body> 搬來，去掉 <script>）。
 * mount 時注入 container，讓 $() scope 進來查得到。id 維持原樣（scope 在 container 內不與遊戲頁撞）。
 */
const EDITOR_BODY_HTML = `
<header>
  <h1>怪物編輯器</h1>
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
    <div class="section-title">敵人</div>
    <div id="enemy-list"></div>
    <button id="btn-add" style="width:100%; margin-top:6px;">+ 新增敵人（複製選中）</button>
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
    <div class="section-title">Inspector</div>
    <div id="inspector"><div class="hint">左側選一隻敵人以編輯。</div></div>
  </div>
</div>
<div class="legend">
  <span><span class="dot" style="background:var(--detect)"></span>偵測範圍 detectRange</span>
  <span><span class="dot" style="background:var(--attackR)"></span>攻擊範圍 attackRange</span>
  <span><span class="dot" style="background:var(--hit)"></span>攻擊判定 attack.radius</span>
</div>
<div id="status">就緒。左側選一隻敵人，右側調數值，中間圈圈即時預覽。</div>
`;

/**
 * 編輯器樣式（從 index.html <style> 搬來，全部命名空間在 .tb-editor-root 下，不污染遊戲頁/其他編輯器）。
 * 原 html/body 100% + header/.layout 100vh 改成吃 .tb-editor-root 容器高度（overlay host 給的 100%）。
 */
const EDITOR_CSS = `
.tb-editor-root {
  --bg: #1a1a2e; --panel: #23233a; --panel2: #2c2c48; --line: #3a3a5c;
  --text: #e6e6f0; --muted: #9a9ab5; --accent: #6c8cff; --danger: #ff6c7a; --ok: #59d98e;
  --stage: #10101c; --detect: #6c8cff; --attackR: #ffb300; --hit: #ff6c7a;
  display: flex; flex-direction: column; height: 100%;
  background: var(--bg); color: var(--text);
  font-family: Arial, "Microsoft JhengHei", "Noto Sans TC", sans-serif; font-size: 14px;
}
.tb-editor-root * { box-sizing: border-box; }
.tb-editor-root header { padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--line);
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap; flex: 0 0 auto; }
.tb-editor-root header h1 { font-size: 16px; margin: 0; }
.tb-editor-root header .spacer { flex: 1; }
.tb-editor-root .badge { font-size: 11px; color: var(--muted); border: 1px solid var(--line); padding: 1px 6px; border-radius: 10px; }
.tb-editor-root button { background: var(--panel2); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 13px; }
.tb-editor-root button:hover { border-color: var(--accent); }
.tb-editor-root button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.tb-editor-root button:disabled { opacity: 0.4; cursor: not-allowed; }
.tb-editor-root select, .tb-editor-root input { background: var(--bg); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 5px 8px; font-size: 13px; }
.tb-editor-root .layout { display: flex; flex: 1; min-height: 0; }
.tb-editor-root .col-list { width: 220px; border-right: 1px solid var(--line); padding: 12px; background: var(--panel); overflow-y: auto; }
.tb-editor-root .stage-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #14141f; overflow: auto; }
.tb-editor-root #preview { background: var(--stage); outline: 1px solid var(--line); position: relative; }
.tb-editor-root .col-inspector { width: 320px; border-left: 1px solid var(--line); padding: 12px; overflow-y: auto; background: var(--panel); }
.tb-editor-root .section-title { color: var(--muted); font-size: 12px; text-transform: uppercase; margin: 10px 0 8px; letter-spacing: 0.5px; }
.tb-editor-root .list-item { padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; margin-bottom: 6px; cursor: pointer; background: var(--panel2); display: flex; align-items: center; gap: 8px; }
.tb-editor-root .list-item.selected { border-color: var(--accent); background: #34345a; }
.tb-editor-root .list-item .grow { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-editor-root .row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.tb-editor-root .row label { width: 130px; color: var(--muted); }
.tb-editor-root .row input, .tb-editor-root .row select { flex: 1; }
.tb-editor-root .row .val { width: 52px; text-align: right; color: var(--muted); }
.tb-editor-root .legend { display: flex; gap: 14px; padding: 6px 16px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); background: var(--panel); flex: 0 0 auto; }
.tb-editor-root .legend .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.tb-editor-root #status { padding: 8px 16px; font-size: 13px; white-space: pre-wrap; border-top: 1px solid var(--line); background: var(--panel); max-height: 120px; overflow-y: auto; flex: 0 0 auto; }
.tb-editor-root .status-ok { color: var(--ok); } .tb-editor-root .status-err { color: var(--danger); }
.tb-editor-root .hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
`;

const EDITOR_STYLE_ID = 'tb-enemy-editor-style';

/** 注入一次編輯器樣式（命名空間 .tb-editor-root，重複 mount 不重注）。 */
function ensureEditorStyle(): void {
  if (document.getElementById(EDITOR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = EDITOR_STYLE_ID;
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}

/**
 * 掛載怪物編輯器到指定容器（EditorMountFn）：注入 HTML + 樣式 → bindUI → initLoad（波騎回顯）。
 * 回傳 { unmount() } 清掉 DOM + 移除全域 keydown 監聽（overlay 收合/切 tab 用）。
 */
export function mount(container: HTMLElement): { unmount(): void } {
  ensureEditorStyle();
  container.classList.add('tb-editor-root');
  container.innerHTML = EDITOR_BODY_HTML;
  editorRoot = container;

  // 重置狀態（同一 session 反覆開關 overlay：回到乾淨初值，initLoad 再讀 override 回顯）。
  file = defaultEnemyFile();
  selectedKey = Object.keys(file.enemies)[0] ?? null;
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

/**
 * 獨立頁自動啟動（並存）：/enemy-editor/ 頁的 index.html 有 #tb-editor-standalone 掛載點時自動 mount。
 * overlay lazy import 本模組時無此元素 → 不自動跑（無 module 頂層副作用），由 overlay 呼叫 mount(container)。
 */
const standaloneHost = document.getElementById('tb-editor-standalone');
if (standaloneHost) {
  mount(standaloneHost);
}

