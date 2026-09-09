/**
 * waveMessage — 波次/關卡節點過場提示文字（純函式，#9）。
 * 依節點類型回過場訊息；純視覺，不涉及波次邏輯/數值。可測。
 */
import type { LevelNodeData } from '@/config/levelSchema';
import { isTowerPreset } from '@/config/towerConfig';
import { isFireRainPreset } from '@/config/fireRainConfig';
import { GUARD_PRESETS } from '@/config/guardConfig';

/** 過場提示表演參數（螢幕中央文字：淡入放大→停留→淡出）。 */
export const WAVE_MESSAGE_FX = {
  /** 總持續秒數。 */
  durationSec: 1.6,
  /** 停留（不淡出）比例，之後淡出。 */
  holdRatio: 0.6,
  fontSize: 64,
} as const;

/**
 * 節點 → 過場提示文字。
 * @param node 進入的節點。
 * @param waveNumber Spawn 節點的第幾波（1-based，呼叫端給累計波序）。
 * @returns 提示文字；無對應（如 Reward 可選）回空字串（呼叫端空字串不顯示）。
 */
export function waveMessageFor(node: LevelNodeData, waveNumber: number): string {
  switch (node.nodeType) {
    case 'Spawn':
      return `第 ${waveNumber} 波`;
    case 'Event': {
      // 單一架構：純 eventPresetName 判提示（火雨→火雨、tower→魔尖塔、guard preset→守護波、其餘一般事件→通用「事件！」）。
      const en = node.eventPresetName ?? '';
      if (isTowerPreset(en)) return '魔尖塔！打掉尖塔！';
      if (isFireRainPreset(en)) return '天降火雨！';
      if (en in GUARD_PRESETS) return '守護波！保護雕像！';
      return '事件！';
    }
    case 'Reward':
      return '過關！';
    default:
      return '';
  }
}
