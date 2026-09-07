import type { EnemyType } from '@/config/levelSchema';

/**
 * guardConfig.ts — 守護波（Guard Event）設定（對照 Unity，決策 76f235e4）。
 * 用「名稱 key」查預設（非解析數字），找不到用內建 fallback 不炸。
 *
 * ⚠️ 守護的敵人 drip 參數（maxAlive/spawnThreshold/spawnInterval/spawns）放在 preset 裡，
 *    不加到「凍結的」levelSchema.EventNodeData（EventNodeData 只有 nodeType+eventPresetName）。
 *    Event 節點 JSON 只需 eventPresetName，守護的怪配置全由此 preset 決定，schema 不動。
 */

export interface GuardSpawnEntry {
  enemyType: EnemyType;
  weight: number;
}

export interface GuardPreset {
  /** 時間限制（秒）：量條由時間扣、撐過即勝。 */
  timeLimit: number;
  /** 雕像 HP：被敵人攻擊扣，歸 0 提早結束（敗）。 */
  targetHP: number;
  /**
   * 勝利基礎獎券。⚠️ 目前守護成功改給寶盒進度（佔位，決策 76f07f64），此欄位暫未使用；
   * 保留供之後正式 JP 燈號/彩金獎勵可能沿用或改欄位。
   */
  rewardTickets: number;
  /** drip：場上維持的敵人數上限。 */
  maxAlive: number;
  /** drip：存活數 < 此值才補怪。 */
  spawnThreshold: number;
  /** drip：補怪間隔（秒）。 */
  spawnInterval: number;
  /** drip：敵種權重表。 */
  spawns: GuardSpawnEntry[];
  /** 生成環繞雕像的半徑（像素）。 */
  spawnRadiusPx: number;
  /**
   * 七輪#2：以下 4 欄原為 GuardEvent.ts hardcode 常數，搬進 preset 以支援單獨編輯（對照 Unity GuardPreset）。
   * 打包預設值 = 原常數值（行為不變）。
   */
  /** 玩家定位雕像四角的 X 偏移（像素，對照 Unity cornerOffsetX；原 GUARD_CORNER_OFFSET_PX=150）。 */
  cornerOffsetXPx: number;
  /** 玩家定位雕像四角的 Y 偏移（像素，對照 Unity cornerOffsetY；原 GUARD_CORNER_OFFSET_PX=150）。 */
  cornerOffsetYPx: number;
  /** 開場聚焦壓暗持續（秒，對照 Unity introFocusSeconds；原 GUARD_FOCUS_SEC=1.6）。 */
  introFocusSec: number;
  /** 導引走位最長時間（秒，逾時強制就位，對照 Unity maxWalkSeconds；原 GUARD_MOVE_TIMEOUT_SEC=3.5）。 */
  maxWalkSec: number;
  /** 聚焦 spotlight 亮圈半徑（像素，對照 Unity spotlightRadius；原傳 200）。 */
  spotlightRadiusPx: number;
  /**
   * 附帶火雨（用戶試玩#2，preset 內含非 schema）：火雨 preset 名（FIRE_RAIN_PRESETS 的 key，
   * 如 'FireRain'/'FireRainLight'/'FireRainHeavy'）→ 守護波同時降該種火雨（守護+火雨）。
   * 省略(undefined)=無火雨。（升級自舊 boolean：舊 true 語意=標準 'FireRain'。）
   */
  attachFireRain?: string;
  /**
   * 第十輪#1#4：雕像大小 / 血條 UI（optional，additive；省略＝用 GUARD_STATUE_UI_DEFAULTS）。
   * 由 resolveGuardStatueUi(preset) 逐欄 ?? 解析（0-nullish 安全）。GuardTarget 讀解析值繪製。
   */
  /** 雕像顯示高度（像素，等比縮放；hitRadius=顯示寬/2 跟著變→雕像大更好打，與 #2 shouldEnterCharge 協調）。預設 150。 */
  statueHeightPx?: number;
  /** 血條寬（像素）。#1 血條放大＝預設調大到 160（原 hardcode 100）。 */
  barWidthPx?: number;
  /** 血條高（像素）。預設 16（原 hardcode bg 12/fill 10）。 */
  barHeightPx?: number;
  /** 血條相對雕像中心的 Y 偏移（像素，正=下方）。預設 90。 */
  barOffsetYPx?: number;
  /** 「守護目標」標籤相對雕像中心的 Y 偏移（像素，負=上方）。預設 -80。 */
  labelOffsetYPx?: number;
  /**
   * 第十四輪：守護波訊息可編輯（optional，additive；省略＝用 GUARD_MESSAGE_DEFAULTS）。
   * 由 resolveGuardMessages(preset) 逐欄 ?? 解析。EffectSystem timedEventText/guardText 讀解析值。
   * ★空字串 '' 語意：用 ?? 保留（'' 視為「顯示空字串/不顯示文字」，讓用戶可清空；不退回預設）。
   */
  /** 限時事件開場文字（走位階段，EffectSystem timedEventText）。預設「限時事件」。 */
  introEventText?: string;
  /** 協力守護訊息文字（聚焦階段，EffectSystem guardText）。預設「協力合作，守護雕像」。 */
  guardMessageText?: string;
  /** 限時事件文字顯示秒數（>=0，0=不顯示/立即）。預設 3。 */
  eventTextDurationSec?: number;
}

/**
 * 雕像 / 血條 UI 打包預設（第十輪#1#4）。#1 血條放大：barWidthPx 100→160、barHeightPx 12/10→16。
 * statueHeightPx 150＝原 hardcode（雕像大小可由 preset override 調大）。
 */
export const GUARD_STATUE_UI_DEFAULTS = {
  statueHeightPx: 150,
  barWidthPx: 160,
  barHeightPx: 16,
  barOffsetYPx: 90,
  labelOffsetYPx: -80,
} as const;

/** 解析後的雕像/血條 UI（全必填像素值）。 */
export interface GuardStatueUi {
  statueHeightPx: number;
  barWidthPx: number;
  barHeightPx: number;
  barOffsetYPx: number;
  labelOffsetYPx: number;
}

/**
 * 解析雕像/血條 UI（純函式，抽給測騎；同 resolveGuardDrip 模式）：preset optional 欄位 ?? 預設。
 * ★0-nullish 安全：用 ?? 非 ||（offsetY 可為 0/負值，不可被 || 當 falsy 吃掉）。
 * @param preset 守護 preset（statueHeightPx?/barWidthPx?/barHeightPx?/barOffsetYPx?/labelOffsetYPx? 皆 optional）。
 */
export function resolveGuardStatueUi(preset: {
  statueHeightPx?: number;
  barWidthPx?: number;
  barHeightPx?: number;
  barOffsetYPx?: number;
  labelOffsetYPx?: number;
}): GuardStatueUi {
  return {
    statueHeightPx: preset.statueHeightPx ?? GUARD_STATUE_UI_DEFAULTS.statueHeightPx,
    barWidthPx: preset.barWidthPx ?? GUARD_STATUE_UI_DEFAULTS.barWidthPx,
    barHeightPx: preset.barHeightPx ?? GUARD_STATUE_UI_DEFAULTS.barHeightPx,
    barOffsetYPx: preset.barOffsetYPx ?? GUARD_STATUE_UI_DEFAULTS.barOffsetYPx,
    labelOffsetYPx: preset.labelOffsetYPx ?? GUARD_STATUE_UI_DEFAULTS.labelOffsetYPx,
  };
}

/** 守護波訊息打包預設（第十四輪：文字+時長可編）。原 EffectSystem hardcode 值。 */
export const GUARD_MESSAGE_DEFAULTS = {
  introEventText: '限時事件',
  guardMessageText: '協力合作，守護雕像',
  eventTextDurationSec: 3,
} as const;

/** 解析後的守護波訊息（全必填）。 */
export interface GuardMessages {
  introEventText: string;
  guardMessageText: string;
  eventTextDurationSec: number;
}

/**
 * 解析守護波訊息（純函式，抽給測騎；同 resolveGuardStatueUi 模式）：preset optional 欄位 ?? 預設。
 * ★文字用 ?? 保留（空字串 '' 保留＝讓用戶可清空文字，不退回預設；只有 undefined 才退預設）。
 * ★eventTextDurationSec 用 ?? 保留（0 合法＝不顯示/立即，非 || 吃 0）。
 */
export function resolveGuardMessages(preset: {
  introEventText?: string;
  guardMessageText?: string;
  eventTextDurationSec?: number;
}): GuardMessages {
  return {
    introEventText: preset.introEventText ?? GUARD_MESSAGE_DEFAULTS.introEventText,
    guardMessageText: preset.guardMessageText ?? GUARD_MESSAGE_DEFAULTS.guardMessageText,
    eventTextDurationSec: preset.eventTextDurationSec ?? GUARD_MESSAGE_DEFAULTS.eventTextDurationSec,
  };
}

const DEFAULT_GUARD_SPAWNS: GuardSpawnEntry[] = [
  { enemyType: 'Enemy_Rush', weight: 0.7 },
  { enemyType: 'Enemy_Ranged', weight: 0.2 },
  { enemyType: 'Enemy_Elite', weight: 0.1 },
];

/** 守護波預設表（名稱 key）。preset 帶齊守護所需一切（含 drip），schema 不動。 */
export const GUARD_PRESETS: Record<string, GuardPreset> = {
  Guard60: {
    timeLimit: 60,
    targetHP: 100,
    rewardTickets: 10,
    maxAlive: 6,
    spawnThreshold: 4,
    spawnInterval: 1.0,
    spawns: DEFAULT_GUARD_SPAWNS,
    spawnRadiusPx: 350,
    cornerOffsetXPx: 150,
    cornerOffsetYPx: 150,
    introFocusSec: 1.6,
    maxWalkSec: 3.5,
    spotlightRadiusPx: 200,
    attachFireRain: 'FireRain', // 六輪#1真解(異靈定):preset 預設=標準 FireRain(沒設 node 的守護波也有感火雨,比 Light 密)。editor 可 per-node 覆蓋(EventNodeData.attachFireRain 三態:省略沿用此/'none'無/指定 preset 名如 FireRainHeavy)。只設 preset 預設名、不動 preset 內部數值。
  },
};

/** 內建 fallback（查無預設時用，不炸）。 */
export const GUARD_FALLBACK: GuardPreset = {
  timeLimit: 60,
  targetHP: 100,
  rewardTickets: 10,
  maxAlive: 6,
  spawnThreshold: 4,
  spawnInterval: 1.0,
  spawns: DEFAULT_GUARD_SPAWNS,
  spawnRadiusPx: 350,
  cornerOffsetXPx: 150,
  cornerOffsetYPx: 150,
  introFocusSec: 1.6,
  maxWalkSec: 3.5,
  spotlightRadiusPx: 200,
};

/** 依名稱取守護預設（查無回 fallback）。 */
export function getGuardPreset(name: string | undefined): GuardPreset {
  return (name && GUARD_PRESETS[name]) || GUARD_FALLBACK;
}

/** 守護補怪 drip 有效值（七輪：node per-node 覆蓋 preset）。 */
export interface GuardDrip {
  maxAlive: number;
  spawnThreshold: number;
  spawnInterval: number;
  spawns: GuardSpawnEntry[];
}

/**
 * 解析守護補怪 drip（純函式，抽給測騎）：per-node 覆蓋 preset（node.X ?? preset.X）。
 * ★0-nullish 安全：用 ?? 非 ||（maxAlive/spawnThreshold=0 是合法值，不可被 || 當 falsy 吃掉）。
 * spawns：node.spawns 有給（且非空陣列）→ 用 node 的；否則 preset.spawns。
 * @param node Event 節點的 optional drip（maxAlive?/spawnThreshold?/spawnInterval?/spawns?）；欄位省略＝沿用 preset。
 * @param preset 該守護 preset（getResolvedGuardPreset）。
 */
export function resolveGuardDrip(
  node: { maxAlive?: number; spawnThreshold?: number; spawnInterval?: number; spawns?: GuardSpawnEntry[] } | undefined,
  preset: GuardPreset,
): GuardDrip {
  const n = node ?? {};
  return {
    maxAlive: n.maxAlive ?? preset.maxAlive,
    spawnThreshold: n.spawnThreshold ?? preset.spawnThreshold,
    spawnInterval: n.spawnInterval ?? preset.spawnInterval,
    spawns: n.spawns && n.spawns.length > 0 ? n.spawns : preset.spawns,
  };
}

/** 依權重從 preset.spawns 挑一種敵種。 */
export function pickGuardEnemy(
  spawns: GuardSpawnEntry[],
  rng: () => number = Math.random,
): EnemyType {
  let total = 0;
  for (const s of spawns) total += Math.max(0, s.weight);
  if (total <= 0) return spawns[0]?.enemyType ?? 'Enemy_Rush';
  let r = rng() * total;
  for (const s of spawns) {
    r -= Math.max(0, s.weight);
    if (r < 0) return s.enemyType;
  }
  return spawns[spawns.length - 1].enemyType;
}

/**
 * 守護波側邊生成內縮（像素，對照 Unity guardSideSpawnInset=2 units×PPU）：
 * 從場地左/右緣往中間內縮此距離生成（「走進來」感、不緊貼邊）。
 */
export const GUARD_SIDE_SPAWN_INSET_PX = 2 * 100; // 2 units × PPU(100) = 200

/**
 * 守護波側邊生成點（三輪#9，對照 Unity EnemySpawnerRuntime.FindGuardSideSpawnPos）：
 * 左右交替、X=場地左/右緣±inset、Y=場地 Y 範圍隨機。純函式（side 由 nextLeft 決定，翻轉在呼叫端）。
 * @param nextLeft true=這隻生左側、false=右側（呼叫端每次生成後翻轉→兩側平均）。
 * @param bounds 場地邊界 {minX,maxX,minY,maxY}（像素）。
 * @param insetPx 邊緣內縮（預設 GUARD_SIDE_SPAWN_INSET_PX）。
 * @param marginPx Y 上下邊距（避免貼頂/底，預設 60）。
 * @param rng 隨機源（預設 Math.random）。
 * @returns 生成點 {x,y}（已 clamp 在界內）。
 */
export function guardSideSpawnPoint(
  nextLeft: boolean,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  insetPx = GUARD_SIDE_SPAWN_INSET_PX,
  marginPx = 60,
  rng: () => number = Math.random,
): { x: number; y: number } {
  const rawX = nextLeft ? bounds.minX + insetPx : bounds.maxX - insetPx;
  const x = Math.max(bounds.minX, Math.min(bounds.maxX, rawX)); // clamp 界內
  const yMin = Math.min(bounds.minY + marginPx, bounds.maxY);
  const yMax = Math.max(bounds.maxY - marginPx, yMin);
  const y = yMin + rng() * (yMax - yMin);
  return { x, y };
}
