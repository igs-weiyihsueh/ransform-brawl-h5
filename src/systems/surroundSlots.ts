import { PPU } from '@/config/gameConfig';
import type { Vec2 } from '@/systems/hitDetection';

/**
 * surroundSlots.ts — 槽位同心圓環繞的純幾何/選擇邏輯（移植 Unity SurroundSlotManager，可單元測）。
 *
 * 用戶要「怪物整齊圍著角色排成同心圓」：不是靠 separation 排斥自然攤開（會擠成團、非整齊環繞），
 * 而是顯式把環繞空間切成「同心多層 × 每層等弧長槽位」，敵人 claim 一個槽 → 朝該槽世界座標移動 → 到位停下面向目標。
 *
 * 幾何（全部像素單位；Unity unit × PPU）：
 *  - 層 layer 的環半徑 = baseRadius + layer × layerSpacing（越外層半徑越大）。
 *  - 每層槽數 = max(1, floor(2π × ringRadius / slotArc))（弧長間距一致 → 內圈槽少、外圈槽多）。
 *  - 槽 index 的角度 θ = 2π × index / slotCount，世界座標 = ringCenter + (cosθ, sinθ) × ringRadius。
 *  - ringCenter = 環繞目標的真空圈中心（getVacuumCenter，含腳部 offset；跟視覺真空圈/腳下環同心）。
 *
 * 選擇（就近、內層優先、不繞對側）：
 *  - chooseNearestSlot：從 minLayer 起內層優先，同層選離敵人當前位置最近的空槽。
 *  - tryClaimInnerSlot：持有槽後只「往更內層」主動遞補（前排死→內圈空→外層怪補進來），不被動遞補、不每幀重算（避免抖動）。
 *
 * slotId 編碼 = layer × 1000 + index（Unity 同式），index < 1000 前提（每層槽數遠小於 1000）。
 *
 * 純函式（無 Phaser/無狀態），給測騎測；SurroundSlotManager.ts 持有佔用狀態並呼叫這些函式。
 */

/** 槽位幾何/選擇參數（像素）。預設值照 Unity 值 × PPU。 */
export interface SurroundParams {
  /** 最內層半徑（像素）。Unity baseRadius=0.8unit → 80px（vacuumRadius + 敵人體型參考半徑）。 */
  baseRadius: number;
  /** 層間距（像素）。Unity layerSpacing=0.6unit → 60px。 */
  layerSpacing: number;
  /** 槽弧長間距（像素，≈敵人直徑）。Unity slotArc=0.6unit → 60px。決定每層槽數。 */
  slotArc: number;
  /** 最大層數（layer 0..maxLayers-1）。Unity maxLayers=5。 */
  maxLayers: number;
}

/** 預設參數（照 Unity 值換算像素）。baseRadius 先照 Unity 80px，實測看圖再微調（別寫死係數）。 */
export const DEFAULT_SURROUND_PARAMS: SurroundParams = {
  baseRadius: 0.8 * PPU, // 80
  layerSpacing: 0.6 * PPU, // 60
  slotArc: 0.6 * PPU, // 60
  maxLayers: 5,
};

/** slotId 編碼底數（每層 index 上限；layer × 此 + index）。 */
export const SLOT_ID_BASE = 1000;

/** 到槽判定閾值（像素）：dist<此值=到位停下。Unity slotReachThreshold=0.1unit → 10px。 */
export const SLOT_REACH_THRESHOLD_PX = 0.1 * PPU; // 10

/** 趕路避讓 separation 權重：趕路中（未到槽）較高，繞開彼此不死推。Unity travelerAvoidWeight=0.5。 */
export const TRAVELER_AVOID_WEIGHT = 0.5;

/**
 * 某層的環半徑（像素）：baseRadius + layer × layerSpacing。
 * @param layer 層索引（0 = 最內圈）。
 * @param params 幾何參數。
 */
export function layerRadius(layer: number, params: SurroundParams): number {
  return params.baseRadius + layer * params.layerSpacing;
}

/**
 * 某層的槽數：max(1, floor(2π × ringRadius / slotArc))。
 * 弧長間距一致 → 內圈槽少、外圈槽多；半徑再小也至少 1 槽（避免除零/空層）。
 * @param layer 層索引。
 * @param params 幾何參數。
 */
export function slotCountForLayer(layer: number, params: SurroundParams): number {
  const r = layerRadius(layer, params);
  const count = Math.floor((2 * Math.PI * r) / params.slotArc);
  return Math.max(1, count);
}

/**
 * 槽位的世界座標（像素）：ringCenter + (cosθ, sinθ) × ringRadius，θ = 2π × index / slotCount。
 * @param ringCenter 環中心（環繞目標真空圈中心，像素）。
 * @param layer 層索引。
 * @param index 該層內槽索引（0 起）。
 * @param params 幾何參數。
 */
export function slotWorldPos(
  ringCenter: Vec2,
  layer: number,
  index: number,
  params: SurroundParams,
): Vec2 {
  const r = layerRadius(layer, params);
  const count = slotCountForLayer(layer, params);
  const theta = (2 * Math.PI * index) / count;
  return {
    x: ringCenter.x + Math.cos(theta) * r,
    y: ringCenter.y + Math.sin(theta) * r,
  };
}

/** slotId 編碼：layer × SLOT_ID_BASE + index。 */
export function encodeSlotId(layer: number, index: number): number {
  return layer * SLOT_ID_BASE + index;
}

/** slotId 解碼：{ layer, index }。 */
export function decodeSlotId(slotId: number): { layer: number; index: number } {
  return { layer: Math.floor(slotId / SLOT_ID_BASE), index: slotId % SLOT_ID_BASE };
}

/**
 * 就近選空槽（內層優先 + 同層最近，不繞對側）：
 * 從 minLayer 起逐層往外，每層在「未被佔用」的槽中選離 enemyPos 最近者；
 * 找到就回該 slotId（內層優先 → 一旦某層有空槽就選該層最近的，不再往外找）。全滿回 -1。
 *
 * @param enemyPos 敵人當前位置（像素）——同層挑最近空槽依此，讓敵人就近入位、不繞半圈到對側。
 * @param ringCenter 環中心（像素）。
 * @param occupied 已佔用的 slotId 集合（不含本敵人；本敵人若已持槽由呼叫端決定是否傳入）。
 * @param params 幾何參數。
 * @param minLayer 起始層（小怪 0 內圈優先；菁英 eliteMinLayer=2 排外圈不佔內圈）。
 * @returns 選中的 slotId，或 -1（minLayer..maxLayers-1 全滿）。
 */
export function chooseNearestSlot(
  enemyPos: Vec2,
  ringCenter: Vec2,
  occupied: ReadonlySet<number>,
  params: SurroundParams,
  minLayer: number,
): number {
  const startLayer = Math.max(0, minLayer);
  for (let layer = startLayer; layer < params.maxLayers; layer += 1) {
    const count = slotCountForLayer(layer, params);
    let bestId = -1;
    let bestDistSq = Infinity;
    for (let index = 0; index < count; index += 1) {
      const id = encodeSlotId(layer, index);
      if (occupied.has(id)) continue;
      const pos = slotWorldPos(ringCenter, layer, index, params);
      const dx = pos.x - enemyPos.x;
      const dy = pos.y - enemyPos.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestId = id;
      }
    }
    if (bestId >= 0) return bestId; // 內層優先：此層有空槽就選，不往外找
  }
  return -1; // 全滿
}

/**
 * 主動往更內層遞補（前排死→內圈空→外層怪補進來）：
 * 若敵人當前層 currentLayer > minLayer，且存在「比 currentLayer 更內」的空槽，
 * 回傳最近的更內層空槽 slotId（呼叫端做原子「釋放舊槽 + claim 新槽」）；否則回 -1（不動）。
 *
 * 只往內遞補、不被動遞補、不每幀重算最近槽 → 避免抖動換槽（Unity 關鍵設計）。
 * 菁英 minLayer=eliteMinLayer，不會遞補進 eliteMinLayer 以內（大體型不擠內圈）。
 *
 * @param enemyPos 敵人當前位置（像素）。
 * @param ringCenter 環中心（像素）。
 * @param currentLayer 敵人目前持有槽的層。
 * @param occupied 已佔用 slotId 集合（不含本敵人當前槽——呼叫端須先排除自己，否則自己那格會擋住判斷）。
 * @param params 幾何參數。
 * @param minLayer 最內可到層（小怪 0、菁英 2）。
 * @returns 更內層最近空槽 slotId，或 -1（無更內空槽或已在 minLayer）。
 */
export function tryClaimInnerSlot(
  enemyPos: Vec2,
  ringCenter: Vec2,
  currentLayer: number,
  occupied: ReadonlySet<number>,
  params: SurroundParams,
  minLayer: number,
): number {
  const start = Math.max(0, minLayer);
  if (currentLayer <= start) return -1; // 已在最內可到層，無更內可遞補
  for (let layer = start; layer < currentLayer; layer += 1) {
    const count = slotCountForLayer(layer, params);
    let bestId = -1;
    let bestDistSq = Infinity;
    for (let index = 0; index < count; index += 1) {
      const id = encodeSlotId(layer, index);
      if (occupied.has(id)) continue;
      const pos = slotWorldPos(ringCenter, layer, index, params);
      const dx = pos.x - enemyPos.x;
      const dy = pos.y - enemyPos.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestId = id;
      }
    }
    if (bestId >= 0) return bestId; // 內層優先：更內的空槽優先遞補
  }
  return -1;
}


/**
 * 十六輪③：橫向失衡矯正（純函式，抽給測騎）——怪從單一方向逼近會堆同側、對側空槽沒補（用戶：卡搜索圈下方）。
 * 把環依角度分 4 象限（右/下/左/上，以 ringCenter 為心），統計各象限「已佔槽數」。
 * 只在「明顯失衡」時觸發遷移（保守抗抖，不違 Unity 就近入槽主邏輯，只當附加矯正層）：
 *   - 敵人當前槽所在象限為「最擠」，且存在某象限 count <= 本象限 count − imbalanceThreshold（明顯較空）；
 *   - 在較空象限找離敵人最近的空槽（同層優先：限定與當前槽同層，避免跨層改變環形結構/與 tryClaimInner 打架）。
 * 回傳可遷移的 slotId，或 -1（未失衡/無更空象限空槽/不該動）。呼叫端做原子釋放+claim，並加冷卻。
 *
 * @param enemyPos 敵人當前位置（像素）。
 * @param ringCenter 環中心（像素）。
 * @param currentSlotId 敵人當前持有的 slotId。
 * @param occupied 已佔用 slotId 集合（★需含本敵人當前槽，統計象限擁擠才正確）。
 * @param params 幾何參數。
 * @param imbalanceThreshold 失衡閾值（本象限 − 目標象限 槽數差 >= 此值才遷移，預設 2，保守抗抖）。
 * @returns 遷移目標 slotId，或 -1。
 */
export function tryClaimBalanceSlot(
  enemyPos: Vec2,
  ringCenter: Vec2,
  currentSlotId: number,
  occupied: ReadonlySet<number>,
  params: SurroundParams,
  minLayer: number = 0,
  imbalanceThreshold: number = 1,
): number {
  // 角度→象限 index（0=右 -45..45 / 1=下 45..135 / 2=左 135..-135 / 3=上 -135..-45）。
  const quadOf = (x: number, y: number): number => {
    const deg = (Math.atan2(y - ringCenter.y, x - ringCenter.x) * 180) / Math.PI;
    if (deg >= -45 && deg < 45) return 0; // 右
    if (deg >= 45 && deg < 135) return 1; // 下
    if (deg >= 135 || deg < -135) return 2; // 左
    return 3; // 上
  };

  // 統計各象限已佔槽數（含自己）。
  const counts = [0, 0, 0, 0];
  for (const id of occupied) {
    const { layer, index } = decodeSlotId(id);
    const pos = slotWorldPos(ringCenter, layer, index, params);
    counts[quadOf(pos.x, pos.y)] += 1;
  }

  const curDec = decodeSlotId(currentSlotId);
  const curPos = slotWorldPos(ringCenter, curDec.layer, curDec.index, params);
  const curQuad = quadOf(curPos.x, curPos.y);

  // 只在「本象限是最擠之一」時才考慮遷移（避免本來就空的象限亂遷）。
  const maxCount = Math.max(...counts);
  if (counts[curQuad] < maxCount) return -1; // 本象限非最擠 → 不動

  // 找「明顯較空」象限的空槽（跨層 minLayer..maxLayers，多候選讓下方堆積能遷到上方空位）；
  //   優先同層（維持環形結構）→ 同層無則其它層；同象限內取離敵人最近。
  let bestId = -1;
  let bestScore = Infinity; // score = distSq + 跨層懲罰（優先同層）
  for (let layer = Math.max(0, minLayer); layer < params.maxLayers; layer += 1) {
    const count = slotCountForLayer(layer, params);
    for (let index = 0; index < count; index += 1) {
      const id = encodeSlotId(layer, index);
      if (id === currentSlotId) continue;
      if (occupied.has(id)) continue; // 只遷到空槽
      const pos = slotWorldPos(ringCenter, layer, index, params);
      const q = quadOf(pos.x, pos.y);
      if (counts[q] > counts[curQuad] - imbalanceThreshold) continue; // 該象限不夠空 → 跳過
      const dx = pos.x - enemyPos.x;
      const dy = pos.y - enemyPos.y;
      const layerPenalty = layer === curDec.layer ? 0 : 40000; // 優先同層（跨層加懲罰≈200px²）
      const score = dx * dx + dy * dy + layerPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
  }
  return bestId; // -1=無明顯較空象限的空槽
}
/**
 * 繞圈趨近位移方向（純向量，趕路用）：不是直線穿過中央人群（會互卡），
 * 而是「徑向趨近該層半徑 + 切線繞到槽角度」的混合方向（未正規化的方向，由呼叫端 × 速度）。
 *
 * 作法：
 *  - 徑向分量：把敵人推向「與環中心距離 = 目標槽所在半徑」（比槽半徑遠→往內、近→往外）。
 *  - 切線分量：沿圓周朝目標槽的角度繞行（取較短旋向）。
 *  - 靠近目標槽時（角度差小）徑向為主直接入位；離得遠時切線繞行為主，避免穿過中央。
 *
 * @param enemyPos 敵人當前位置（像素）。
 * @param ringCenter 環中心（像素）。
 * @param slotPos 目標槽世界座標（像素）。
 * @returns 正規化後的移動方向（零向量時回 (0,0)，代表已在槽位）。
 */
export function slotApproachDir(enemyPos: Vec2, ringCenter: Vec2, slotPos: Vec2): Vec2 {
  const ex = enemyPos.x - ringCenter.x;
  const ey = enemyPos.y - ringCenter.y;
  const curR = Math.hypot(ex, ey);
  const targetR = Math.hypot(slotPos.x - ringCenter.x, slotPos.y - ringCenter.y);

  // 敵人幾乎在圈心（curR≈0）：沒有明確徑向 → 直接朝槽位走（避免除零、退化）。
  if (curR < 1e-3) {
    const dx = slotPos.x - enemyPos.x;
    const dy = slotPos.y - enemyPos.y;
    const l = Math.hypot(dx, dy);
    return l < 1e-6 ? { x: 0, y: 0 } : { x: dx / l, y: dy / l };
  }

  // 徑向單位向量（由圈心指向敵人）。
  const rux = ex / curR;
  const ruy = ey / curR;
  // 徑向分量：往目標半徑靠（targetR - curR 正→往外、負→往內）。
  const radial = targetR - curR;
  const radX = rux * radial;
  const radY = ruy * radial;

  // 切線單位向量（垂直徑向，逆時針）。
  const tux = -ruy;
  const tuy = rux;
  // 敵人與目標槽的角度差（帶符號，繞短邊）。
  const enemyAng = Math.atan2(ey, ex);
  const slotAng = Math.atan2(slotPos.y - ringCenter.y, slotPos.x - ringCenter.x);
  let dAng = slotAng - enemyAng;
  while (dAng > Math.PI) dAng -= 2 * Math.PI;
  while (dAng < -Math.PI) dAng += 2 * Math.PI;
  // 切線位移量：沿弧長趨近（curR × 角度差），符號決定繞行方向。
  const tangential = curR * dAng;
  const tanX = tux * tangential;
  const tanY = tuy * tangential;

  const fx = radX + tanX;
  const fy = radY + tanY;
  const fl = Math.hypot(fx, fy);
  if (fl < 1e-6) return { x: 0, y: 0 };
  return { x: fx / fl, y: fy / fl };
}
