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
  /** 金幣（舊 Credit 顯示，用戶 #6 移除下方面板金幣後僅留備用/佔位 fallback）。 */
  coin: { key: 'ui-coin', path: 'assets/images/ui/coin.png' },
  /** 劍（Credit 投幣點數顯示 icon，用戶 #5：credit 旁改用劍）。 */
  sword: { key: 'ui-sword', path: 'assets/images/ui/sword.png' },
  /** 彩票（底部面板彩票數）。 */
  ticket: { key: 'ui-ticket', path: 'assets/images/ui/ticket.png' },
  /** 魂力環 sprite（對照 Unity RingSprite，同心包 P 編號牌）。 */
  ring: { key: 'ui-ring', path: 'assets/images/ui/ring.png' },
  /** 寶箱（底部面板寶盒格）。 */
  chest: { key: 'ui-chest', path: 'assets/images/ui/chest.png' },
  /** JP 燈（未來 JP UI 用，先備著 preload）。 */
  lamp: { key: 'ui-lamp', path: 'assets/images/ui/lamp.png' },
  /** 待機台座（角色待機時站在上面的立足平台）。 */
  platform: { key: 'ui-platform', path: 'assets/images/ui/platform.png' },
  /** 守護波雕像（GuardTarget，Unity Cainos TX Props Statue 切圖）。 */
  statue: { key: 'ui-statue', path: 'assets/images/ui/statue.png' },
  /** 進度條節點圖標（#2，Unity LevelProgressUI 64×64 白 picto，染狀態色）。 */
  nodeSpawn: { key: 'ui-node-spawn', path: 'assets/images/ui/node-spawn.png' },
  nodeReward: { key: 'ui-node-reward', path: 'assets/images/ui/node-reward.png' },
  nodeEvent: { key: 'ui-node-event', path: 'assets/images/ui/node-event.png' },
  /** 召喚法陣（一般波敵人登場預警，#3；256×256 紅色系雙外圈+六芒星+符文，透明底）。 */
  summonCircle: { key: 'ui-summon-circle', path: 'assets/images/ui/summon-circle.png' },
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
    /**
     * 沒 Credit（耗盡）演出（對齊 Unity credit=0：閃紅 + 投幣提示 + 倒數回待機）。
     * 角色本體閃紅由核心 CreditSystem 處理；此處是「HUD credit 顯示區」的演出。
     */
    outOfCredit: {
      /** credit 數字閃紅色（可 override）。 */
      flashColor: '#ff3b30',
      /** 閃爍半週期（毫秒，可 override）。 */
      blinkMs: 300,
      /** 投幣提示文字（對照 Unity CoinHint，可 override）。 */
      hintText: '投幣 (C)',
      /** 提示文字色（可 override）。 */
      hintColor: '#ffe14d',
      /** 提示文字字級（可 override）。 */
      hintFontSize: '18px',
      /** 提示文字相對 credit 底框左上的 x 偏移（可 override）。 */
      hintOffsetX: 0,
      /** 提示文字相對 credit 底框的 y 偏移（正=下方，可 override）。 */
      hintOffsetY: 26,
      /** 倒數是否顯示秒數（附在提示後，如「投幣 (C) 9」，可 override）。 */
      showCountdown: true,
    },
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
     * 顏色階層（對照 Unity ComboUI ShowCombo）：正常 COMBO 顯示色隨連段數變。
     * count>=tier2 紅 / >=tier1 橙 / else 金。warning 啟用時警告色 override 此階層色。
     */
    tier: {
      /** 橙色門檻（Unity colorTier1）。 */
      tier1: 10,
      /** 紅色門檻（Unity colorTier2）。 */
      tier2: 20,
      /** 金（<tier1，Unity color1 = (1,0.85,0)）。 */
      color1: 0xffd900,
      /** 橙（>=tier1，Unity color2 = (1,0.5,0)）。 */
      color2: 0xff8000,
      /** 紅（>=tier2，Unity color3 = Color.red）。 */
      color3: 0xff0000,
    },
    /**
     * 跳動放大（對照 Unity ComboUI PunchEffect）：每次 combo 數增加時文字彈跳一下。
     */
    punch: {
      /** 彈跳峰值倍率（scale 1→peak→1）。 */
      peakScale: 1.3,
      /** 一次彈跳時間（毫秒）。 */
      durationMs: 150,
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

  /**
   * 連打變身 UI（讀翼騎 TransformSystem.isMashingTransform/getMashRatio）：
   * 連打變身時頭上 UI 整體放大 + 顯「空魂力環」從 getMashRatio 填滿 + 顯訊息。
   * 魂力環填充色沿用 badge 的 soulRingFill（HUD_COLORS）；此處是動效/訊息參數。
   */
  mashTransform: {
    /** 連打變身時頭上 UI 放大倍率（container scale）。 */
    enlargeScale: 1.35,
    /** 放大/縮回 tween 時間（毫秒）。 */
    scaleMs: 180,
    /** 訊息文字（連打變身開始顯）。 */
    message: '連打變身！',
    messageColor: '#ffe14d',
    messageFontSize: '22px',
    /** 訊息相對容器中心的位移（負=上方，放 badge 上方）。 */
    messageX: -66,
    messageY: -44,
  },
} as const;

/**
 * COMBO 顏色階層（純函式，對齊 Unity ComboUI ShowCombo）：
 * count>=tier2 紅 / >=tier1 橙 / else 金。抽純函式方便單元測試（測騎）。
 */
export function comboTierColor(count: number): number {
  const t = OVERHEAD_LAYOUT.combo.tier;
  if (count >= t.tier2) return t.color3; // 紅
  if (count >= t.tier1) return t.color2; // 橙
  return t.color1; // 金
}

/** COMBO 階層色（hex number）轉 Phaser Text 用的 '#rrggbb' 字串。 */
export function comboTierColorHex(count: number): string {
  return `#${comboTierColor(count).toString(16).padStart(6, '0')}`;
}

/**
 * 七輪 overhead override 補接：把 uiLayout override 的 overhead 位置/尺寸「合併進」OVERHEAD_LAYOUT（純函式，抽給測騎）。
 * override 提供 position/size（badge cx/cy/半徑、credit x/y/w/h/coinSize、energy x/y、combo x/y/maxOffsetY）；
 * 樣式欄（fontSize/顏色/文字/max 動畫參數）不在 override 內 → 一律留 OVERHEAD_LAYOUT 打包預設。
 * 各欄逐項 `override?.xxx ?? OVERHEAD_LAYOUT.xxx` fallback：無 override/缺欄 → 打包預設（行為 100% 不變）。
 * ⚠️ 遊戲端 PlayerOverheadUI 建構用此取代硬讀 OVERHEAD_LAYOUT（讓 ui-editor 改 overhead 位置→套用→遊戲跟著變）。
 * @param ov uiLayout 的 overhead 區塊（來自 loadOverride 後的 layout.overhead；缺→全用打包預設）。
 */
export function resolveOverheadLayout(ov?: {
  offsetX?: number; offsetY?: number; width?: number; height?: number;
  badge?: { cx?: number; cy?: number; innerRadius?: number; ringRadius?: number; ringThickness?: number };
  credit?: {
    x?: number; y?: number; width?: number; height?: number; coinSize?: number;
    outOfCredit?: {
      flashColor?: string; blinkMs?: number; hintText?: string; hintColor?: string;
      hintFontSize?: string; hintOffsetX?: number; hintOffsetY?: number; showCountdown?: boolean;
    };
  };
  energy?: { x?: number; y?: number };
  combo?: { x?: number; y?: number; maxOffsetY?: number; fontSize?: string };
}): typeof OVERHEAD_LAYOUT {
  const L = OVERHEAD_LAYOUT;
  const oc = ov?.credit?.outOfCredit;
  return {
    ...L,
    offsetY: ov?.offsetY ?? L.offsetY,
    badge: {
      ...L.badge,
      cx: ov?.badge?.cx ?? L.badge.cx,
      cy: ov?.badge?.cy ?? L.badge.cy,
      innerRadius: ov?.badge?.innerRadius ?? L.badge.innerRadius,
      ringRadius: ov?.badge?.ringRadius ?? L.badge.ringRadius,
      ringThickness: ov?.badge?.ringThickness ?? L.badge.ringThickness,
    },
    credit: {
      ...L.credit,
      x: ov?.credit?.x ?? L.credit.x,
      y: ov?.credit?.y ?? L.credit.y,
      width: ov?.credit?.width ?? L.credit.width,
      height: ov?.credit?.height ?? L.credit.height,
      coinSize: ov?.credit?.coinSize ?? L.credit.coinSize,
      // 沒 credit 投幣提示：表現/位置逐項 override（開放編輯器可調），缺→打包預設。
      outOfCredit: {
        ...L.credit.outOfCredit,
        flashColor: oc?.flashColor ?? L.credit.outOfCredit.flashColor,
        blinkMs: oc?.blinkMs ?? L.credit.outOfCredit.blinkMs,
        hintText: oc?.hintText ?? L.credit.outOfCredit.hintText,
        hintColor: oc?.hintColor ?? L.credit.outOfCredit.hintColor,
        hintFontSize: oc?.hintFontSize ?? L.credit.outOfCredit.hintFontSize,
        hintOffsetX: oc?.hintOffsetX ?? L.credit.outOfCredit.hintOffsetX,
        hintOffsetY: oc?.hintOffsetY ?? L.credit.outOfCredit.hintOffsetY,
        showCountdown: oc?.showCountdown ?? L.credit.outOfCredit.showCountdown,
      },
    },
    energy: {
      ...L.energy,
      x: ov?.energy?.x ?? L.energy.x,
      y: ov?.energy?.y ?? L.energy.y,
    },
    combo: {
      ...L.combo,
      x: ov?.combo?.x ?? L.combo.x,
      y: ov?.combo?.y ?? L.combo.y,
      fontSize: ov?.combo?.fontSize ?? L.combo.fontSize,
      max: { ...L.combo.max, offsetY: ov?.combo?.maxOffsetY ?? L.combo.max.offsetY },
    },
  } as typeof OVERHEAD_LAYOUT;
}

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
   * 4 格在白↔階段色之間來回閃爍當可放招提示，非靜態）。
   * colorB 已改為「隨階段」(見 stageColors)；此處 colorB 僅作無階段時的 fallback。
   */
  readyFlash: {
    colorA: 0xffffff,
    colorB: 0x66ffcc,
    /** 一次來回（A→B→A）的週期（秒）。 */
    periodSec: 0.5,
  },
  /**
   * 能量格「隨階段變色」調色盤（對齊 Unity PlayerController GetCurrentGaugeColor）：
   * 依當前這輪充滿要放的招階段循環：skill1→黃、skill2→青、ultimate→紅。
   * index 對應 EnergySystem 的 cycleIndex（0/1/2；FULL_SKILL_CYCLE = skill1/skill2/ultimate）。
   */
  stageColors: [
    0xffff00, // 階段0 skill1  = 黃 (Unity Color.yellow)
    0x00ffff, // 階段1 skill2  = 青 (Unity Color.cyan)
    0xff0000, // 階段2 ultimate = 紅 (Unity Color.red)
  ],
} as const;

/**
 * 能量格階段色（純函式，對齊 Unity）：stage 0/1/2 → 黃/青/紅；超出範圍循環（% 3）。
 * 抽成純函式方便單元測試（測騎）。stage 為 EnergySystem.getSkillStage 回傳。
 */
export function energyStageColor(stage: number): number {
  const palette = ENERGY_BAR_LAYOUT.stageColors;
  const idx = ((Math.floor(stage) % palette.length) + palette.length) % palette.length;
  return palette[idx];
}

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

/**
 * JP 介面佈局（對齊 Unity JPPanel，1920×1080 螢幕座標）。
 * 畫面中央橫幅 1600×300 深藍黑底 + 三組（左金/中橘/右紫）水平排，每組：
 * 主題色外框數字框 + 90px 大字金額（主題色）+ 下方 5 顆實心圓燈（暗/亮主題色）。
 * 座標換算 Unity anchoredPos → 螢幕：ScreenX=960+posX、ScreenY=540-posY。
 * 保留 JP 邏輯（JpSystem），此處純外觀/位置。
 */
export const JP_PANEL_LAYOUT = {
  /** 橫幅容器（螢幕座標，左上原點）。 */
  panel: {
    x: 160,
    y: 385,
    width: 1600,
    height: 300,
    /** 背景深藍黑半透明 RGBA(13,13,26,0.7)。 */
    bgColor: 0x0d0d1a,
    bgAlpha: 0.7,
  },
  /** 三組中心（螢幕座標）＋主題色（亮）＋暗色（未點亮）。順序對應 JP_GROUPS[red,blue,purple]=JP1金/JP2橘/JP3紫。 */
  groups: [
    { cx: 440, cy: 564, themeColor: 0xffd600, dimColor: 0x4d4000 }, // JP1 金黃 / 暗金(77,64,0)
    { cx: 960, cy: 561, themeColor: 0xff7333, dimColor: 0x4d220f }, // JP2 橘紅 / 暗橘(77,34,15)
    { cx: 1477, cy: 564, themeColor: 0x9959f2, dimColor: 0x2e1b49 }, // JP3 紫 / 暗紫(46,27,73)
  ],
  /** 每組數字框（相對該組中心）。 */
  amount: {
    borderOffsetY: 40,
    borderWidth: 452,
    borderHeight: 142,
    borderAlpha: 0.9,
    bgWidth: 440,
    bgHeight: 130,
    bgColor: 0x05050d,
    bgAlpha: 0.85,
    cornerRadius: 10,
    fontSize: '90px',
    textOffsetY: 40,
  },
  /** 5 顆實心圓燈（相對該組中心）。 */
  lights: {
    count: 5,
    radius: 28, // size 56×56 → r=28
    posY: -70, // 數字下方一排
    gap: 56, // 五顆 x：-112/-56/0/+56/+112（間距 56 緊貼）
    strokeWidth: 2,
  },
} as const;

/** JP 燈相對 x（對稱、間距 gap）。純函式（可測）。 */
export function jpLightOffsetsX(count: number, gap: number): number[] {
  const xs: number[] = [];
  const mid = (count - 1) / 2;
  for (let i = 0; i < count; i += 1) xs.push((i - mid) * gap);
  return xs;
}

/**
 * JP 面板整體變換預設（用戶要 JP UI 可縮小/挪位）。可 override：
 * panelScale 整體縮放（含三組/燈/數字，內部相對佈局不變）、panelOffsetX/Y 整體位移。
 * 縮放以「Unity 設計面板中心」為原點（縮小仍留在原位不飄），再套位移。
 */
export const JP_TRANSFORM_DEFAULT = {
  panelScale: 1,
  panelOffsetX: 0,
  panelOffsetY: 0,
} as const;

/** JP 面板設計中心（縮放原點）＝橫幅中心。 */
export const JP_PANEL_CENTER = {
  x: JP_PANEL_LAYOUT.panel.x + JP_PANEL_LAYOUT.panel.width / 2, // 960
  y: JP_PANEL_LAYOUT.panel.y + JP_PANEL_LAYOUT.panel.height / 2, // 535
} as const;

/**
 * 解析 JP 面板整體變換（純函式，可測）：把 override 併入預設，
 * 回傳給 JpLampHud 套在容器上的 scale + 容器 position。
 * 容器內元素仍用原始螢幕座標繪製；容器 scale 以 JP_PANEL_CENTER 為原點：
 *   worldPos = center + (localPos - center) * scale + offset
 * 換成容器 transform：container.scale = s；container.position = center*(1-s) + offset。
 */
export function resolveJpTransform(ov?: {
  panelScale?: number;
  panelOffsetX?: number;
  panelOffsetY?: number;
}): { scale: number; posX: number; posY: number } {
  const s = ov?.panelScale ?? JP_TRANSFORM_DEFAULT.panelScale;
  const ox = ov?.panelOffsetX ?? JP_TRANSFORM_DEFAULT.panelOffsetX;
  const oy = ov?.panelOffsetY ?? JP_TRANSFORM_DEFAULT.panelOffsetY;
  return {
    scale: s,
    posX: JP_PANEL_CENTER.x * (1 - s) + ox,
    posY: JP_PANEL_CENTER.y * (1 - s) + oy,
  };
}

/**
 * 關卡進度條整體變換預設（用戶要進度條可縮小/挪位，同 JP 範式）。可 override：
 * progressScale 整體縮放（含進度條/節點/守護金條，內部相對佈局不變）、
 * progressOffsetX/Y 整體位移。縮放以進度條設計中心為原點（縮小留原位不飄）。
 */
export const PROGRESS_TRANSFORM_DEFAULT = {
  progressScale: 1,
  progressOffsetX: 0,
  progressOffsetY: 0,
} as const;

/** 進度條設計中心（縮放原點）＝ progressBars.PROGRESS_BAR 的 centerX/shownY。 */
export const PROGRESS_CENTER = { x: 960, y: 96 } as const;

/**
 * 解析進度條整體變換（純函式，可測；同 resolveJpTransform 範式）。
 * 回傳容器 scale + position：worldPos = center + (local-center)*scale + offset。
 * 換成容器 transform：scale=s；position = center*(1-s) + offset。
 */
export function resolveProgressTransform(ov?: {
  progressScale?: number;
  progressOffsetX?: number;
  progressOffsetY?: number;
}): { scale: number; posX: number; posY: number } {
  const s = ov?.progressScale ?? PROGRESS_TRANSFORM_DEFAULT.progressScale;
  const ox = ov?.progressOffsetX ?? PROGRESS_TRANSFORM_DEFAULT.progressOffsetX;
  const oy = ov?.progressOffsetY ?? PROGRESS_TRANSFORM_DEFAULT.progressOffsetY;
  return {
    scale: s,
    posX: PROGRESS_CENTER.x * (1 - s) + ox,
    posY: PROGRESS_CENTER.y * (1 - s) + oy,
  };
}
