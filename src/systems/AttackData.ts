/**
 * AttackData — 描述一次攻擊的判定形狀與效果，對齊 Unity 的攻擊設定。
 *
 * 所有幾何數值單位為 Unity world unit（未乘角色 scale）。
 * 之後可直接用同結構的 JSON 餵進來（一招一筆），不用改程式。
 *
 * shapeType:
 *  - 'rectangle'：矩形判定，用 length(長，沿面向)、width(寬)。
 *  - 'circle'：圓形判定，用 radius。
 *  - 'fan'：扇形判定，用 radius + angle(度)：面向前方半徑內、與面向夾角 <= angle/2。
 *
 * 判定中心 = 攻擊者位置 + 面向 × offsetX + (0, offsetY)，最後整體 × 角色 scale。
 */
export interface AttackData {
  /** 判定形狀。 */
  shapeType: 'rectangle' | 'circle' | 'fan';
  /** 矩形長邊（沿面向方向），unit。shapeType='rectangle' 時使用。 */
  length?: number;
  /** 矩形寬邊，unit。shapeType='rectangle' 時使用。 */
  width?: number;
  /** 圓形/扇形半徑，unit。shapeType='circle'|'fan' 時使用。 */
  radius?: number;
  /** 扇形總張角（度）。shapeType='fan' 時使用；命中需與面向夾角 <= angle/2。 */
  angle?: number;
  /** 判定中心相對攻擊者、沿面向方向的偏移，unit。 */
  offsetX: number;
  /** 判定中心的垂直偏移，unit。 */
  offsetY: number;
  /** 命中造成的傷害。 */
  damage: number;
  /** 按下攻擊後多久(秒)才做命中判定（模擬揮擊前搖）。 */
  hitDelay: number;
  /** 命中時對目標的擊退力道。 */
  knockback: number;
  /** 播放的攻擊特效 key（對應 VFX_EFFECTS / vfx/<key>/）。未設則不播特效。 */
  vfxKey?: string;
}
