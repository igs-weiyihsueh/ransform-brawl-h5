/**
 * UI/HUD 數值與版面設定（資料驅動，見 docs/h5_collab_spec.md §6）。
 *
 * HUD 全部用「螢幕座標」定位（固定不隨相機移動）；座標基準為設計解析度
 * 1920×1080（見 gameConfig）。所有顏色/尺寸/位置集中在此，UI 元件只讀不寫死。
 *
 * 註：能量/COMBO 系統尚未實作 → UISystem 以 stub 供數值，本檔僅定義「視覺框架」外觀。
 * 之後接真資料只換 UISystem 內的資料來源一行，不需改本檔或元件。
 */

/** 各 HUD 區塊與螢幕邊緣的統一留白（px）。 */
export const HUD_MARGIN = 32;

/** HUD 共用配色（兒童向：高對比、明亮）。 */
export const HUD_COLORS = {
  /** 面板底色（半透明深色）。 */
  panelFill: 0x000000,
  panelFillAlpha: 0.45,
  /** 面板外框。 */
  panelStroke: 0xffffff,
  panelStrokeAlpha: 0.6,
  /** 一般文字。 */
  text: '#ffffff',
  /** 次要/佔位文字（灰）。 */
  textMuted: '#bbbbbb',
  /** 提示強調（受擊 iFrame）。 */
  warn: '#ff5252',
  /** 能量格：已充能（亮金）。 */
  energyOn: 0xffd54f,
  /** 能量格：未充能（暗）。 */
  energyOff: 0x3a3a5a,
  /** 能量格外框。 */
  energyStroke: 0xffffff,
  /** 能量滿格提示光（放招可用）。 */
  energyReady: 0x66ffcc,
  /** COMBO 數字色（亮橘）。 */
  comboText: '#ffb300',
  /** 魂力佔位區塊色。 */
  soulPlaceholder: 0x5a3a6a,
} as const;

/** 玩家 HUD（左上）：目前角色 + 受擊提示 + 魂力佔位。 */
export const PLAYER_HUD_LAYOUT = {
  x: HUD_MARGIN,
  y: HUD_MARGIN,
  /** 面板寬高（px）。 */
  width: 320,
  height: 108,
  /** 內距。 */
  padding: 14,
  /** 標題（目前角色）字級。 */
  titleFontSize: '30px',
  /** 受擊提示字級。 */
  statusFontSize: '22px',
  /** 魂力佔位條高度（px）。 */
  soulBarHeight: 20,
  /** 魂力佔位文字。 */
  soulLabel: '魂力',
} as const;

/** 能量條（4 格）：置於畫面下方中央，普攻命中亮一格、滿格可放招。 */
export const ENERGY_BAR_LAYOUT = {
  /** 格數（對應 Unity 4 格滿放招）。 */
  cellCount: 4,
  /** 單格尺寸（px）。 */
  cellWidth: 92,
  cellHeight: 34,
  /** 格間距（px）。 */
  cellGap: 12,
  /** 圓角半徑（px）。 */
  cornerRadius: 8,
  /** 距畫面底部留白（px）。 */
  bottomOffset: 40,
  /** 標籤文字（少字兒童向）。 */
  label: '能量',
  labelFontSize: '24px',
  labelGap: 10,
  /**
   * 滿格「可放招」閃爍設定（對照 Unity SkillGaugeUI.ShowReady：
   * 4 格在白↔亮色之間來回閃爍當可放招提示，非靜態）。
   */
  readyFlash: {
    /** 閃爍色 A（白）。 */
    colorA: 0xffffff,
    /** 閃爍色 B（亮綠，= energyReady）。 */
    colorB: 0x66ffcc,
    /** 一次來回（A→B→A）的週期（秒）。 */
    periodSec: 0.5,
  },
} as const;

/** COMBO 數字：置於右上，連擊時放大顯示大數字。 */
export const COMBO_LAYOUT = {
  x: 1920 - HUD_MARGIN,
  y: HUD_MARGIN,
  /** 大數字字級。 */
  numberFontSize: '84px',
  /** "COMBO" 標籤字級。 */
  labelFontSize: '30px',
  label: 'COMBO',
  /** combo 為 0（無連擊）時是否隱藏整組。 */
  hideWhenZero: true,
} as const;

/** HUD 用字型堆疊（含中文備援）。 */
export const HUD_FONT_FAMILY = 'Arial, "Microsoft JhengHei", "Noto Sans TC", sans-serif';

/** HUD 繪製深度（畫在遊戲物件之上，固定不被角色擋住）。 */
export const HUD_DEPTH = 1000;
