/**
 * uiLayoutSchema.ts — UI 佈局資料格式「單一來源」：型別定義 + 執行期驗證。
 *
 * ⚠️ 零 Phaser / 零遊戲 runtime 依賴（比照 levelSchema）。純型別 + 純驗證。
 * 供三方共用：UI 位置編輯器（ui-editor）、遊戲端 UI（讀同一份佈局）、之後 S5 的
 * per-player UI。此檔是共用契約——per-player 表示法從設計就內建，S5 直接讀不重定。
 *
 * ── 座標基準（明寫、不留隱含，凍結）──────────────────────────────
 *  【panel 欄內元素】座標 = 相對「該欄左上角」原點；+x 向右、+y 向下；單位 px。
 *     （界騎 BottomPanel 每欄自欄左上原點 (slotX, slotY) 起算，元素用 欄原點 + 偏移擺。）
 *  【overhead 元素】座標 = 相對「容器中心」的 local 座標；單位 px。
 *     （容器每幀移到 player 上方，offsetY=-140；元素 local 相對容器中心。）
 *
 * ── per-player 表示法（S5 前瞻對齊，現在定死）─────────────────────
 *  【panel】用 playerIndex(0~3) 索引：panel.columns[playerIndex]。BOTTOM_PANEL 本就是
 *     4 欄(slotCount:4 = P1~P4)。第一版單人只 columns[0](P1) active、P2~P4 佔位；
 *     S5 只是把 4 欄各自 active，讀同一份 schema，不改結構。
 *  【overhead】是「per-player template」：定義一份元素 local 座標範本，每個 player
 *     實例化一份，絕對位置 = 各自 player 的 offset。第一版只 P1 用；S5 每個 player 套同 template。
 *
 * 座標基準解析度：1920×1080，單位 px。
 * 結構對接 uiConfig.ts 的 OVERHEAD_LAYOUT / BOTTOM_PANEL_LAYOUT / ENERGY_BAR_LAYOUT。
 */

/** JSON 頂層 schema 版本（日後 migration 依據）。 */
export const UI_LAYOUT_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// 頭上 UI（OVERHEAD）
// ---------------------------------------------------------------------------

/** 玩家牌 + 魂力環（同心圓）。local 座標（相對容器中心）。 */
export interface OverheadBadge {
  /** 同心圓心 x（local）。 */
  cx: number;
  /** 同心圓心 y（local）。 */
  cy: number;
  /** P 編號牌內圓半徑。 */
  innerRadius: number;
  /** 魂力環半徑。 */
  ringRadius: number;
  /** 魂力環粗細。 */
  ringThickness: number;
  /** 編號文字，如 'P1'。 */
  text: string;
}

/** Credit（點數 + 金幣）。 */
export interface OverheadCredit {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 金幣圖示尺寸。 */
  coinSize: number;
}

/** 能量格（4 格）：起點座標 + 格子外觀。 */
export interface OverheadEnergy {
  /** 能量格起點 x（local）。 */
  x: number;
  /** 能量格起點 y（local）。 */
  y: number;
  /** 格數。 */
  cellCount: number;
  cellWidth: number;
  cellHeight: number;
  /** 格間距。 */
  cellGap: number;
  cornerRadius: number;
}

/** COMBO（連段）文字。 */
export interface OverheadCombo {
  x: number;
  y: number;
  /** 後綴，如 ' HIT'。 */
  suffix: string;
  /** 為 0 時隱藏。 */
  hideWhenZero: boolean;
  /** 是否有警示閃爍。 */
  warning: boolean;
  /** MAX! 顯示的 y 偏移。 */
  maxOffsetY: number;
}

/**
 * 頭上 UI「per-player template」：容器 offset + 整體尺寸 + 各元素 local 座標。
 * 每個 player 實例化一份此範本，絕對位置 = 各自 player 的 offset（S5 每 player 套同 template）。
 * 元素 local 座標基準：相對容器中心，+x 右、+y 下，px。
 */
export interface OverheadLayout {
  /** 容器相對玩家的 x 偏移。 */
  offsetX: number;
  /** 容器相對玩家的 y 偏移（如 -140，在玩家上方）。 */
  offsetY: number;
  /** 整體邏輯尺寸（供編輯器畫容器框）。 */
  width: number;
  height: number;
  badge: OverheadBadge;
  credit: OverheadCredit;
  energy: OverheadEnergy;
  combo: OverheadCombo;
}

// ---------------------------------------------------------------------------
// 底部面板（PANEL）
// ---------------------------------------------------------------------------

/**
 * 欄內單一元素：位置 + 尺寸。
 * 座標基準：相對「該欄左上角」原點，+x 右、+y 下，px。
 */
export interface PanelElement {
  /** 元素識別（chest/ticket/progress/coin…）。 */
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 底部面板單一欄（對應一個玩家）。用 playerIndex(0~3) 索引。
 * 第一版單人只 columns[0](P1) active；P2~P4 佔位（active:false）。
 * S5 把 4 欄各自 active，讀同一份 schema，不改結構。
 *
 * 🔴 防漂移慣例（顧問定，務必遵守）：
 *   columns[1..3].elements **從 columns[0]（template 欄）複製衍生**，不獨立編寫。
 *   本遊戲要求所有玩家面板結構相同（Unity BottomPanel 4 個相同欄），不要 per-player 差異。
 *   - UI 位置編輯器：只編 columns[0]（P1 template 欄）。
 *   - S5 做 per-player UI 時：把 columns[0].elements 複製到 columns[1..3]，
 *     使 P1~P4 面板結構恆等（防漂移）。
 *   - 例外：未來若真要 per-player UI 差異（目前不要），才解除此慣例——
 *     columns[] 結構已支援各欄獨立 elements，屆時走 spec §4 決定。
 *   註：columns[] 把「防漂移」由結構保證（只一份 elements）降為慣例保證
 *   （每欄各有 elements），故以此註解明訂慣例，避免有人各編各的把面板編歪。
 */
export interface PanelColumn {
  /** 玩家索引 0~3（= P1~P4）。 */
  playerIndex: number;
  /** 是否啟用顯示（單人版面只有 index 0 為 true，其餘佔位）。 */
  active: boolean;
  /** 欄內元素（座標相對該欄左上）。 */
  elements: PanelElement[];
}

/**
 * 底部面板佈局：共用欄排版參數 + 每欄（per-player）內容。
 * columns 以 playerIndex 索引（columns[playerIndex]）。
 */
export interface PanelLayout {
  /** 欄數（= 玩家數上限，P1~P4）。 */
  slotCount: number;
  slotWidth: number;
  slotHeight: number;
  /** 欄間距。 */
  slotGap: number;
  /** 距螢幕底的偏移。 */
  bottomOffset: number;
  /** 欄內留白。 */
  padding: number;
  cornerRadius: number;
  /** 每個玩家一欄（playerIndex 索引）。 */
  columns: PanelColumn[];
}

// ---------------------------------------------------------------------------
// 頂層
// ---------------------------------------------------------------------------

/** 設計基準解析度。 */
export interface DesignResolution {
  width: number;
  height: number;
}

/** UI 佈局檔頂層結構。 */
export interface UiLayoutFile {
  version: number;
  /** 設計解析度（座標基準）。 */
  design: DesignResolution;
  overhead: OverheadLayout;
  panel: PanelLayout;
}

// ---------------------------------------------------------------------------
// 初值（權威值來自 uiConfig.ts 的三個 LAYOUT，由統籌自翼騎碼撈）
// ---------------------------------------------------------------------------

/** 預設 UI 佈局（1920×1080 單人版面）。編輯器初次載入 / 匯出範例的基準。 */
export const DEFAULT_UI_LAYOUT: UiLayoutFile = {
  version: UI_LAYOUT_SCHEMA_VERSION,
  design: { width: 1920, height: 1080 },
  overhead: {
    offsetX: 0,
    offsetY: -140, // 容器每幀移到 player 上方
    width: 200,
    height: 80,
    badge: {
      cx: -66,
      cy: -2,
      innerRadius: 18,
      ringRadius: 26,
      ringThickness: 7,
      text: 'P1',
    },
    credit: { x: 4, y: -14, width: 120, height: 34, coinSize: 22 },
    energy: {
      x: -20,
      y: 22,
      cellCount: 4,
      cellWidth: 16,
      cellHeight: 16,
      cellGap: 6,
      cornerRadius: 3,
    },
    combo: {
      x: 0,
      y: -52,
      suffix: ' HIT',
      hideWhenZero: true,
      warning: true,
      maxOffsetY: -34,
    },
  },
  panel: {
    slotCount: 4,
    slotWidth: 420,
    slotHeight: 120,
    slotGap: 20,
    bottomOffset: 16,
    padding: 14,
    cornerRadius: 14,
    // 每玩家一欄（playerIndex 索引）。第一版單人：P1 active、P2~P4 佔位。
    // P1 欄內元素座標=相對欄左上，對齊界騎現況公式（padding=14/slotWidth=420/slotHeight=120）。
    columns: [
      {
        playerIndex: 0,
        active: true,
        elements: [
          { id: 'chest', x: 14, y: 36, width: 70, height: 70 }, // 左下：y=120-14-70
          { id: 'ticket', x: 100, y: 58, width: 120, height: 40 }, // chest 右：x=14+70+16
          { id: 'progress', x: 14, y: 98, width: 392, height: 16 }, // 下方跨欄：width=420-2×14
          { id: 'coin', x: 380, y: 80, width: 26, height: 26 }, // 右下：x=420-14-26,y=120-14-26
        ],
      },
      { playerIndex: 1, active: false, elements: [] },
      { playerIndex: 2, active: false, elements: [] },
      { playerIndex: 3, active: false, elements: [] },
    ],
  },
};

// ---------------------------------------------------------------------------
// 驗證：validateUiLayout(json) → Result；assertValidUiLayout 大聲失敗。
// ---------------------------------------------------------------------------

export type ValidateUiResult =
  | { ok: true; data: UiLayoutFile }
  | { ok: false; errors: string[] };

/** 驗證失敗錯誤（訊息含逐條精準定位）。 */
export class UiLayoutValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(
      `UI 佈局驗證失敗（${errors.length} 項）：\n${errors.map((m) => `  - ${m}`).join('\n')}`,
    );
    this.name = 'UiLayoutValidationError';
    this.errors = errors;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** 驗證某物件在指定 key 上是有限數字，否則 push 錯誤。 */
function checkNum(
  obj: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
  opts: { positive?: boolean } = {},
): void {
  const v = obj[key];
  if (!isFiniteNumber(v)) {
    errors.push(`${label}「${key}」缺少或非數字。`);
  } else if (opts.positive && v <= 0) {
    errors.push(`${label}「${key}」=${v} 必須 > 0。`);
  }
}

function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

/** 驗證任意 JSON 是否為合法 UiLayoutFile。大聲、精準定位。 */
export function validateUiLayout(json: unknown): ValidateUiResult {
  const errors: string[] = [];
  const root = asObject(json);
  if (!root) {
    return { ok: false, errors: ['根層級必須是物件 { version, design, overhead, panel }。'] };
  }

  if (!isFiniteNumber(root.version)) {
    errors.push('頂層「版本 version」缺少或非數字（預期 version: 1）。');
  } else if (root.version !== UI_LAYOUT_SCHEMA_VERSION) {
    errors.push(
      `頂層「版本 version」=${String(root.version)} 不支援（此版本只接受 ${UI_LAYOUT_SCHEMA_VERSION}）。`,
    );
  }

  const design = asObject(root.design);
  if (!design) {
    errors.push('頂層「設計解析度 design」缺少或不是物件。');
  } else {
    checkNum(design, 'width', '設計解析度 design 的', errors, { positive: true });
    checkNum(design, 'height', '設計解析度 design 的', errors, { positive: true });
  }

  validateOverhead(root.overhead, errors);
  validatePanel(root.panel, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: root as unknown as UiLayoutFile };
}

function validateOverhead(raw: unknown, errors: string[]): void {
  const ov = asObject(raw);
  if (!ov) {
    errors.push('「頭上 UI overhead」缺少或不是物件。');
    return;
  }
  const at = '頭上 UI overhead 的';
  checkNum(ov, 'offsetX', at, errors);
  checkNum(ov, 'offsetY', at, errors);
  checkNum(ov, 'width', at, errors, { positive: true });
  checkNum(ov, 'height', at, errors, { positive: true });

  const badge = asObject(ov.badge);
  if (!badge) errors.push(`${at}「玩家牌/魂力環 badge」缺少或不是物件。`);
  else {
    const b = 'overhead.badge（玩家牌/魂力環）的';
    checkNum(badge, 'cx', b, errors);
    checkNum(badge, 'cy', b, errors);
    checkNum(badge, 'innerRadius', b, errors, { positive: true });
    checkNum(badge, 'ringRadius', b, errors, { positive: true });
    checkNum(badge, 'ringThickness', b, errors, { positive: true });
    if (!isNonEmptyString(badge.text)) errors.push(`${b}「text」缺少或非非空字串。`);
  }

  const credit = asObject(ov.credit);
  if (!credit) errors.push(`${at}「點數 credit」缺少或不是物件。`);
  else {
    const c = 'overhead.credit（點數）的';
    checkNum(credit, 'x', c, errors);
    checkNum(credit, 'y', c, errors);
    checkNum(credit, 'width', c, errors, { positive: true });
    checkNum(credit, 'height', c, errors, { positive: true });
    checkNum(credit, 'coinSize', c, errors, { positive: true });
  }

  const energy = asObject(ov.energy);
  if (!energy) errors.push(`${at}「能量格 energy」缺少或不是物件。`);
  else {
    const e = 'overhead.energy（能量格）的';
    checkNum(energy, 'x', e, errors);
    checkNum(energy, 'y', e, errors);
    checkNum(energy, 'cellCount', e, errors, { positive: true });
    checkNum(energy, 'cellWidth', e, errors, { positive: true });
    checkNum(energy, 'cellHeight', e, errors, { positive: true });
    checkNum(energy, 'cellGap', e, errors);
    checkNum(energy, 'cornerRadius', e, errors);
  }

  const combo = asObject(ov.combo);
  if (!combo) errors.push(`${at}「連段 combo」缺少或不是物件。`);
  else {
    const cb = 'overhead.combo（連段）的';
    checkNum(combo, 'x', cb, errors);
    checkNum(combo, 'y', cb, errors);
    checkNum(combo, 'maxOffsetY', cb, errors);
    if (typeof combo.suffix !== 'string') errors.push(`${cb}「suffix」必須是字串。`);
    if (typeof combo.hideWhenZero !== 'boolean') errors.push(`${cb}「hideWhenZero」必須是布林。`);
    if (typeof combo.warning !== 'boolean') errors.push(`${cb}「warning」必須是布林。`);
  }
}

function validatePanel(raw: unknown, errors: string[]): void {
  const p = asObject(raw);
  if (!p) {
    errors.push('「底部面板 panel」缺少或不是物件。');
    return;
  }
  const at = '底部面板 panel 的';
  checkNum(p, 'slotCount', at, errors, { positive: true });
  checkNum(p, 'slotWidth', at, errors, { positive: true });
  checkNum(p, 'slotHeight', at, errors, { positive: true });
  checkNum(p, 'slotGap', at, errors);
  checkNum(p, 'bottomOffset', at, errors);
  checkNum(p, 'padding', at, errors);
  checkNum(p, 'cornerRadius', at, errors);

  if (!Array.isArray(p.columns)) {
    errors.push(`${at}「欄位 columns」缺少或不是陣列。`);
    return;
  }
  if (p.columns.length === 0) {
    errors.push(`${at}「欄位 columns」為空，至少要有一欄。`);
  }
  const seenIndex = new Set<number>();
  p.columns.forEach((colRaw, ci) => {
    const col = asObject(colRaw);
    const cAt = `panel.columns[${ci}]`;
    if (!col) {
      errors.push(`${cAt} 必須是物件 { playerIndex, active, elements }。`);
      return;
    }
    if (!isFiniteNumber(col.playerIndex) || col.playerIndex < 0 || col.playerIndex > 3 || !Number.isInteger(col.playerIndex)) {
      errors.push(`${cAt} 的「playerIndex」必須是 0~3 的整數。`);
    } else {
      if (seenIndex.has(col.playerIndex)) {
        errors.push(`${cAt} 的「playerIndex」=${col.playerIndex} 與其他欄重複。`);
      }
      seenIndex.add(col.playerIndex);
    }
    if (typeof col.active !== 'boolean') {
      errors.push(`${cAt} 的「active」必須是布林。`);
    }
    const pLabel = isFiniteNumber(col.playerIndex) ? `P${col.playerIndex + 1} 欄` : cAt;
    validatePanelElements(col.elements, pLabel, errors);
  });
}

/** 驗證一欄的 elements 陣列（每個 {id,x,y,width,height}，id 欄內唯一）。 */
function validatePanelElements(raw: unknown, colLabel: string, errors: string[]): void {
  if (!Array.isArray(raw)) {
    errors.push(`${colLabel} 的「元素 elements」缺少或不是陣列。`);
    return;
  }
  // 空 elements 是合法的（佔位欄 P2~P4 可為空）。
  const seenIds = new Set<string>();
  raw.forEach((elRaw, i) => {
    const el = asObject(elRaw);
    const eAt = `${colLabel} elements[${i}]`;
    if (!el) {
      errors.push(`${eAt} 必須是物件 { id, x, y, width, height }。`);
      return;
    }
    if (!isNonEmptyString(el.id)) {
      errors.push(`${eAt} 的「id」缺少或非非空字串。`);
    } else {
      if (seenIds.has(el.id)) errors.push(`${eAt} 的「id」"${el.id}" 在同欄與其他元素重複。`);
      seenIds.add(el.id);
    }
    const label = isNonEmptyString(el.id) ? `${colLabel} 元素「${el.id}」的` : `${eAt} 的`;
    checkNum(el, 'x', label, errors);
    checkNum(el, 'y', label, errors);
    checkNum(el, 'width', label, errors, { positive: true });
    checkNum(el, 'height', label, errors, { positive: true });
  });
}

/** 驗證通過回傳收斂型別；否則大聲失敗拋 UiLayoutValidationError。 */
export function assertValidUiLayout(raw: unknown): UiLayoutFile {
  const result = validateUiLayout(raw);
  if (!result.ok) throw new UiLayoutValidationError(result.errors);
  return result.data;
}
