/**
 * UI 位置編輯器（獨立進入點）— 可視化拖拉調整 UI 佈局。
 *
 * 架構：獨立 Vite entry（ui-editor/index.html），與遊戲分開打包，零 Phaser、
 * 只 import 凍結的 uiLayoutSchema（單向依賴，不 import 任何遊戲模組）。
 *
 * 功能：在 1920×1080 舞台上畫出各 UI 元素方框 → 拖拉移動 / 拉右下把手改大小 →
 * 右側 Inspector 數值微調 → assertValidUiLayout 驗過才匯出下載 uiLayout.json；
 * 也可載入既有 uiLayout.json。
 *
 * 座標模型：
 *  - overhead：容器有 width/height，編輯時擺在舞台上方中央當「編輯錨點」；
 *    各 overhead 元素的 x/y 是相對容器中心的 local 座標（跟遊戲端一致）。
 *  - panel：由欄參數算出 4 欄矩形（P1 active）；panel 元素 x/y 相對 P1 欄左上。
 */
import {
  UI_LAYOUT_SCHEMA_VERSION,
  assertValidUiLayout,
  DEFAULT_UI_LAYOUT,
  isVisible,
  validateUiLayout,
  type HasVisible,
  type PanelElement,
  type ScreenElement,
  type UiLayoutFile,
} from '@/config/uiLayoutSchema';
import {
  EDITOR_STORE_KEYS,
  applyToGame,
  clearOverride,
  loadOverride,
} from '@/config/editorStore';

/**
 * mount 化（方案 A' 遊戲內展開）：DOM 查找 scope 進 editorRoot（overlay 分配的 .tb-editor-root 容器），
 * 不吃 document 全域（避免與遊戲頁 / 其他編輯器 id 撞）。獨立頁 /ui-editor/ 仍可用（並存）。
 */
let editorRoot: HTMLElement = document.body;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = editorRoot.querySelector<T>(`#${id}`);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

// 角色參照（腳下圈編輯用，用戶 UX 修正）：遊戲角色顯示尺寸 = FRAME_SIZE×SPRITE_SCALE。
// FRAME_SIZE=256、SPRITE_SCALE≈1.05（=0.7×GLOBAL_CHARACTER_SCALE，由 offsetY 75.6=72×SPRITE_SCALE 反推）。
// 用固定值畫參照人形，讓搜索圈相對角色有真實尺度（PPU=100，圈半徑 50px≈角色半身）。
const REF_SPRITE_SIZE = 269; // 256 × 1.05，角色示意圖邊長（px，設計解析度）
/** 角色參照 idle sprite 路徑（ui-editor 在 /ui-editor/，資產在網站根）。載不到退場成佔位人形。 */
const REF_SPRITE_URL = '../assets/images/characters/SunWukong/idle/frame_00.png';

// 搜索圈/真空帶預覽對齊遊戲（用戶第九輪 #4）：遊戲 drawFootGlow 畫「2:1 貼地橢圓圓盤」——
// 寬 = 搜索圈直徑(radiusPx×2) × PLAYER_DISC.widthScale、高 = 寬/2（2:1 貼地透視）。中心 = footGlowCenter。
// 編輯器自持此係數（對照 playerConfig.PLAYER_DISC.widthScale=2.2；不 import 遊戲 runtime，同其他編輯器慣例）。
const PLAYER_DISC_WIDTH_SCALE = 2.2;


// ---- 狀態 -----------------------------------------------------------------

/** 深拷貝一份預設當初始狀態（避免改到常數）。 */
function cloneLayout(src: UiLayoutFile): UiLayoutFile {
  return JSON.parse(JSON.stringify(src)) as UiLayoutFile;
}

let layout: UiLayoutFile = cloneLayout(DEFAULT_UI_LAYOUT);
let zoom = 2.0; // 預設從頭上 UI 區塊開始，放大看清 local 小尺寸；panel 切換時降到 0.45
/** 目前選中的元素 key（如 'overhead.credit' / 'panel.chest'）。 */
let selectedKey: string | null = null;

// ---- Undo / Redo 歷史 -----------------------------------------------------
//
// 每次「拖拉結束 / Inspector 數值變更 / 載入 / 重設」前記一份 layout 深拷貝進 undoStack。
// Ctrl+Z 還原上一步（把當前推進 redoStack）、Ctrl+Y（或 Ctrl+Shift+Z）反向。
// 拖拉中連續移動不逐幀記，只在手勢開始 beginEdit() 記一次、放開才 commitEdit()。

const HISTORY_CAP = 50;
let undoStack: UiLayoutFile[] = [];
let redoStack: UiLayoutFile[] = [];
/** 手勢/編輯開始時暫存的 layout 快照（beginEdit 記、commitEdit 決定是否入棧）。 */
let pendingSnapshot: string | null = null;

/** 手勢/編輯開始：記一份當前 layout 的 JSON 快照（尚未入棧）。 */
function beginEdit(): void {
  pendingSnapshot = JSON.stringify(layout);
}

/** 手勢/編輯結束：若 layout 真的變了，把開始時的快照推進 undoStack、清空 redo。 */
function commitEdit(): void {
  if (pendingSnapshot === null) return;
  const now = JSON.stringify(layout);
  if (now !== pendingSnapshot) {
    undoStack.push(JSON.parse(pendingSnapshot) as UiLayoutFile);
    if (undoStack.length > HISTORY_CAP) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }
  pendingSnapshot = null;
}

/** 立即記一步（用於載入/重設這種一次性整份變更）。 */
function pushHistory(): void {
  undoStack.push(cloneLayout(layout));
  if (undoStack.length > HISTORY_CAP) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}

function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(cloneLayout(layout));
  layout = prev;
  selectedKey = null;
  renderStage();
  selectFirstIfNone();
  updateHistoryButtons();
  setStatus('已復原（Undo）。', 'info');
}

function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(cloneLayout(layout));
  layout = next;
  selectedKey = null;
  renderStage();
  selectFirstIfNone();
  updateHistoryButtons();
  setStatus('已重做（Redo）。', 'info');
}

function updateHistoryButtons(): void {
  const u = editorRoot.querySelector('#btn-undo') as HTMLButtonElement | null;
  const r = editorRoot.querySelector('#btn-redo') as HTMLButtonElement | null;
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}

// ---- 可編輯元素的統一存取介面 --------------------------------------------
//
// 每個可拖拉方框綁一個 accessor：讀/寫其 x/y/w/h（寫回 layout 物件），
// 以及 origin（該元素 local 座標在舞台上的像素原點）。box 的舞台像素 = origin + (x,y)。

interface Rect { x: number; y: number; width: number; height: number; }

interface Editable {
  key: string;
  label: string;
  /** local 座標原點在舞台的像素位置（overhead=容器中心；panel=P1 欄左上）。 */
  origin: { x: number; y: number };
  get(): Rect;
  set(r: Partial<Rect>): void;
  /** 是否可改尺寸（badge 用半徑，無 w/h 方框，唯讀尺寸）。 */
  resizable: boolean;
}

// mount 化：stageEl 改延遲賦值（mount 注入 HTML 後才存在），避免 import 當下 $('stage') 找不到而炸。
let stageEl: HTMLElement = document.body;

// ---- 視圖：當前區塊內容置中的編輯畫布 ------------------------------------
//
// 不再把小小的 overhead 塞進 1920×1080 大舞台(會被推到角落)。改成：
// 每個區塊算出「內容邊界矩形 contentRect」，把 #stage 尺寸設成該矩形大小，
// 所有繪製像素位置減掉 contentRect 左上(viewOffset)→ 內容從 (0,0) 填滿 stage；
// stage 由 .stage-wrap flex 置中、transform scale 以 transform-origin:center 繞中心縮放。
// ⚠️ 只影響「呈現像素位置」，元素實際 x/y 資料完全不動(匯出座標不受影響)。

/** 當前區塊的內容邊界矩形（1920×1080 座標系內）。 */
function contentRect(): Rect {
  if (currentSection === 'screen') {
    // 全螢幕：顯示整個 1920×1080 設計畫布（波次訊息以螢幕座標定位）。
    return { x: 0, y: 0, width: layout.design.width, height: layout.design.height };
  }
  if (currentSection === 'overhead') {
    const c = overheadContainerRect();
    const m = 60; // 容器四周留白，讓超出容器的元素(如 combo 在上方)也看得到
    return { x: c.x - m, y: c.y - m, width: c.width + m * 2, height: c.height + m * 2 };
  }
  // panel：4 欄整條的邊界，並涵蓋 P1 欄內元素的外擴（如 platform 在欄上方 y<0）+ 留白
  const first = slotRect(0);
  const last = slotRect(layout.panel.slotCount - 1);
  const m = 40;
  let minX = first.x;
  let minY = first.y;
  let maxX = last.x + last.width;
  let maxY = first.y + first.height;
  const p1Col = layout.panel.columns.find((c) => c.playerIndex === 0);
  if (p1Col) {
    for (const el of p1Col.elements) {
      minX = Math.min(minX, first.x + el.x);
      minY = Math.min(minY, first.y + el.y);
      maxX = Math.max(maxX, first.x + el.x + el.width);
      maxY = Math.max(maxY, first.y + el.y + el.height);
    }
  }
  return { x: minX - m, y: minY - m, width: maxX - minX + m * 2, height: maxY - minY + m * 2 };
}

/** 繪製時要扣掉的偏移（= 內容矩形左上），讓內容從 stage (0,0) 起。 */
function viewOffset(): { x: number; y: number } {
  const c = contentRect();
  return { x: c.x, y: c.y };
}

/** 元素方框在 stage 上的像素左上（已扣 viewOffset）。 */
function boxLeft(ed: Editable, r: Rect, off: { x: number; y: number }): number {
  return ed.origin.x + r.x - off.x;
}
function boxTop(ed: Editable, r: Rect, off: { x: number; y: number }): number {
  return ed.origin.y + r.y - off.y;
}

/** 目前編輯的區塊。三塊座標系不同，一次只顯示一塊（畫面乾淨、專注）。 */
type Section = 'overhead' | 'panel' | 'screen';
let currentSection: Section = 'overhead';
/** 記住各區塊各自的選中元素（切換區塊時還原）。 */
const selectedBySection: Record<Section, string | null> = { overhead: null, panel: null, screen: null };

/**
 * 頭上 UI 容器編輯錨點：置中於舞台（此區塊單獨顯示，放大看清 local 相對位置）。
 * local 座標基準=容器中心；容器 200×80 置中，四周留白供 zoom 放大檢視。
 */
function overheadContainerRect(): Rect {
  const ov = layout.overhead;
  const cx = layout.design.width / 2;
  const cy = layout.design.height / 2;
  return { x: cx - ov.width / 2, y: cy - ov.height / 2, width: ov.width, height: ov.height };
}

/** 頭上容器中心（local 原點）在舞台的像素座標。 */
function overheadOrigin(): { x: number; y: number } {
  const c = overheadContainerRect();
  return { x: c.x + c.width / 2, y: c.y + c.height / 2 };
}

/** 依欄參數算第 i 欄矩形（螢幕座標）。 */
function slotRect(i: number): Rect {
  const p = layout.panel;
  const totalWidth = p.slotCount * p.slotWidth + (p.slotCount - 1) * p.slotGap;
  const startX = (layout.design.width - totalWidth) / 2;
  const y = layout.design.height - p.bottomOffset - p.slotHeight;
  const x = startX + i * (p.slotWidth + p.slotGap);
  return { x, y, width: p.slotWidth, height: p.slotHeight };
}

/** 建立「目前區塊」的可編輯元素清單（一次只一塊）。 */
function buildEditables(): Editable[] {
  if (currentSection === 'overhead') return buildOverheadEditables();
  if (currentSection === 'screen') return buildScreenEditables();
  return buildPanelEditables();
}

/**
 * 由 editable key 解析底層元素物件（HasVisible），供顯示勾選讀寫 visible。
 * 單一入口避免每個 push 都手貼 visible get/set。找不到回 null。
 */
function resolveVisibleTarget(key: string): HasVisible | null {
  if (key.startsWith('screen.')) {
    const s = layout.screen;
    if (!s) return null;
    if (key === 'screen.waveMessage') return s.waveMessage;
    if (key === 'screen.eventMessage') return s.eventMessage ?? null;
    if (key === 'screen.fireRainMessage') return s.fireRainMessage ?? null;
    return null;
  }
  if (key === 'foot.searchRadius') return layout.foot ?? null;
  if (key.startsWith('overhead.')) {
    const ov = layout.overhead as unknown as Record<string, HasVisible>;
    return ov[key.slice('overhead.'.length)] ?? null;
  }
  if (key.startsWith('panel.')) {
    const id = key.slice('panel.'.length);
    const col = layout.panel.columns.find((c) => c.playerIndex === 0);
    return col?.elements.find((e) => e.id === id) ?? null;
  }
  return null;
}

/** 全螢幕區塊：波次/事件/火雨訊息（螢幕座標 origin 0,0）+ 腳下圈 foot（螢幕中心+offset，可調半徑/位置）。 */
function buildScreenEditables(): Editable[] {
  const list: Editable[] = [];
  // screen 為 optional：若缺，補一份預設，讓編輯器可編（匯出時就會帶上）。
  if (!layout.screen) {
    layout.screen = {
      waveMessage: { x: 0, y: 403.6, width: 1920, height: 100, align: 'center' },
      eventMessage: { x: 0, y: 324, width: 1920, height: 92, align: 'center' },
      fireRainMessage: { x: 0, y: 480, width: 1920, height: 92, align: 'center' },
    };
  }
  const s = layout.screen;
  // 三個螢幕級訊息：waveMessage 必有；event/fireRain 若缺補預設（讓用戶可調）。
  if (!s.eventMessage) s.eventMessage = { x: 0, y: 324, width: 1920, height: 92, align: 'center' };
  if (!s.fireRainMessage) s.fireRainMessage = { x: 0, y: 480, width: 1920, height: 92, align: 'center' };
  const msgs: Array<[string, string, ScreenElement]> = [
    ['screen.waveMessage', '波次訊息 waveMessage', s.waveMessage],
    ['screen.eventMessage', '事件/守護波訊息 eventMessage', s.eventMessage],
    ['screen.fireRainMessage', '火雨訊息 fireRainMessage', s.fireRainMessage],
  ];
  for (const [key, label, el] of msgs) {
    list.push({
      key, label, origin: { x: 0, y: 0 }, resizable: true,
      get: () => ({ x: el.x, y: el.y, width: el.width, height: el.height }),
      set: (r) => {
        if (r.x !== undefined) el.x = r.x;
        if (r.y !== undefined) el.y = r.y;
        if (r.width !== undefined) el.width = r.width;
        if (r.height !== undefined) el.height = r.height;
      },
    });
  }
  // 腳下圈（搜索圈=真空帶）：照遊戲畫「2:1 貼地橢圓圓盤」——寬 w=2r×widthScale、高 h=w/2，
  // 中心=footGlowCenter(螢幕中心+offset)。拖=改 offset、縮放(拉寬)=改半徑(r=width/(2×widthScale))。
  if (!layout.foot) layout.foot = { searchRadiusPx: 50, offsetX: 0, offsetY: 75.6 };
  const foot = layout.foot;
  const cx = layout.design.width / 2;
  const cy = layout.design.height / 2;
  list.push({
    key: 'foot.searchRadius', label: '搜索圈/真空帶 foot（半徑+位置）', origin: { x: 0, y: 0 }, resizable: true,
    get: () => {
      const r = foot.searchRadiusPx ?? 50;
      const ox = foot.offsetX ?? 0;
      const oy = foot.offsetY ?? 0;
      const w = r * 2 * PLAYER_DISC_WIDTH_SCALE; // 遊戲圓盤寬
      const h = w / 2; // 2:1 貼地
      return { x: cx + ox - w / 2, y: cy + oy - h / 2, width: w, height: h };
    },
    set: (rc) => {
      // 縮放：以 width 反推半徑（w=2r×widthScale → r=w/(2×widthScale)），維持 2:1。
      if (rc.width !== undefined) {
        foot.searchRadiusPx = Math.max(1, rc.width / (2 * PLAYER_DISC_WIDTH_SCALE));
      }
      const r = foot.searchRadiusPx ?? 50;
      const w = r * 2 * PLAYER_DISC_WIDTH_SCALE;
      const h = w / 2;
      // 拖移：左上角回推中心(box 左上 + w/2, h/2)，減基準螢幕中心 = offset。
      if (rc.x !== undefined) foot.offsetX = rc.x + w / 2 - cx;
      if (rc.y !== undefined) foot.offsetY = rc.y + h / 2 - cy;
    },
  });

  // JP 面板整體大小+位置（用戶：JP UI 太大 → 可縮小/挪位）。additive 附掛 layout.jp。
  // box = 設計 1600×300 × panelScale，中心 = JP 設計中心(960,535)+offset。拖=offset、拉寬=scale。
  const layoutJp = layout as unknown as { jp?: { panelScale?: number; panelOffsetX?: number; panelOffsetY?: number } };
  if (!layoutJp.jp) layoutJp.jp = { panelScale: 1, panelOffsetX: 0, panelOffsetY: 0 };
  const jp = layoutJp.jp;
  list.push({
    key: 'jp.panel', label: 'JP 面板（整體大小+位置）', origin: { x: 0, y: 0 }, resizable: true,
    get: () => {
      const s = jp.panelScale ?? 1;
      const w = JP_DESIGN_W * s;
      const h = JP_DESIGN_H * s;
      const ccx = JP_DESIGN_CX + (jp.panelOffsetX ?? 0);
      const ccy = JP_DESIGN_CY + (jp.panelOffsetY ?? 0);
      return { x: ccx - w / 2, y: ccy - h / 2, width: w, height: h };
    },
    set: (rc) => {
      // 拉寬 → 反推整體 scale（等比，維持 Unity 相對佈局）。
      if (rc.width !== undefined) jp.panelScale = Math.max(0.2, rc.width / JP_DESIGN_W);
      const s = jp.panelScale ?? 1;
      const w = JP_DESIGN_W * s;
      const h = JP_DESIGN_H * s;
      // 拖移 → 左上回推中心 - 設計中心 = offset。
      if (rc.x !== undefined) jp.panelOffsetX = rc.x + w / 2 - JP_DESIGN_CX;
      if (rc.y !== undefined) jp.panelOffsetY = rc.y + h / 2 - JP_DESIGN_CY;
    },
  });

  // 關卡進度條整體大小+位置（用戶：可縮小/挪位，同 JP 範式）。additive 附掛 layout.progress。
  // box = 設計 progress 寬高 × scale，中心 = 進度條設計中心(960,96)+offset。拖=offset、拉寬=scale。
  const layoutPg = layout as unknown as { progress?: { progressScale?: number; progressOffsetX?: number; progressOffsetY?: number } };
  if (!layoutPg.progress) layoutPg.progress = { progressScale: 1, progressOffsetX: 0, progressOffsetY: 0 };
  const pg = layoutPg.progress;
  list.push({
    key: 'progress.bar', label: '關卡進度條（整體大小+位置）', origin: { x: 0, y: 0 }, resizable: true,
    get: () => {
      const s = pg.progressScale ?? 1;
      const w = PROGRESS_DESIGN_W * s;
      const h = PROGRESS_DESIGN_H * s;
      const ccx = PROGRESS_DESIGN_CX + (pg.progressOffsetX ?? 0);
      const ccy = PROGRESS_DESIGN_CY + (pg.progressOffsetY ?? 0);
      return { x: ccx - w / 2, y: ccy - h / 2, width: w, height: h };
    },
    set: (rc) => {
      if (rc.width !== undefined) pg.progressScale = Math.max(0.2, rc.width / PROGRESS_DESIGN_W);
      const s = pg.progressScale ?? 1;
      const w = PROGRESS_DESIGN_W * s;
      const h = PROGRESS_DESIGN_H * s;
      if (rc.x !== undefined) pg.progressOffsetX = rc.x + w / 2 - PROGRESS_DESIGN_CX;
      if (rc.y !== undefined) pg.progressOffsetY = rc.y + h / 2 - PROGRESS_DESIGN_CY;
    },
  });
  return list;
}

/** 進度條設計尺寸/中心（對齊遊戲端 PROGRESS_BAR；編輯器不 import 遊戲模組故內聯）。
 *  寬取「約 4 節點 ×160=640」當可視代表框、高含節點圓+守護金條 ~約 80。中心=(960,96)。 */
const PROGRESS_DESIGN_W = 640;
const PROGRESS_DESIGN_H = 80;
const PROGRESS_DESIGN_CX = 960;
const PROGRESS_DESIGN_CY = 96;

/** JP 面板設計尺寸/中心（對齊遊戲端 JP_PANEL_LAYOUT；編輯器不 import 遊戲模組故內聯）。 */
const JP_DESIGN_W = 1600;
const JP_DESIGN_H = 300;
const JP_DESIGN_CX = 960;
const JP_DESIGN_CY = 535;

/**
 * 沒 credit 投幣提示 override（additive，schema 未定義 → 附掛在 credit.outOfCredit）。
 * 惰性建立預設（對齊遊戲端 uiConfig 打包預設；編輯器不 import 遊戲模組故在此內聯）。
 */
interface OutOfCreditOverride {
  flashColor?: string; blinkMs?: number; hintText?: string; hintColor?: string;
  hintFontSize?: string; hintOffsetX?: number; hintOffsetY?: number; showCountdown?: boolean;
}
const OUT_OF_CREDIT_DEFAULT: Required<OutOfCreditOverride> = {
  flashColor: '#ff3b30', blinkMs: 300, hintText: '投幣 (C)', hintColor: '#ffe14d',
  hintFontSize: '18px', hintOffsetX: 0, hintOffsetY: 26, showCountdown: true,
};
function ensureOutOfCredit(credit: { outOfCredit?: OutOfCreditOverride }): OutOfCreditOverride {
  if (!credit.outOfCredit) credit.outOfCredit = { ...OUT_OF_CREDIT_DEFAULT };
  return credit.outOfCredit;
}

function buildOverheadEditables(): Editable[] {
  const list: Editable[] = [];
  const ov = layout.overhead;
  const oOrigin = overheadOrigin();

  // overhead.credit（有 w/h，可縮放）
  list.push({
    key: 'overhead.credit', label: '點數 credit', origin: oOrigin, resizable: true,
    get: () => ({ x: ov.credit.x, y: ov.credit.y, width: ov.credit.width, height: ov.credit.height }),
    set: (r) => {
      if (r.x !== undefined) ov.credit.x = r.x;
      if (r.y !== undefined) ov.credit.y = r.y;
      if (r.width !== undefined) ov.credit.width = r.width;
      if (r.height !== undefined) ov.credit.height = r.height;
    },
  });

  // overhead.creditHint（沒 credit 投幣提示文字：位置可拖，文字/字級/顏色在 Inspector 調）
  // schema 未定義 outOfCredit（additive，走 override 附掛），這裡惰性建立預設。
  list.push({
    key: 'overhead.creditHint', label: '沒credit投幣提示', origin: oOrigin, resizable: false,
    get: () => {
      const oc = ensureOutOfCredit(ov.credit as { outOfCredit?: OutOfCreditOverride });
      const bx = ov.credit.x + (oc.hintOffsetX ?? 0);
      const by = ov.credit.y + ov.credit.height + (oc.hintOffsetY ?? 26);
      return { x: bx, y: by - 12, width: 96, height: 24 };
    },
    set: (r) => {
      const oc = ensureOutOfCredit(ov.credit as { outOfCredit?: OutOfCreditOverride });
      if (r.x !== undefined) oc.hintOffsetX = r.x - ov.credit.x;
      if (r.y !== undefined) oc.hintOffsetY = r.y + 12 - (ov.credit.y + ov.credit.height);
    },
  });

  // overhead.combo（點狀，用固定小框表示位置，不縮放）
  list.push({
    key: 'overhead.combo', label: '連段 combo', origin: oOrigin, resizable: false,
    get: () => ({ x: ov.combo.x - 30, y: ov.combo.y - 12, width: 60, height: 24 }),
    set: (r) => {
      if (r.x !== undefined) ov.combo.x = r.x + 30;
      if (r.y !== undefined) ov.combo.y = r.y + 12;
    },
  });

  // overhead.badge（同心圓，用外接方框=ringRadius，位置=cx/cy 中心，不縮放）
  list.push({
    key: 'overhead.badge', label: '玩家牌/魂力環 badge', origin: oOrigin, resizable: false,
    get: () => {
      const d = ov.badge.ringRadius * 2;
      return { x: ov.badge.cx - ov.badge.ringRadius, y: ov.badge.cy - ov.badge.ringRadius, width: d, height: d };
    },
    set: (r) => {
      if (r.x !== undefined) ov.badge.cx = r.x + ov.badge.ringRadius;
      if (r.y !== undefined) ov.badge.cy = r.y + ov.badge.ringRadius;
    },
  });

  // overhead.energy（4 格總寬 = cellCount*cellWidth + gaps，起點 x/y，不縮放整塊）
  list.push({
    key: 'overhead.energy', label: '能量格 energy', origin: oOrigin, resizable: false,
    get: () => {
      const e = ov.energy;
      const w = e.cellCount * e.cellWidth + (e.cellCount - 1) * e.cellGap;
      return { x: e.x, y: e.y, width: w, height: e.cellHeight };
    },
    set: (r) => {
      if (r.x !== undefined) ov.energy.x = r.x;
      if (r.y !== undefined) ov.energy.y = r.y;
    },
  });
  return list;
}

function buildPanelEditables(): Editable[] {
  const list: Editable[] = [];
  // panel 元素（第一版單人：編 P1 = columns[playerIndex 0] 的元素，相對 P1 欄左上）
  const p1 = slotRect(0);
  const pOrigin = { x: p1.x, y: p1.y };
  const p1Col = layout.panel.columns.find((c) => c.playerIndex === 0);
  const p1Elements = p1Col ? p1Col.elements : [];
  for (const el of p1Elements) {
    const ref: PanelElement = el;
    list.push({
      key: `panel.${ref.id}`, label: `${panelElLabel(ref.id)}（${ref.id}）`, origin: pOrigin, resizable: true,
      get: () => ({ x: ref.x, y: ref.y, width: ref.width, height: ref.height }),
      set: (r) => {
        if (r.x !== undefined) ref.x = r.x;
        if (r.y !== undefined) ref.y = r.y;
        if (r.width !== undefined) ref.width = r.width;
        if (r.height !== undefined) ref.height = r.height;
      },
    });
  }
  return list;
}

function panelElLabel(id: string): string {
  const map: Record<string, string> = {
    chest: '寶箱', ticket: '彩票', progress: '寶盒進度條', platform: '待機平台',
  };
  return map[id] ?? id;
}

// ---- 渲染舞台 -------------------------------------------------------------

let editables: Editable[] = [];
/** 目前渲染用的視圖偏移（= 內容矩形左上），拖拉/Inspector 更新像素時共用。 */
let currentOffset: { x: number; y: number } = { x: 0, y: 0 };

function setStatus(msg: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  const el = $('status');
  el.textContent = msg;
  el.className = kind === 'ok' ? 'status-ok' : kind === 'err' ? 'status-err' : '';
}

function applyZoom(): void {
  stageEl.style.transform = `scale(${zoom})`;
  $('zoom-val').textContent = `${Math.round(zoom * 100)}%`;
}

function renderStage(): void {
  editables = buildEditables();
  stageEl.innerHTML = '';

  // 把 stage 尺寸設成當前區塊內容矩形大小，內容從 (0,0) 起填滿；由 .stage-wrap 置中。
  const content = contentRect();
  const off = viewOffset();
  currentOffset = off;
  stageEl.style.width = `${content.width}px`;
  stageEl.style.height = `${content.height}px`;

  if (currentSection === 'panel') {
    // 底部 4 欄底框（遊戲樣式：圓角矩形，底 rgba(16,16,36,0.82)/白框；P2~P4 淡化）
    for (let i = 0; i < layout.panel.slotCount; i += 1) {
      const r = slotRect(i);
      const slot = document.createElement('div');
      slot.className = 'panel-slot-bg' + (i === 0 ? '' : ' inactive');
      slot.style.left = `${r.x - off.x}px`;
      slot.style.top = `${r.y - off.y}px`;
      slot.style.width = `${r.width}px`;
      slot.style.height = `${r.height}px`;
      slot.style.borderRadius = `${layout.panel.cornerRadius}px`;
      const lab = document.createElement('div');
      lab.className = 'slot-label';
      lab.textContent = `P${i + 1}${i === 0 ? '' : '（佔位）'}`;
      slot.appendChild(lab);
      stageEl.appendChild(slot);
    }
  } else if (currentSection === 'overhead') {
    // 頭上 UI 容器框（此區塊單獨顯示，置中放大檢視）
    const oc = overheadContainerRect();
    const cont = document.createElement('div');
    cont.id = 'overhead-container';
    cont.style.left = `${oc.x - off.x}px`;
    cont.style.top = `${oc.y - off.y}px`;
    cont.style.width = `${oc.width}px`;
    cont.style.height = `${oc.height}px`;
    const clab = document.createElement('div');
    clab.className = 'slot-label';
    clab.textContent = '頭上 UI 容器（跟隨玩家，local 相對中心）';
    cont.appendChild(clab);
    stageEl.appendChild(cont);
  }
  // screen 區塊：整個 1920×1080 畫布當背景（stage 本身即設計畫布）。
  // 腳下圈（foot）需角色參照才調得準 → 在畫布中心畫一個角色示意 sprite，搜索圈疊在其腳下。
  if (currentSection === 'screen') {
    renderCharacterReference(off);
  }

  // 各元素方框（聚焦模式）：只有「選中」那一個高亮 + 可拖拉/縮放；
  // 其餘半透明背景參考（不可拖，點一下=切換選中）。
  for (const ed of editables) {
    const r = ed.get();
    const isSel = ed.key === selectedKey;
    const box = document.createElement('div');
    box.className = 'ui-box' + (isSel ? ' selected' : ' dimmed');
    box.dataset.key = ed.key;
    box.style.left = `${boxLeft(ed, r, off)}px`;
    box.style.top = `${boxTop(ed, r, off)}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    box.title = ed.label;
    // 隱藏元素（visible=false，用戶 #6）：畫半透明 + 虛線 + 「隱藏」標籤，設計師看得到位置但知遊戲不顯示。
    const vt = resolveVisibleTarget(ed.key);
    const hidden = vt ? !isVisible(vt) : false;
    if (hidden) {
      box.style.opacity = '0.4';
      box.style.outline = '2px dashed #ff8f6c';
      const tag = document.createElement('div');
      tag.textContent = '隱藏';
      tag.style.cssText =
        'position:absolute;top:-2px;right:-2px;background:#ff8f6c;color:#1a1030;' +
        'font-size:11px;font-weight:bold;padding:1px 5px;border-radius:6px;z-index:2;pointer-events:none;';
      box.appendChild(tag);
    }
    const visual = document.createElement('div');
    visual.className = 'ui-visual';
    visual.appendChild(buildVisual(ed.key));
    box.appendChild(visual);
    if (isSel) {
      // 選中：可拖拉、可縮放（顯示 handle）。
      attachDrag(box, ed);
      if (ed.resizable) attachResize(box, ed);
    } else {
      // 未選中：只可點選切換，不拖動（避免誤拖擠在一起的元素）。
      box.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        selectedKey = ed.key;
        selectedBySection[currentSection] = ed.key;
        renderStage(); // 切換選中：重繪讓新選中的掛上拖拉、舊的變 dimmed
      });
    }
    stageEl.appendChild(box);
  }

  // P2~P4 佔位欄：只在 panel 區塊顯示（淡化複製 P1 template icon，防漂移）。
  if (currentSection === 'panel') renderPlaceholderColumns(off);

  renderTree();
  renderInspector();
}

// ---- 視覺（真 icon + 遊戲樣式）--------------------------------------------

/** icon 路徑：編輯器在 /ui-editor/，素材在網站根 assets/images/ui/。 */
function iconUrl(name: string): string {
  return `../assets/images/ui/${name}.png`;
}

/** 建一個 <img>，載入失敗退場成標籤色塊（本機無素材/缺圖也能用）。 */
function iconImg(name: string, label: string): HTMLElement {
  const img = document.createElement('img');
  img.src = iconUrl(name);
  img.alt = label;
  img.addEventListener('error', () => {
    const fb = document.createElement('div');
    fb.className = 'icon-fallback';
    fb.textContent = label;
    img.replaceWith(fb);
  });
  return img;
}

/** 依元素 key 建視覺內容（對照 uiConfig 樣式值）。 */
function buildVisual(key: string): HTMLElement {
  switch (key) {
    case 'screen.waveMessage':
      return buildMessageBanner('第 1 波', layout.screen?.waveMessage.align);
    case 'screen.eventMessage':
      return buildMessageBanner('守護目標出現！', layout.screen?.eventMessage?.align);
    case 'screen.fireRainMessage':
      return buildMessageBanner('天降火雨！', layout.screen?.fireRainMessage?.align);
    case 'foot.searchRadius':
      return buildFootCircle();
    case 'panel.platform':
      return iconImg('platform', '待機平台');
    case 'panel.chest':
      return iconImg('chest', '寶箱');
    case 'overhead.credit':
      return buildIconWithNumber(key);
    case 'panel.ticket':
      return buildTicket();
    case 'panel.progress':
      return buildProgressBar();
    case 'overhead.badge':
      return buildBadge();
    case 'overhead.energy':
      return buildEnergyCells();
    case 'overhead.combo':
      return buildCombo();
    default: {
      const d = document.createElement('div');
      d.className = 'icon-fallback';
      d.textContent = key;
      return d;
    }
  }
}

/** Credit（頭上點數）：點數 icon + 數字（白）。注意這是「點數」HUD，非已移除的面板金幣。 */
/** 頭上點數 credit：只顯示數字（用戶第七輪 #12：拿掉沒用的金幣 icon，保留點數數字）。 */
function buildIconWithNumber(_key: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;width:100%;height:100%;';
  const num = document.createElement('span');
  num.textContent = '1234';
  num.style.cssText = 'color:#fff;font-size:22px;font-weight:bold;white-space:nowrap;';
  wrap.appendChild(num);
  return wrap;
}

/** 彩票：ticket icon + 數字（30px 白粗體，放右）。 */
function buildTicket(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%;height:100%;';
  const t = iconImg('ticket', '彩票');
  t.style.cssText = 'width:auto;height:100%;object-fit:contain;';
  const num = document.createElement('span');
  num.textContent = '8';
  num.style.cssText = 'color:#fff;font-size:30px;font-weight:bold;';
  wrap.appendChild(t);
  wrap.appendChild(num);
  return wrap;
}

/** 進度條：圓角條，底 #2a2a3a、填 #4caf50 綠半滿。 */
function buildProgressBar(): HTMLElement {
  const bar = document.createElement('div');
  bar.style.cssText =
    'width:100%;height:100%;background:#2a2a3a;border-radius:6px;overflow:hidden;';
  const fill = document.createElement('div');
  fill.style.cssText = 'width:50%;height:100%;background:#4caf50;border-radius:6px;';
  bar.appendChild(fill);
  return bar;
}

/** 魂力環：ring.png 底環 + 中心 P 牌（藍底白字）+ 紫弧示意。 */
function buildBadge(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:100%;height:100%;';
  const ring = iconImg('ring', '魂力環');
  ring.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;';
  wrap.appendChild(ring);
  // 紫弧（用 conic-gradient 半圈示意 #ba68c8）
  const arc = document.createElement('div');
  arc.style.cssText =
    'position:absolute;inset:8%;border-radius:50%;background:conic-gradient(#ba68c8 0deg 200deg, transparent 200deg 360deg);opacity:0.85;-webkit-mask:radial-gradient(circle, transparent 62%, #000 64%);mask:radial-gradient(circle, transparent 62%, #000 64%);';
  wrap.appendChild(arc);
  // 中心 P 牌
  const pnum = document.createElement('div');
  pnum.textContent = layout.overhead.badge.text || 'P1';
  pnum.style.cssText =
    'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:56%;height:56%;border-radius:50%;background:#2196f3;color:#fff;font-weight:bold;font-size:14px;display:flex;align-items:center;justify-content:center;';
  wrap.appendChild(pnum);
  return wrap;
}

/** 能量：4 小方格（16×16 gap6 圓角3，金 #ffd54f / 暗 #3a3a5a）。 */
function buildEnergyCells(): HTMLElement {
  const e = layout.overhead.energy;
  const wrap = document.createElement('div');
  wrap.style.cssText = `display:flex;gap:${e.cellGap}px;align-items:center;height:100%;`;
  for (let i = 0; i < e.cellCount; i += 1) {
    const cell = document.createElement('div');
    const filled = i < 2; // 示意半滿
    cell.style.cssText =
      `width:${e.cellWidth}px;height:${e.cellHeight}px;border-radius:${e.cornerRadius}px;` +
      `background:${filled ? '#ffd54f' : '#3a3a5a'};`;
    wrap.appendChild(cell);
  }
  return wrap;
}

/** COMBO：文字 "12 HIT"（24px 橘 #ffb300）。 */
function buildCombo(): HTMLElement {
  const t = document.createElement('div');
  t.textContent = `12${layout.overhead.combo.suffix || ' HIT'}`;
  t.style.cssText =
    'color:#ffb300;font-size:24px;font-weight:bold;white-space:nowrap;display:flex;align-items:center;height:100%;';
  return t;
}

/** 螢幕級訊息橫幅（示意：半透明底 + 置中大字，對齊依 align）。 */
function buildMessageBanner(sampleText: string, align?: 'left' | 'center' | 'right'): HTMLElement {
  const a = align ?? 'center';
  const justify = a === 'left' ? 'flex-start' : a === 'right' ? 'flex-end' : 'center';
  const box = document.createElement('div');
  box.style.cssText =
    `width:100%;height:100%;display:flex;align-items:center;justify-content:${justify};` +
    'background:rgba(20,20,40,0.55);border:1px dashed rgba(255,255,255,0.5);border-radius:8px;padding:0 12px;';
  const t = document.createElement('div');
  t.textContent = sampleText;
  t.style.cssText = 'color:#fff;font-size:40px;font-weight:bold;text-shadow:0 2px 6px rgba(0,0,0,0.6);white-space:nowrap;';
  box.appendChild(t);
  return box;
}

/** 腳下圈（搜索圈/真空帶）示意：照遊戲畫「2:1 貼地橢圓發光圓盤」（box 已是 w×h=2:1，border-radius:50% 即橢圓）。 */
function buildFootCircle(): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText =
    'width:100%;height:100%;border-radius:50%;box-sizing:border-box;' +
    // 貼地發光圓盤：徑向漸層(中心亮外緣淡)+玩家色描邊，模擬 fx_player_disc。
    'border:3px solid rgba(80,180,255,0.9);' +
    'background:radial-gradient(ellipse at center, rgba(80,180,255,0.35) 0%, rgba(80,180,255,0.12) 60%, rgba(80,180,255,0.02) 100%);' +
    'display:flex;align-items:center;justify-content:center;';
  const t = document.createElement('div');
  t.textContent = '搜索圈/真空帶';
  t.style.cssText = 'color:#cfefff;font-size:14px;font-weight:bold;text-shadow:0 1px 3px rgba(0,0,0,0.7);white-space:nowrap;';
  box.appendChild(t);
  return box;
}

/**
 * 角色參照（腳下圈編輯用，用戶 UX 修正）：在設計畫布中心畫一個角色 idle sprite，
 * 尺寸=REF_SPRITE_SIZE(遊戲實際顯示大小)，讓搜索圈相對角色有真實尺度。
 * 錨點 = 設計畫布中心 (cx,cy)——與 foot editable 的 get() 同錨；圈中心 = (cx+offsetX, cy+offsetY)，
 * offsetY≈75.6 → 圈落在角色腳下。sprite 不可互動(pointer-events:none)、z-index 墊底,只當參照。
 * sprite 載不到 → onerror 退成半透明佔位人形輪廓(重點是有個「人」給尺度)。
 */
function renderCharacterReference(off: { x: number; y: number }): void {
  const cx = layout.design.width / 2;
  const cy = layout.design.height / 2;
  const left = cx - REF_SPRITE_SIZE / 2 - off.x;
  const top = cy - REF_SPRITE_SIZE / 2 - off.y;

  const wrap = document.createElement('div');
  wrap.id = 'char-ref';
  wrap.style.cssText =
    `position:absolute;left:${left}px;top:${top}px;` +
    `width:${REF_SPRITE_SIZE}px;height:${REF_SPRITE_SIZE}px;z-index:0;pointer-events:none;`;

  const img = document.createElement('img');
  img.src = REF_SPRITE_URL;
  img.alt = '角色參照';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;opacity:0.85;';
  img.addEventListener('error', () => {
    // 載不到 → 佔位人形（簡單輪廓），確保永遠有尺度參照。
    img.remove();
    const ph = document.createElement('div');
    ph.textContent = '🧍';
    ph.style.cssText =
      'width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
      `font-size:${Math.round(REF_SPRITE_SIZE * 0.8)}px;opacity:0.5;`;
    wrap.appendChild(ph);
  });
  wrap.appendChild(img);

  // 腳底基準點標記（圈中心錨=角色腳底 cy+offsetY）——畫一個小十字讓用戶對齊。
  const footY = cy + (layout.foot?.offsetY ?? 0);
  const footX = cx + (layout.foot?.offsetX ?? 0);
  const mark = document.createElement('div');
  mark.style.cssText =
    `position:absolute;left:${footX - off.x - 5}px;top:${footY - off.y - 5}px;` +
    'width:10px;height:10px;z-index:1;pointer-events:none;' +
    'border-left:2px solid rgba(255,255,255,0.7);border-top:2px solid rgba(255,255,255,0.7);' +
    'transform:rotate(45deg);';
  mark.title = '角色腳底（搜索圈中心基準）';

  const label = document.createElement('div');
  label.textContent = '角色參照（搜索圈疊腳下，可拖圈調位置/縮圈調大小）';
  label.style.cssText =
    `position:absolute;left:${left}px;top:${top - 20}px;z-index:1;pointer-events:none;` +
    'color:#cfefff;font-size:13px;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,0.8);';

  stageEl.appendChild(wrap);
  stageEl.appendChild(mark);
  stageEl.appendChild(label);
}

/** P2~P4 佔位欄：alpha 0.4 複製 P1 欄底框 + P1 template 元素 icon（唯讀，不可拖）。 */
function renderPlaceholderColumns(off: { x: number; y: number }): void {
  const p1Col = layout.panel.columns.find((c) => c.playerIndex === 0);
  const p1Elements = p1Col ? p1Col.elements : [];
  for (let i = 1; i < layout.panel.slotCount; i += 1) {
    const slot = slotRect(i);
    for (const el of p1Elements) {
      const box = document.createElement('div');
      box.style.cssText =
        `position:absolute;pointer-events:none;opacity:0.4;` +
        `left:${slot.x + el.x - off.x}px;top:${slot.y + el.y - off.y}px;width:${el.width}px;height:${el.height}px;`;
      const visual = document.createElement('div');
      visual.className = 'ui-visual';
      visual.appendChild(buildVisual(`panel.${el.id}`));
      box.appendChild(visual);
      stageEl.appendChild(box);
    }
  }
}

// ---- 拖拉 / 縮放 ----------------------------------------------------------

/** 把滑鼠位移（螢幕像素）換算成舞台座標位移（除以 zoom）。 */
function toStageDelta(dxScreen: number, dyScreen: number): { dx: number; dy: number } {
  return { dx: dxScreen / zoom, dy: dyScreen / zoom };
}

function attachDrag(box: HTMLDivElement, ed: Editable): void {
  box.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).classList.contains('resize-handle')) return;
    e.preventDefault();
    selectedKey = ed.key;
    renderSelectionOnly();
    beginEdit(); // 記手勢開始前的快照
    const startX = e.clientX;
    const startY = e.clientY;
    const start = ed.get();
    box.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent): void => {
      const { dx, dy } = toStageDelta(ev.clientX - startX, ev.clientY - startY);
      ed.set({ x: Math.round(start.x + dx), y: Math.round(start.y + dy) });
      const r = ed.get();
      box.style.left = `${boxLeft(ed, r, currentOffset)}px`;
      box.style.top = `${boxTop(ed, r, currentOffset)}px`;
      updateInspectorFields(ed);
    };
    const onUp = (ev: PointerEvent): void => {
      box.releasePointerCapture(ev.pointerId);
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerup', onUp);
      commitEdit(); // 放開才記一步
      renderStage(); // 重繪（欄座標可能連動）
    };
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerup', onUp);
  });
}

function attachResize(box: HTMLDivElement, ed: Editable): void {
  const handle = document.createElement('div');
  handle.className = 'resize-handle';
  box.appendChild(handle);
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    selectedKey = ed.key;
    renderSelectionOnly();
    beginEdit(); // 記手勢開始前的快照
    const startX = e.clientX;
    const startY = e.clientY;
    const start = ed.get();
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent): void => {
      const { dx, dy } = toStageDelta(ev.clientX - startX, ev.clientY - startY);
      ed.set({
        width: Math.max(4, Math.round(start.width + dx)),
        height: Math.max(4, Math.round(start.height + dy)),
      });
      const r = ed.get();
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      updateInspectorFields(ed);
    };
    const onUp = (ev: PointerEvent): void => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      commitEdit(); // 放開才記一步
      renderStage();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

/** 只更新選取樣式（拖拉開始時輕量套用，不整頁重繪）。 */
function renderSelectionOnly(): void {
  stageEl.querySelectorAll<HTMLDivElement>('.ui-box').forEach((b) => {
    b.classList.toggle('selected', b.dataset.key === selectedKey);
  });
  renderTree();
  renderInspector();
}

// ---- 元素樹 / Inspector ---------------------------------------------------

function renderTree(): void {
  const tree = $('tree');
  tree.innerHTML = '';
  // 只列目前區塊的元素（一次一塊）。
  const groupName = currentSection === 'overhead' ? '頭上 UI'
    : currentSection === 'screen' ? '全螢幕 UI'
    : '底部面板（P1）';
  const gl = document.createElement('div');
  gl.className = 'tree-group';
  gl.textContent = groupName;
  tree.appendChild(gl);
  for (const ed of editables) {
    const item = document.createElement('div');
    item.className = 'tree-item' + (ed.key === selectedKey ? ' selected' : '');
    // 顯示勾選框（用戶 #6）：一眼看哪些開/關，勾/取消即時套用。
    const vt = resolveVisibleTarget(ed.key);
    if (vt) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isVisible(vt);
      cb.title = '顯示 / 隱藏';
      cb.style.cssText = 'margin-right:6px;vertical-align:middle;';
      cb.addEventListener('click', (e) => e.stopPropagation()); // 勾選不觸發選取
      cb.addEventListener('change', () => {
        beginEdit();
        vt.visible = cb.checked;
        commitEdit();
        renderStage();
      });
      item.appendChild(cb);
    }
    const labelSpan = document.createElement('span');
    labelSpan.textContent = ed.label;
    if (vt && !isVisible(vt)) labelSpan.style.opacity = '0.5'; // 隱藏元素標籤淡化
    item.appendChild(labelSpan);
    item.addEventListener('click', () => {
      selectedKey = ed.key;
      selectedBySection[currentSection] = ed.key;
      renderStage(); // 聚焦模式：切換選中要重掛拖拉到新元素、舊的變 dimmed
    });
    tree.appendChild(item);
  }
}

function currentEditable(): Editable | undefined {
  return editables.find((e) => e.key === selectedKey);
}

function renderInspector(): void {
  const insp = $('inspector');
  insp.innerHTML = '';
  const ed = currentEditable();
  if (!ed) {
    insp.innerHTML = '<div class="hint">在畫面點選一個 UI 元素以編輯座標/尺寸。</div>';
    return;
  }
  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = ed.label;
  insp.appendChild(title);

  // 顯示開關（用戶 #6）：勾=顯示、不勾=隱藏（visible=false）。
  const vt = resolveVisibleTarget(ed.key);
  if (vt) {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = '顯示 visible';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isVisible(vt);
    cb.addEventListener('change', () => {
      beginEdit();
      // 勾=顯示（存 true）、不勾=隱藏（存 false）。
      vt.visible = cb.checked;
      commitEdit();
      renderStage();
    });
    row.appendChild(lab);
    row.appendChild(cb);
    insp.appendChild(row);
  }

  const r = ed.get();
  insp.appendChild(numRow(ed, 'x', 'X（local）', r.x));
  insp.appendChild(numRow(ed, 'y', 'Y（local）', r.y));
  if (ed.resizable) {
    insp.appendChild(numRow(ed, 'width', '寬 width', r.width));
    insp.appendChild(numRow(ed, 'height', '高 height', r.height));
  } else {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = '此元素尺寸由專屬參數（半徑/格數等）決定，這裡只調位置；細部尺寸請在 JSON 或請界騎調。';
    insp.appendChild(hint);
  }

  // 沒 credit 投幣提示：額外開放文字/字級/顏色可調（override）。
  if (ed.key === 'overhead.creditHint') {
    const oc = ensureOutOfCredit(
      (layout.overhead.credit as unknown) as { outOfCredit?: OutOfCreditOverride },
    );
    insp.appendChild(strRow('提示文字', oc.hintText ?? OUT_OF_CREDIT_DEFAULT.hintText, (v) => { oc.hintText = v; }));
    insp.appendChild(strRow('字級 fontSize', oc.hintFontSize ?? OUT_OF_CREDIT_DEFAULT.hintFontSize, (v) => { oc.hintFontSize = v; }));
    insp.appendChild(strRow('文字色 hintColor', oc.hintColor ?? OUT_OF_CREDIT_DEFAULT.hintColor, (v) => { oc.hintColor = v; }));
    insp.appendChild(strRow('閃紅色 flashColor', oc.flashColor ?? OUT_OF_CREDIT_DEFAULT.flashColor, (v) => { oc.flashColor = v; }));
    insp.appendChild(numStrRow('閃爍週期 blinkMs', oc.blinkMs ?? OUT_OF_CREDIT_DEFAULT.blinkMs, (v) => { oc.blinkMs = v; }));
    const noteHint = document.createElement('div');
    noteHint.className = 'hint';
    noteHint.textContent = '文字/字級/顏色/位置皆可調；匯出 uiLayout.json 套用到遊戲。';
    insp.appendChild(noteHint);
  }

  // COMBO 文字：額外開放字級可調（override，additive 附掛 combo.fontSize）。
  if (ed.key === 'overhead.combo') {
    const c = layout.overhead.combo as unknown as { fontSize?: string };
    insp.appendChild(strRow('字級 fontSize', c.fontSize ?? COMBO_FONT_SIZE_DEFAULT, (v) => { c.fontSize = v; }));
    const noteHint = document.createElement('div');
    noteHint.className = 'hint';
    noteHint.textContent = 'COMBO 字級可調（如 24px/48px）；階層色/跳動保留，匯出套用到遊戲。';
    insp.appendChild(noteHint);
  }
}

/** COMBO 文字字級預設（對齊遊戲端 uiConfig combo.fontSize；編輯器不 import 遊戲模組故內聯）。 */
const COMBO_FONT_SIZE_DEFAULT = '24px';

/** 字串欄位 Inspector row（文字內容/字級/顏色）。 */
function strRow(label: string, value: string, onChange: (v: string) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('focus', () => beginEdit());
  input.addEventListener('change', () => { commitEdit(); renderStage(); });
  input.addEventListener('input', () => { onChange(input.value); });
  row.appendChild(lab);
  row.appendChild(input);
  return row;
}

/** 數字（存 number）Inspector row，供 blinkMs 等非座標數值。 */
function numStrRow(label: string, value: number, onChange: (v: number) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.value = String(value);
  input.addEventListener('focus', () => beginEdit());
  input.addEventListener('change', () => { commitEdit(); renderStage(); });
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  row.appendChild(lab);
  row.appendChild(input);
  return row;
}

function numRow(ed: Editable, field: keyof Rect, label: string, value: number): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any'; // 支援小數（用戶要求可輸入小數點）
  input.value = String(value);
  input.dataset.field = field;
  // 聚焦時記快照，變更提交（change=blur/Enter）時入棧一步，避免逐字記歷史。
  input.addEventListener('focus', () => beginEdit());
  input.addEventListener('change', () => commitEdit());
  input.addEventListener('input', () => {
    const v = parseFloat(input.value); // parseFloat 支援小數
    if (!Number.isFinite(v)) return;
    // 保留小數但避免浮點雜訊：四捨五入到小數 2 位。
    const rounded = Math.round(v * 100) / 100;
    ed.set({ [field]: rounded } as Partial<Rect>);
    // 只移動對應方框，不整頁重繪（避免 input 失焦）。
    const box = stageEl.querySelector<HTMLDivElement>(`.ui-box[data-key="${ed.key}"]`);
    if (box) {
      const cur = ed.get();
      box.style.left = `${boxLeft(ed, cur, currentOffset)}px`;
      box.style.top = `${boxTop(ed, cur, currentOffset)}px`;
      box.style.width = `${cur.width}px`;
      box.style.height = `${cur.height}px`;
    }
  });
  row.appendChild(lab);
  row.appendChild(input);
  return row;
}

/** 拖拉中同步 Inspector 數值欄（若正顯示同一元素）。 */
function updateInspectorFields(ed: Editable): void {
  if (selectedKey !== ed.key) return;
  const r = ed.get();
  const insp = $('inspector');
  const set = (f: string, val: number): void => {
    const input = insp.querySelector<HTMLInputElement>(`input[data-field="${f}"]`);
    if (input && document.activeElement !== input) input.value = String(val);
  };
  set('x', r.x); set('y', r.y); set('width', r.width); set('height', r.height);
}

// ---- 載入 / 匯出 / 重設 ---------------------------------------------------

function loadIntoState(file: UiLayoutFile, recordHistory = false): void {
  if (recordHistory) pushHistory(); // 讓載入/重設可被 Undo 還原
  layout = file;
  selectedKey = null;
  renderStage();
  selectFirstIfNone();
}

/** 聚焦模式：若目前沒有選中元素，預設選第一個（讓一進來就有可編輯的 active 元素）。 */
function selectFirstIfNone(): void {
  if (selectedKey === null && editables.length > 0) {
    selectedKey = editables[0].key;
    selectedBySection[currentSection] = selectedKey;
    renderStage();
  }
}

/** 切換編輯區塊（頭上 UI / 下方面板）：一次只顯示一塊，還原該塊上次的選中。 */
function switchSection(section: Section): void {
  if (section === currentSection) return;
  currentSection = section;
  selectedKey = selectedBySection[section]; // 還原該塊上次選中（可能為 null）
  // 更新 tab 樣式。
  const tOv = editorRoot.querySelector('#tab-overhead');
  const tPn = editorRoot.querySelector('#tab-panel');
  const tSc = editorRoot.querySelector('#tab-screen');
  if (tOv) tOv.classList.toggle('active', section === 'overhead');
  if (tPn) tPn.classList.toggle('active', section === 'panel');
  if (tSc) tSc.classList.toggle('active', section === 'screen');
  // 各塊預設 zoom：頭上塊小(200%)、面板(45%)、全螢幕看整個 1920×1080(30%)。同步滑桿。
  zoom = section === 'overhead' ? 2.0 : section === 'screen' ? 0.3 : 0.45;
  const zoomInput = editorRoot.querySelector('#zoom') as HTMLInputElement | null;
  if (zoomInput) zoomInput.value = String(Math.round(zoom * 100));
  applyZoom();
  renderStage();
  selectFirstIfNone();
  const msg = section === 'overhead' ? '編輯：頭上 UI（跟隨玩家）。'
    : section === 'screen' ? '編輯：全螢幕 UI（波次訊息）。'
    : '編輯：下方面板（P1）。';
  setStatus(msg, 'info');
}

async function loadDefault(): Promise<void> {
  const url = '../assets/data/uiLayout.json'; // 編輯器在 /ui-editor/，資料在網站根 assets/data/
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw: unknown = await res.json();
    loadIntoState(assertValidUiLayout(raw), true);
    setStatus(`已載入預設 ${url}。`, 'ok');
  } catch (e) {
    setStatus(`載入預設失敗：${(e as Error).message}`, 'err');
  }
}

/**
 * 開啟載入（匯入回顯）：優先讀 localStorage 已套用的 override 回填，讓使用者重開看到「當前生效那份」繼續編；
 * 無/壞 override → 打包預設（不炸）。不進 undo（當前套用值即初始狀態）。
 */
function initLoad(): void {
  const raw = loadOverride(EDITOR_STORE_KEYS.uiLayout);
  if (raw !== null) {
    const r = validateUiLayout(raw);
    if (r.ok) {
      loadIntoState(r.data, false);
      setStatus('已載入你上次套用到遊戲的 UI 設定（可繼續編）。', 'ok');
      return;
    }
    setStatus('已套用的 UI 設定驗證失敗，退回打包預設。', 'err');
  }
  renderStage();
  selectFirstIfNone();
}

function loadFromFile(text: string, fileName: string): void {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    setStatus(`檔案 ${fileName} 不是合法 JSON：${(e as Error).message}`, 'err');
    return;
  }
  const result = validateUiLayout(raw);
  if (!result.ok) {
    setStatus(`檔案 ${fileName} 驗證失敗（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return;
  }
  loadIntoState(result.data, true);
  // 上傳即生效（用戶心智）：載入編輯器 + 同時套用到遊戲（存 localStorage）。
  const applied = applyToGame(EDITOR_STORE_KEYS.uiLayout, result.data);
  setStatus(
    applied ? `已載入 ${fileName} 並套用到遊戲（重開仍在）。` : `已載入 ${fileName}（套用失敗：localStorage 不可用）。`,
    applied ? 'ok' : 'err',
  );
}

function exportJson(): void {
  const result = validateUiLayout(layout);
  if (!result.ok) {
    setStatus(`匯出被擋下：資料不合法（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return;
  }
  const validated = assertValidUiLayout(layout);
  const text = JSON.stringify(validated, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'uiLayout.json';
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus('驗證通過，已下載 uiLayout.json。', 'ok');
}

function resetDefault(): void {
  loadIntoState(cloneLayout(DEFAULT_UI_LAYOUT), true);
  setStatus('已重設為預設值。', 'info');
}

/** 套用到遊戲（匯入機制）：validate 過才存 localStorage，遊戲啟動優先讀。回傳是否成功。 */
function applyToGameFromEditor(): boolean {
  const result = validateUiLayout(layout);
  if (!result.ok) {
    setStatus(`套用被擋下：資料不合法（${result.errors.length} 項）：\n${result.errors.map((m) => `  - ${m}`).join('\n')}`, 'err');
    return false;
  }
  const ok = applyToGame(EDITOR_STORE_KEYS.uiLayout, assertValidUiLayout(layout));
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
  clearOverride(EDITOR_STORE_KEYS.uiLayout);
  setStatus('已清除套用，遊戲將回到打包預設 UI。', 'info');
}

// ---- 綁定 -----------------------------------------------------------------

function bindUI(): void {
  $('schema-version').textContent = `schema v${UI_LAYOUT_SCHEMA_VERSION}`;
  $('tab-overhead').addEventListener('click', () => switchSection('overhead'));
  $('tab-panel').addEventListener('click', () => switchSection('panel'));
  $('tab-screen').addEventListener('click', () => switchSection('screen'));
  $('btn-load-default').addEventListener('click', () => void loadDefault());
  $('btn-export').addEventListener('click', exportJson);
  $('btn-reset').addEventListener('click', resetDefault);
  $('btn-apply').addEventListener('click', applyToGameFromEditor);
  $('btn-apply-return').addEventListener('click', applyAndReturnToGame);
  $('btn-clear-apply').addEventListener('click', clearAppliedFromEditor);

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

  const zoomInput = $<HTMLInputElement>('zoom');
  zoomInput.addEventListener('input', () => {
    zoom = Number(zoomInput.value) / 100;
    applyZoom();
  });

  // Undo/Redo：按鈕 + 鍵盤。
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);
  window.addEventListener('keydown', keydownHandler);
  updateHistoryButtons();
}

/** 快捷鍵處理（Ctrl+Z/Y）：具名 handler 供 unmount 移除（overlay 收合不殘留全域監聽）。 */
function keydownHandler(e: KeyboardEvent): void {
  // 若正在數值輸入框打字，讓瀏覽器/欄位自己處理（不攔）。
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const ctrl = e.ctrlKey || e.metaKey; // 支援 Cmd（Mac）
  if (!ctrl) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault();
    redo();
  }
}

// ---- mount 化（方案 A' 遊戲內展開 + 獨立頁並存） -------------------------

/** 編輯器 body HTML（從 ui-editor/index.html <body> 搬來，去 <script>）。 */
const EDITOR_BODY_HTML = `
<header>
  <h1>UI 位置編輯器</h1>
  <span class="badge" id="schema-version"></span>
  <span class="tab-group">
    <button id="tab-overhead" class="tab active">頭上 UI</button>
    <button id="tab-panel" class="tab">下方面板</button>
    <button id="tab-screen" class="tab">全螢幕</button>
  </span>
  <div class="row" style="margin:0; gap:6px;">
    <label style="width:auto;color:var(--muted)">縮放</label>
    <input id="zoom" type="range" min="20" max="300" value="200" style="width:120px" />
    <span id="zoom-val" class="badge"></span>
  </div>
  <div class="spacer"></div>
  <button id="btn-undo" title="復原 (Ctrl+Z)" disabled>↶ 復原</button>
  <button id="btn-redo" title="重做 (Ctrl+Y)" disabled>↷ 重做</button>
  <button id="btn-load-default">載入預設</button>
  <button id="btn-load-file">載入 JSON 檔…</button>
  <input id="file-input" type="file" accept="application/json,.json" hidden />
  <button id="btn-reset">重設為預設值</button>
  <button id="btn-export" class="primary">驗證並下載 JSON</button>
  <button id="btn-apply" class="primary" title="套用到遊戲（存瀏覽器，重開遊戲生效）">套用到遊戲</button>
  <button id="btn-apply-return" class="primary" title="套用並立即返回遊戲">套用並回到遊戲</button>
  <button id="btn-clear-apply" title="清除套用，遊戲回打包預設">清除套用</button>
</header>
<div class="layout">
  <div class="stage-wrap">
    <div id="stage"></div>
  </div>
  <div class="col-inspector">
    <div class="section-title">元素</div>
    <div id="tree"></div>
    <div class="section-title">Inspector</div>
    <div id="inspector"><div class="hint">在畫面點選一個 UI 元素以編輯座標/尺寸。</div></div>
  </div>
</div>
<div id="status">就緒。拖拉畫面上的方框調整位置，拖右下角把手改大小；右側可微調數值。</div>
`;

/** 編輯器樣式（從 index.html <style> 搬來，全部命名空間在 .tb-editor-root 下）。 */
const EDITOR_CSS = `
.tb-editor-root {
  --bg: #1a1a2e; --panel: #23233a; --panel2: #2c2c48; --line: #3a3a5c;
  --text: #e6e6f0; --muted: #9a9ab5; --accent: #6c8cff; --danger: #ff6c7a; --ok: #59d98e;
  --stage: #10101c; --box: rgba(108,140,255,0.18); --box-line: #6c8cff;
  --box-sel: rgba(89,217,142,0.22); --box-sel-line: #59d98e;
  display: flex; flex-direction: column; height: 100%;
  background: var(--bg); color: var(--text);
  font-family: Arial, "Microsoft JhengHei", sans-serif; font-size: 14px;
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
.tb-editor-root button:disabled { opacity: 0.4; cursor: not-allowed; }
.tb-editor-root .tab-group { display: inline-flex; gap: 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.tb-editor-root .tab { border: 0; border-radius: 0; background: var(--panel2); padding: 6px 14px; }
.tb-editor-root .tab.active { background: var(--accent); color: #fff; }
.tb-editor-root .tab:hover { border-color: transparent; }
.tb-editor-root button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.tb-editor-root .layout { display: flex; flex: 1; min-height: 0; }
.tb-editor-root .stage-wrap { flex: 1; overflow: auto; padding: 20px; display: flex; align-items: center; justify-content: center; background: #14141f; }
.tb-editor-root #stage { position: relative; margin: auto; background: var(--stage); transform-origin: center center; outline: 1px solid var(--line); flex: 0 0 auto; }
.tb-editor-root .slot { position: absolute; border: 1px dashed var(--line); background: rgba(255,255,255,0.02); }
.tb-editor-root .slot.inactive { opacity: 0.4; }
.tb-editor-root .slot-label { position: absolute; top: 4px; left: 6px; font-size: 12px; color: var(--muted); }
.tb-editor-root #overhead-container { position: absolute; border: 1px dashed var(--accent); }
.tb-editor-root .ui-box { position: absolute; user-select: none; background: transparent; border: 1px solid transparent; overflow: visible; font-family: Arial, "Microsoft JhengHei", "Noto Sans TC", sans-serif; }
.tb-editor-root .ui-box.dimmed { opacity: 0.4; cursor: pointer; }
.tb-editor-root .ui-box.dimmed:hover { opacity: 0.6; border-color: rgba(102,255,204,0.4); }
.tb-editor-root .ui-box.selected { opacity: 1; cursor: move; z-index: 5; border: 2px solid #66ffcc; box-shadow: 0 0 0 1px rgba(102,255,204,0.3), 0 0 10px rgba(102,255,204,0.35); }
.tb-editor-root .ui-visual { position: absolute; inset: 0; pointer-events: none; display: flex; align-items: center; justify-content: center; }
.tb-editor-root .ui-visual img { width: 100%; height: 100%; object-fit: contain; display: block; }
.tb-editor-root .icon-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #cfd8ff; background: rgba(108,140,255,0.18); border: 1px solid var(--box-line); border-radius: 4px; text-align: center; }
.tb-editor-root .resize-handle { position: absolute; right: -5px; bottom: -5px; width: 12px; height: 12px; background: var(--box-sel-line); border: 1px solid #0a0a14; cursor: nwse-resize; z-index: 6; }
.tb-editor-root .panel-slot-bg { position: absolute; border-radius: 14px; background: rgba(16,16,36,0.82); border: 1px solid rgba(255,255,255,0.85); }
.tb-editor-root .panel-slot-bg.inactive { opacity: 0.4; }
.tb-editor-root .col-inspector { width: 300px; border-left: 1px solid var(--line); padding: 12px; overflow-y: auto; background: var(--panel); }
.tb-editor-root .section-title { color: var(--muted); font-size: 12px; text-transform: uppercase; margin: 8px 0; letter-spacing: 0.5px; }
.tb-editor-root .row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.tb-editor-root .row label { width: 92px; color: var(--muted); }
.tb-editor-root .row input { flex: 1; background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; font-size: 13px; }
.tb-editor-root .tree-item { padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; margin-bottom: 5px; cursor: pointer; background: var(--panel2); }
.tb-editor-root .tree-item.selected { border-color: var(--accent); background: #34345a; }
.tb-editor-root .tree-group { color: var(--muted); font-size: 12px; margin: 8px 0 4px; }
.tb-editor-root #status { padding: 8px 16px; font-size: 13px; white-space: pre-wrap; border-top: 1px solid var(--line); background: var(--panel); max-height: 140px; overflow-y: auto; flex: 0 0 auto; }
.tb-editor-root .status-ok { color: var(--ok); }
.tb-editor-root .status-err { color: var(--danger); }
.tb-editor-root .hint { color: var(--muted); font-size: 12px; margin-top: 4px; }
`;

const EDITOR_STYLE_ID = 'tb-ui-editor-style';

function ensureEditorStyle(): void {
  if (document.getElementById(EDITOR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = EDITOR_STYLE_ID;
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}

/**
 * 掛載 UI 編輯器到指定容器（EditorMountFn）：注入 HTML+樣式 → 綁 stageEl → bindUI → applyZoom → initLoad（回顯）。
 * 回傳 { unmount() } 清 DOM + 移除全域 keydown。
 */
export function mount(container: HTMLElement): { unmount(): void } {
  ensureEditorStyle();
  container.classList.add('tb-editor-root');
  container.innerHTML = EDITOR_BODY_HTML;
  editorRoot = container;
  stageEl = $('stage'); // HTML 已注入，綁定舞台元素

  // 重置狀態（反覆開關 overlay：回乾淨初值，initLoad 再讀 override 回顯）。
  layout = cloneLayout(DEFAULT_UI_LAYOUT);
  selectedKey = null;
  undoStack = [];
  redoStack = [];

  bindUI();
  applyZoom();
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

