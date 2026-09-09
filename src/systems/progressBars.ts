/**
 * progressBars — 進度條純比例/佈局計算（#7/#2，對應 Unity LevelProgressUI 珠子串繩節點條）。
 * 關卡進度 + 節點 marker 佈局 + 守護波倒數。純函式，可測。純視覺讀取；不改 WaveSystem/GuardEvent 邏輯。
 */

/** 進度條表演/佈局參數（螢幕座標，對照 Unity LevelProgressUI）。 */
export const PROGRESS_BAR = {
  /** 每節點寬（Unity perNodeWidth=160）：bar 寬 = 節點數 × 這個。 */
  perNodeWidth: 160,
  /** 進度條中心 X（bar 依節點數以此置中）。 */
  centerX: 960,
  /** 顯示時 bar 的 Y（頂部合理位置；守護/結束往上滑走）。 */
  shownY: 96,
  /** 隱藏時往上滑出的位移（Unity slideHideOffsetY=400，往 JP/上方滑走）。 */
  slideHideOffsetY: 160,
  /** 滑動速度（每秒趨近比例；Unity slideSpeed8）。 */
  slideSpeed: 8,
  /** bar 高（底槽/填充繩）。 */
  barHeight: 16,
  /** 節點圓半徑 / 當前節點放大半徑。 */
  nodeRadius: 22,
  nodeRadiusCurrent: 28,
  /** icon 顯示尺寸（Unity 64×64 picto）。 */
  iconSize: 32,
  /** 當前節點脈動（Unity pulseSpeed5 / pulseAmount0.25，段進度>0.75 才脈）。 */
  pulseSpeed: 5,
  pulseAmount: 0.25,
  pulseThreshold: 0.75,
  /** 守護波倒數條（bar 下方，錯開不重疊）。 */
  guard: { width: 600, height: 16, offsetY: 46 },
  /** 魔尖塔波進度條（剩塔數；bar 下方，比照守護金條位置）。 */
  tower: { width: 600, height: 16, offsetY: 46 },
} as const;

/** 三態節點染色（六輪#6，對照 Unity LevelProgressUI：i<cur 已過黃、i==cur 當前白、i>cur 未到暗）。 */
export const NODE_COLORS = {
  past: 0xfff24d, // 已過/已觸發＝亮黃(維持黃, Unity nodeCurrentColor)；用戶#6：觸發過的一直黃
  current: 0xffffff, // 當前＝白(Unity)
  future: 0x595959, // 未到＝暗灰 rgb(0.35,0.35,0.35)
} as const;

/**
 * 關卡進度比例（0..1）= 已完成節點 / 總節點。
 * nodeIndex 為目前所在節點（0-based），total 為總節點數。
 * 已完成 = nodeIndex（尚未完成當前）；跑到 total（尾端）= 1。
 */
export function levelProgressRatio(nodeIndex: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, nodeIndex / total));
}

/** 守護波倒數比例（0..1）= remaining / timeLimit。 */
export function guardTimeRatio(remaining: number, timeLimit: number): number {
  if (timeLimit <= 0) return 0;
  return Math.min(1, Math.max(0, remaining / timeLimit));
}

/**
 * ★B5 魔尖塔波進度比例（0..1）= 已消滅塔數 / 總塔數。
 * 一開始空（0/N=0）、打掉一座前進一格、全打完＝滿（1）＝過關。純函式（測騎可測）。
 */
export function towerKillRatio(destroyed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, destroyed / total));
}

/** 主進度條可視內容從中心往下最遠的點（節點圓底 + 一點餘裕）。 */
export const PROGRESS_HIDE_MARGIN = 40;

/**
 * 主進度條「完整收起」時 root 的本地 Y（純函式，可測）。
 *
 * bug 修：進度條套了整體變換（scale/offset）後，原本固定的 slideHideOffsetY 往上滑
 * 在「移到下方」或「縮小」時滑走距離不足，收不乾淨。改成依變換反推：
 * 讓進度條可視最低點（root.y 相對 0 + 節點圓半徑 nodeRadiusCurrent）在螢幕上完全移到頂緣之上。
 *
 * xform 下某本地點 Yl 的螢幕 Y = posY + Yl * scale。要求 bar 最低點螢幕 Y ≤ -PROGRESS_HIDE_MARGIN：
 *   posY + (rootY + nodeRadiusCurrent) * scale ≤ -margin
 *   → rootY ≤ (-margin - posY) / scale - nodeRadiusCurrent
 * 取等號為收起目標；scale 夾正數防除零。永遠完整移出畫面頂端，不論位置/縮放。
 */
export function progressHideLocalY(scale: number, posY: number): number {
  const s = Math.max(0.01, scale);
  return (-PROGRESS_HIDE_MARGIN - posY) / s - PROGRESS_BAR.nodeRadiusCurrent;
}

/** 進度條總寬 = 節點數 × perNodeWidth（Unity）。 */
export function barWidth(total: number): number {
  return Math.max(0, total) * PROGRESS_BAR.perNodeWidth;
}

/** 進度條左緣 X（以 centerX 置中）。 */
export function barLeftX(total: number, centerX: number = PROGRESS_BAR.centerX): number {
  return centerX - barWidth(total) / 2;
}

/**
 * 節點 marker 的中心 X（沿 bar 均分，每節點佔 perNodeWidth、置於格中央）。
 * 節點 marker 中心 X（用戶改：首節點貼左盡頭、尾節點貼右盡頭，均分到兩端）。
 * 第 i 個 = barLeftX + i/(count-1) × barWidth（i=0→最左、i=count-1→最右）；count<=1 置中防除0。
 */
export function nodeMarkerX(
  index: number,
  total: number,
  centerX: number = PROGRESS_BAR.centerX,
): number {
  const left = barLeftX(total, centerX);
  const w = barWidth(total);
  if (total <= 1) return left + w / 2; // 特例：單節點置中
  return left + (index / (total - 1)) * w;
}

/** 節點在進度中的狀態（marker 視覺區分用）。 */
export type NodeMarkerState = 'past' | 'current' | 'future';

/**
 * 判斷第 index 個節點相對目前進度（nodeIndex）的狀態：
 * 已過（index < nodeIndex）/ 當前（== nodeIndex）/ 未到（> nodeIndex）。
 */
export function nodeMarkerState(index: number, nodeIndex: number): NodeMarkerState {
  if (index < nodeIndex) return 'past';
  if (index === nodeIndex) return 'current';
  return 'future';
}

/**
 * 節點是否「放大脈動」（六輪#7，對照 Unity LevelProgressUI）：
 * 只「下一顆(index===nodeIndex+1)」在**當前段進度 > pulseThreshold(0.75)** 時脈動（預告即將觸發下一節點）。
 * 修正舊版錯誤：舊版脈動當前節點(index===nodeIndex)=上一顆在動、跟 Unity 反了；改成下一顆(cur+1)脈動。
 */
export function shouldPulse(index: number, nodeIndex: number, segmentRatio: number): boolean {
  return index === nodeIndex + 1 && segmentRatio > PROGRESS_BAR.pulseThreshold;
}

/**
 * 珠子串繩：第 i 段（節點 i → i+1 之間空隙）的填充比例（0..1）。
 * - 段完全在已過區（i+1 <= nodeIndex）→ 1（整段亮）。
 * - 段完全在未來（i >= nodeIndex）→ 0。
 * - 當前段（i == nodeIndex，正從當前節點走向下一節點）→ segmentRatio（0..1，走了多少）。
 * @param i 段索引（0..total-2）。
 * @param nodeIndex 目前節點。
 * @param segmentRatio 當前節點內的推進比例（0..1；WaveSystem 若無細分可傳 0）。
 */
export function segmentFill(i: number, nodeIndex: number, segmentRatio: number): number {
  if (i + 1 <= nodeIndex) return 1; // 整段已過
  if (i < nodeIndex) return 1; // 保險（i === nodeIndex-? ）
  if (i === nodeIndex) return Math.min(1, Math.max(0, segmentRatio)); // 當前段推進
  return 0; // 未來段
}

/** 節點類型（Unity LevelNodeType）→ icon 資源 key 尾綴（'spawn'|'reward'|'event'）。 */
export function nodeIconKind(nodeType: string | undefined): 'spawn' | 'reward' | 'event' {
  if (nodeType === 'Reward') return 'reward';
  if (nodeType === 'Event') return 'event';
  return 'spawn';
}
