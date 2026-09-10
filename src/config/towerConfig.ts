/**
 * towerConfig — 魔尖塔 preset 表（2 新事件重構：魔尖塔=單獨波次，比照 guardConfig）。
 *
 * 魔尖塔是「單獨波次」（用戶分類）：Event 節點的 eventPresetName 填 tower preset 名（如 Tower4）
 * → 該 Event 節點觸發魔尖塔波（跟守護波 Guard60 完全同模式，非 eventType 子類型、非新 nodeType）。
 * 生成 N 座尖塔、限時內全打完＝過關 / 限時到＝失敗但不 GameOver 進下關。尖塔可額外附加火雨/地雷。
 * 尖塔怪 entity / 環狀技依序固定環執行期＝game-side（征騎，讀 ringSkill）；勝敗判定＝WaveSystem（走既有 advance）。
 */

/** 魔尖塔環狀技參數（對接征騎環狀技執行期算法；尖塔週期放同心環往外擴、命中扣玩家能量+麻痺）。 */
export interface RingSkillParams {
  /** 一次放幾層同心環（>=1 整數）。 */
  ringCount: number;
  /** 最內環半徑（像素；>=0）。 */
  baseRadiusPx: number;
  /** 每層環往外遞增半徑（像素/層；>=0）。第 i 環半徑 = baseRadiusPx + i*radiusStepPx。 */
  radiusStepPx: number;
  /** 每層環出現間隔秒（層與層之間；>0）。 */
  ringIntervalSec: number;
  /** 環厚度（像素，判定帶寬；征騎取半寬 ringThicknessPx/2；>0）。 */
  ringThicknessPx: number;
  /** 命中扣玩家能量段數（>=0）。 */
  energyCost: number;
  /**
   * C9：環真正炸出前先顯示紅色預警圈這麼久（秒；>=0）。節奏（執行期征騎做）：
   * 預警紅圈倒數 warningSec → 完才判定命中+炸特效 → 炸完才開下一環紅圈。省略/0＝無預警立即判定。
   */
  warningSec: number;
  /**
   * ②真空帶半徑（像素，>=0；選填，省略＝沿用 baseRadiusPx）。魂力環最內圈安全區＝真空帶，敵人/環不進此半徑。
   * 用戶要能直接調真空帶大小；征騎 EnemySpawner effectiveBase 拿掉 ×1.25 下限、直接讀此值（省略時退 baseRadiusPx）。
   */
  vacuumRadiusPx?: number;
}

/** 一座塔的位置（場景座標，1920×1080 基準；editor 可拖曳編輯）。 */
export interface TowerPosition {
  x: number;
  y: number;
}

/** 一組魔尖塔參數。 */
export interface TowerPreset {
  /** 尖塔數（>=1 整數）。 */
  towerCount: number;
  /** 限時秒數（限時內打完全部尖塔過關；>0）。 */
  timeLimitSec: number;
  /** 每座尖塔血量（>0）。 */
  towerHp: number;
  /**
   * A3：塔 sprite 縮放倍率（>0，1＝原尺寸）。game-side 征騎照吃設塔 sprite scale。省略＝1（原尺寸）。
   */
  towerScale?: number;
  /**
   * ★真空帶＝塔的 body 碰撞半徑（像素，>=0；選填，省略＝現行預設 ENEMY_BODY_RADIUS_PX×scale，不破舊）。
   * 用戶「真空帶」真義＝物件間碰撞/推擠距離（角色/怪能貼多近塔），非魂力環 ring.vacuumRadiusPx（那是環狀攻擊內圈、另一回事，別混）。
   * 征騎 game-side setTowerCollisionRadius 讀此覆寫塔 radiusPx（getBodyRadius；setTowerScale 只動 sprite 不動 radiusPx，故需獨立可調欄）。
   */
  towerCollisionRadiusPx?: number;
  /**
   * A2：每座塔的位置（場景座標，1920×1080 基準；editor 可滑鼠拖曳編輯疊在場景底圖上）。
   * 省略／長度不足 towerCount → game-side 用預設環形/散佈補足。長度可 != towerCount（前 N 座用設定、其餘預設）。
   */
  positions?: TowerPosition[];
  /**
   * 登場訊息（比照守護波 GuardMessages，additive；省略＝用 TOWER_MESSAGE_DEFAULTS）。
   * resolveTowerMessages 逐欄 ?? 解析；WaveSystem 塔波登場用 EffectSystem timedEventText/guardText 顯示兩段。
   */
  introEventText?: string;
  /** 提示訊息（比照守護波 guardMessageText，如「打掉所有尖塔！」）。 */
  towerMessageText?: string;
  /** 事件宣告大字顯示秒數（比照守護波 eventTextDurationSec；towerGate 對齊此值）。 */
  eventTextDurationSec?: number;
  /**
   * D：塔血條 UI（比照 GUARD_STATUE_UI 的 bar 欄；additive，省略＝TOWER_UI_DEFAULTS）。
   * resolveTowerUi 逐欄 ?? 解析（0-nullish 安全）。game-side 征騎讀解析值繪製塔血條/標籤。
   */
  barWidthPx?: number;
  barHeightPx?: number;
  barOffsetYPx?: number;
  labelOffsetYPx?: number;
  /**
   * E：過關獎勵券數（比照守護波 rewardTickets）。過關 onTowerWaveResult(true) 時 game-side 發寶盒進度/獎券。
   * 省略＝TOWER_UI_DEFAULTS.rewardTickets。
   */
  rewardTickets?: number;
  /**
   * B：開場演出參數（比照守護波，但★走位目標＝中央聚集點，非雕像四角）。additive，省略＝TOWER_INTRO_DEFAULTS。
   * resolveTowerIntro 逐欄 ?? 解析。game-side 征騎讓玩家走到 gatherPoint→聚焦壓黑 introFocusSec→定格。
   */
  introFocusSec?: number;
  spotlightRadiusPx?: number;
  maxWalkSec?: number;
  /** 玩家開場聚集點（場景座標，1920×1080 基準；★塔波＝中央聚集，非守護波四角）。省略＝畫面中央。 */
  gatherPointPx?: TowerPosition;
  /** 環狀技參數（尖塔週期放的環狀攻擊；征騎執行期照吃）。 */
  ringSkill: RingSkillParams;
}

/** 塔波開場演出預設（比照守護波 introFocusSec/spotlightRadiusPx/maxWalkSec；gatherPoint 預設畫面中央）。 */
export const TOWER_INTRO_DEFAULTS = {
  introFocusSec: 3,
  spotlightRadiusPx: 200,
  maxWalkSec: 3.5,
  gatherPointPx: { x: 960, y: 540 }, // 1920×1080 中央（★塔波玩家聚集到中間）
} as const;

/** 解析後的塔波開場演出（全必填）。 */
export interface TowerIntro {
  introFocusSec: number;
  spotlightRadiusPx: number;
  maxWalkSec: number;
  gatherPointPx: TowerPosition;
}

/**
 * 解析塔波開場演出（純函式，抽給測騎；比照守護波開場參數）：preset optional 欄位 ?? 預設。
 * ★0-nullish 安全：用 ?? 非 ||（introFocusSec 可 0＝不壓黑立即）。gatherPointPx 逐軸 ??（x/y 可為 0）。
 */
export function resolveTowerIntro(preset: {
  introFocusSec?: number;
  spotlightRadiusPx?: number;
  maxWalkSec?: number;
  gatherPointPx?: { x?: number; y?: number };
}): TowerIntro {
  return {
    introFocusSec: preset.introFocusSec ?? TOWER_INTRO_DEFAULTS.introFocusSec,
    spotlightRadiusPx: preset.spotlightRadiusPx ?? TOWER_INTRO_DEFAULTS.spotlightRadiusPx,
    maxWalkSec: preset.maxWalkSec ?? TOWER_INTRO_DEFAULTS.maxWalkSec,
    gatherPointPx: {
      x: preset.gatherPointPx?.x ?? TOWER_INTRO_DEFAULTS.gatherPointPx.x,
      y: preset.gatherPointPx?.y ?? TOWER_INTRO_DEFAULTS.gatherPointPx.y,
    },
  };
}

/** 塔血條 UI + 獎勵預設（比照 GUARD_STATUE_UI_DEFAULTS + 守護 rewardTickets）。 */
export const TOWER_UI_DEFAULTS = {
  barWidthPx: 160,
  barHeightPx: 16,
  barOffsetYPx: 90,
  labelOffsetYPx: -80,
  rewardTickets: 10,
} as const;

/** 解析後的塔 UI + 獎勵（全必填）。 */
export interface TowerUi {
  barWidthPx: number;
  barHeightPx: number;
  barOffsetYPx: number;
  labelOffsetYPx: number;
  rewardTickets: number;
}

/**
 * 解析塔血條 UI + 獎勵（純函式，抽給測騎；比照 resolveGuardStatueUi）：preset optional 欄位 ?? 預設。
 * ★0-nullish 安全：用 ?? 非 ||（offsetY 可 0/負、rewardTickets 可 0，不可被 || 吃掉）。
 */
export function resolveTowerUi(preset: {
  barWidthPx?: number;
  barHeightPx?: number;
  barOffsetYPx?: number;
  labelOffsetYPx?: number;
  rewardTickets?: number;
}): TowerUi {
  return {
    barWidthPx: preset.barWidthPx ?? TOWER_UI_DEFAULTS.barWidthPx,
    barHeightPx: preset.barHeightPx ?? TOWER_UI_DEFAULTS.barHeightPx,
    barOffsetYPx: preset.barOffsetYPx ?? TOWER_UI_DEFAULTS.barOffsetYPx,
    labelOffsetYPx: preset.labelOffsetYPx ?? TOWER_UI_DEFAULTS.labelOffsetYPx,
    rewardTickets: preset.rewardTickets ?? TOWER_UI_DEFAULTS.rewardTickets,
  };
}

/** 塔波登場訊息預設（比照 GUARD_MESSAGE_DEFAULTS）。 */
export const TOWER_MESSAGE_DEFAULTS = {
  introEventText: '魔尖塔降臨',
  towerMessageText: '打倒所有魔尖塔！',
  eventTextDurationSec: 3,
} as const;

/** 解析後的塔波訊息（全必填）。 */
export interface TowerMessages {
  introEventText: string;
  towerMessageText: string;
  eventTextDurationSec: number;
}

/**
 * 解析塔波登場訊息（純函式，抽給測騎；比照 resolveGuardMessages）：preset optional 欄位 ?? 預設。
 * ★文字用 ?? 保留（空字串 '' 保留＝用戶可清空文字不退預設；只有 undefined 才退預設）。
 * ★eventTextDurationSec 用 ?? 保留（0 合法＝不顯示/立即，非 || 吃 0）。
 */
export function resolveTowerMessages(preset: {
  introEventText?: string;
  towerMessageText?: string;
  eventTextDurationSec?: number;
}): TowerMessages {
  return {
    introEventText: preset.introEventText ?? TOWER_MESSAGE_DEFAULTS.introEventText,
    towerMessageText: preset.towerMessageText ?? TOWER_MESSAGE_DEFAULTS.towerMessageText,
    eventTextDurationSec: preset.eventTextDurationSec ?? TOWER_MESSAGE_DEFAULTS.eventTextDurationSec,
  };
}

/** 真空帶半徑預設（省略 vacuumRadiusPx 時的 fallback 之一；異靈定案 90）。 */
export const TOWER_VACUUM_RADIUS_DEFAULT = 90;

/**
 * 解析環狀技參數（②真空帶：帶出 vacuumRadiusPx；純函式，抽給測騎）。
 * ★vacuumRadiusPx 省略 → 沿用 baseRadiusPx（再無則 TOWER_VACUUM_RADIUS_DEFAULT）；用 ?? 保留 0 語意。
 * 征騎 EnemySpawner effectiveBase 讀此帶出的 vacuumRadiusPx（拿掉 ×1.25、加 42px 防退化地板 by 征騎）。
 */
export function resolveTowerRingParams(ring: RingSkillParams): RingSkillParams & { vacuumRadiusPx: number } {
  return {
    ...ring,
    vacuumRadiusPx: ring.vacuumRadiusPx ?? ring.baseRadiusPx ?? TOWER_VACUUM_RADIUS_DEFAULT,
  };
}

/** 魔尖塔 preset 表（名稱 key；用戶可在事件編輯器選/編）。Tower4=四塔預設、Tower6=六塔。 */
export const TOWER_PRESETS: Record<string, TowerPreset> = {
  Tower4: {
    towerCount: 4,
    timeLimitSec: 60,
    towerHp: 100,
    ringSkill: { ringCount: 3, baseRadiusPx: 60, radiusStepPx: 40, ringIntervalSec: 0.6, ringThicknessPx: 20, energyCost: 2, warningSec: 0.5, vacuumRadiusPx: 90 },
  },
  Tower6: {
    towerCount: 6,
    timeLimitSec: 75,
    towerHp: 100,
    ringSkill: { ringCount: 3, baseRadiusPx: 60, radiusStepPx: 40, ringIntervalSec: 0.6, ringThicknessPx: 20, energyCost: 2, warningSec: 0.5, vacuumRadiusPx: 90 },
  },
};

/** 內建 fallback（查無魔尖塔 preset 時用，不炸）。 */
export const TOWER_FALLBACK: TowerPreset = TOWER_PRESETS.Tower4;

/**
 * name 是否為（打包）魔尖塔 preset（config 層純函式，不含 override）。
 * ★消費端請用 towerSchema.isResolvedTowerPreset（override-aware）。
 */
export function isTowerPreset(name: string | undefined): boolean {
  return !!name && name in TOWER_PRESETS;
}

/** 依名稱取（打包）魔尖塔 preset（查無回 fallback，不炸）。★消費端請用 towerSchema.getResolvedTowerPreset。 */
export function getTowerPreset(name: string | undefined): TowerPreset {
  return (name && TOWER_PRESETS[name]) || TOWER_FALLBACK;
}
