/**
 * UI/HUD 數值與版面設定（資料驅動，見 docs/h5_collab_spec.md §6）。
 *
 * 對照 Unity prefab 版面，HUD 分兩塊：
 *  A. 角色頭上 UI（PlayerUI 200×80）—— 世界座標，跟隨玩家浮在頭上。
 *  B. 下方面板（4 欄 P1~P4）—— 螢幕底部固定（setScrollFactor 0）。
 *
 * 座標/尺寸基準為設計解析度 1920×1080（見 gameConfig）。所有顏色/尺寸集中在此。
 * 目前用色塊+文字+基本圖形排佈局，真美術 icon 之後替換。
 * 數字（Credit/彩票/魂力/COMBO）走 stub 佔位，能量接現有 getEnergy。
 */

/** 各 HUD 區塊與螢幕邊緣的統一留白（px）。 */
export const HUD_MARGIN = 32;

/** HUD 用字型堆疊（含中文備援）。 */
export const HUD_FONT_FAMILY = 'Arial, "Microsoft JhengHei", "Noto Sans TC", sans-serif';

/** 角色頭上 UI 繪製深度（畫在角色之上）。 */
export const OVERHEAD_DEPTH = 900;
/** 下方面板繪製深度（畫在最上層，固定螢幕）。 */
export const PANEL_DEPTH = 1000;

/** HUD 共用配色（兒童向：高對比、明亮）。 */
export const HUD_COLORS = {
  /** 面板底色（半透明深色）。 */
  panelFill: 0x101024,
  panelFillAlpha: 0.82,
  /** 面板外框。 */
  panelStroke: 0xffffff,
  panelStrokeAlpha: 0.7,
  /** 一般文字。 */
  text: '#ffffff',
  /** 次要/佔位文字（灰）。 */
  textMuted: '#bbbbbb',
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
  /** 玩家編號牌底色。 */
  pNumBg: 0x2196f3,
  /** 魂力環底槽色。 */
  soulRingBg: 0x3a3a5a,
  /** 魂力環充填色。 */
  soulRingFill: 0xba68c8,
  /** Credit 底框色。 */
  creditBg: 0x000000,
  /** 金幣 icon 佔位色。 */
  coin: 0xffca28,
  /** 寶箱 icon 佔位色。 */
  chest: 0x8d6e63,
  /** 進度條底槽色。 */
  progressBg: 0x2a2a3a,
  /** 進度條充填色。 */
  progressFill: 0x4caf50,
  /** P2~P4 佔位欄的整體淡化提示色（未加入）。 */
  slotInactive: 0x555566,
} as const;

/**
 * UI icon 貼圖（從 Unity 撈的真美術，放 public/assets/images/ui/）。
 * key = Phaser texture key；path = 載入路徑（相對 public/）。
 * UISystem.preload(scene) 統一載入這些；元件用 scene.add.image(key) 顯示。
 * displaySize = 顯示邊長（px），依原有佔位版面尺寸對齊。
 */
export const UI_ICONS = {
  /** 金幣（Credit 顯示）。 */
  coin: { key: 'ui-coin', path: 'assets/images/ui/coin.png' },
  /** 彩票（底部面板彩票數）。 */
  ticket: { key: 'ui-ticket', path: 'assets/images/ui/ticket.png' },
  /** 魂力環 sprite（對照 Unity RingSprite，同心包 P 編號牌）。 */
  ring: { key: 'ui-ring', path: 'assets/images/ui/ring.png' },
  /** 寶箱（底部面板寶盒格）。 */
  chest: { key: 'ui-chest', path: 'assets/images/ui/chest.png' },
  /** JP 燈（未來 JP UI 用，先備著 preload）。 */
  lamp: { key: 'ui-lamp', path: 'assets/images/ui/lamp.png' },
} as const;

/** UI 佈局 JSON（uiLayoutSchema 格式）：Phaser cache key + 載入路徑。 */
export const UI_LAYOUT_ASSET = {
  key: 'ui-layout',
  path: 'assets/data/uiLayout.json',
} as const;

/**
 * A. 角色頭上 UI（跟隨玩家，世界座標）。
 * 對照 Unity PlayerUI 200×80。座標皆為「相對容器中心」的 local 值，
 * 容器每幀移到 player 位置上方（offsetY）。
 */
export const OVERHEAD_LAYOUT = {
  /** 整體寬高（px，僅供背板/排版參考）。 */
  width: 200,
  height: 80,
  /** 容器相對玩家中心的垂直位移（負=往上；px）。角色頭頂之上。 */
  offsetY: -140,

  /**
   * 玩家編號牌 + 魂力環（同心，對齊 Unity HPRing 60 外圈 / PNum 36 內圓）。
   * 中心 (cx, cy) 為 local 座標；內圓是圓形 P1 編號牌，外圈是魂力填充弧。
   */
  badge: {
    /** 同心圓中心（相對容器）。 */
    cx: -66,
    cy: -2,
    /** 內圓（P1 編號牌）半徑 → 直徑 36。 */
    innerRadius: 18,
    /** 魂力環半徑（環中線）→ 對齊 Unity HPRing 60。 */
    ringRadius: 26,
    /** 魂力環線寬。 */
    ringThickness: 7,
    /** P1 文字字級。 */
    fontSize: '20px',
    /** 玩家編號文字（單人先 P1）。 */
    text: 'P1',
  },

  /** Credit 數字 + 金幣 icon（右側 130×40）。stub：回 0/99999。 */
  credit: {
    x: 4,
    y: -14,
    width: 120,
    height: 34,
    fontSize: '22px',
    coinSize: 22,
    /** stub 佔位顯示值。 */
    placeholder: '00000',
  },

  /** 能量 4 格（SkillGauge Slot0~3，水平排；搬自原能量條）。 */
  energy: {
    /** 相對容器的起點（左格左緣）。 */
    x: -20,
    y: 22,
  },

  /** COMBO「n HIT」（上方）。 */
  combo: {
    x: 0,
    y: -52,
    fontSize: '24px',
    /** 後綴文字。 */
    suffix: ' HIT',
    /** combo=0 時隱藏。 */
    hideWhenZero: true,
    /**
     * 快超時警告（對照 Unity ComboUI warning）：數字閃爍 + 變警告色，
     * 提示 COMBO 快歸零。由 setComboWarning(true/false) 開關。
     */
    warning: {
      /** 警告色（亮紅）。 */
      color: '#ff3b30',
      /** 一次閃爍（明↔暗）的時間（毫秒）。 */
      blinkMs: 220,
      /** 閃爍最低透明度。 */
      minAlpha: 0.25,
    },
    /**
     * MAX!（對照 Unity ShowMaxCombo）：COMBO 滿檔時的一次性放大強調。
     * 由 showMaxCombo() 觸發，播放後淡出。
     */
    max: {
      text: 'MAX!',
      color: '#ffe14d',
      fontSize: '40px',
      /** 相對 COMBO 數字的垂直位移（負=更上方）。 */
      offsetY: -34,
      /** 放大起始倍率（從此縮回 1）。 */
      punchScale: 1.8,
      /** 放大→縮回時間（毫秒）。 */
      popMs: 260,
      /** 停留後淡出時間（毫秒）。 */
      fadeMs: 500,
    },
  },
} as const;

/**
 * 能量 4 格外觀（頭上 UI 用小尺寸，對照 Unity SkillGauge Slot 14×14）。
 * 由 PlayerOverheadUI 以 local 座標嵌入容器；EnergyBar 只負責畫格與滿格閃爍。
 */
export const ENERGY_BAR_LAYOUT = {
  /** 格數（對應 Unity 4 格滿放招）。 */
  cellCount: 4,
  /** 單格尺寸（px）。 */
  cellWidth: 16,
  cellHeight: 16,
  /** 格間距（px）。 */
  cellGap: 6,
  /** 圓角半徑（px）。 */
  cornerRadius: 3,
  /**
   * 滿格「可放招」閃爍（對照 Unity SkillGaugeUI.ShowReady：
   * 4 格在白↔亮色之間來回閃爍當可放招提示，非靜態）。
   */
  readyFlash: {
    colorA: 0xffffff,
    colorB: 0x66ffcc,
    /** 一次來回（A→B→A）的週期（秒）。 */
    periodSec: 0.5,
  },
} as const;

/**
 * B. 下方面板（螢幕底部固定，4 欄 P1~P4 橫排）。
 * 對照 Unity：每欄有面板底框 / 寶箱 icon 70×70 / 彩票數 / 進度條 / 金幣 icon。
 * 目前單人 → P1 完整、P2~P4 佔位淡化。
 */
export const BOTTOM_PANEL_LAYOUT = {
  /** 玩家欄數。 */
  slotCount: 4,
  /** 面板距畫面底部留白（px）。 */
  bottomOffset: 16,
  /** 欄間距（px）。 */
  slotGap: 20,
  /** 單欄尺寸（px）。 */
  slotWidth: 420,
  slotHeight: 120,
  /** 欄內距。 */
  padding: 14,
  /** 圓角。 */
  cornerRadius: 14,

  /** 寶箱 icon（左，方塊佔位 70×70）。 */
  chest: {
    size: 70,
  },
  /** 彩票數字（寶箱右）。stub 回 0。 */
  ticket: {
    fontSize: '30px',
    labelFontSize: '16px',
    label: '彩票',
    placeholder: '00000',
  },
  /** 進度條（下方）。 */
  progress: {
    height: 16,
    cornerRadius: 6,
    /** stub 佔位比例（0..1）。 */
    placeholderRatio: 0,
  },
  /** 金幣 icon（右下角）。 */
  coin: {
    size: 26,
  },
  /** 欄標籤字級（P1~P4）。 */
  labelFontSize: '22px',
} as const;
