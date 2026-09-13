/**
 * douqiConfig — 鬥氣模式操控參數（階段 1 commit2）。★值＝海牛《鬥氣割草》v45 實際值（異靈轉，對齊手感）。
 * 全 config 化：日後微調一檔改、不動邏輯。
 *
 * ★核心模型（v45）：移動+攻擊合一。speed=0（無普通走路，移動全靠衝刺）；每次按攻擊＝觸發一次衝刺，
 *   唯一限制 attackCooldownMs=160（防連點瞬移）。衝刺期間護盾無敵。能量/連段技在階段 2 獨立。
 */
export interface DouqiControlConfig {
  /** 融合瞄準錐半角（度）；滑鼠方向 ±此角內選角度差最小者鎖定，超出→指空地走位。v45=35。 */
  aimConeHalfAngleDeg: number;
  /** 錐鎖範圍（px）；超出不納入鎖定候選。v45 searchRadius=560。 */
  searchRadiusPx: number;
  /** 黏著目標放棄距離（px）；已鎖目標離開超此→放棄。v45 loseTargetRadius=620。 */
  loseTargetRadiusPx: number;
  /** 黏著中重選夾角（度）；滑鼠與已鎖目標夾角 > 此才重選。v45 switchAngleDeg=35。 */
  switchAngleDeg: number;
  /** 滑鼠靜止自動鎖最近的視窗（ms）；靜止 > 此→自動鎖最近可傷怪。v45 aimActiveWindowMs=700。 */
  aimActiveWindowMs: number;
  /** 道具有效角度差乘數（<1 略優先）。v45 itemAimPriorityMult=0.7。 */
  itemAimPriorityMult: number;
  /** 衝刺速度（px/s）。v45 dashSpeed=1400（強化 ×dashSpeedMult1.5=2100，強化屬階段 2）。 */
  dashSpeedPxPerSec: number;
  /** 指空地走位衝刺距離（px）。v45 dashDistance=320。 */
  dashDistancePx: number;
  /** 衝刺路徑偵測命中半徑（px，×等級 scale 0.6~1；階段 1 用基準）。v45 dashHitRadius=32。 */
  dashHitRadiusPx: number;
  /** 角色碰撞半徑（px）。v45 radius=16。 */
  bodyRadiusPx: number;
  /** 衝到多近停下揮擊（px）。v45 attackReach=44。 */
  attackReachPx: number;
  /** 揮擊命中半徑（px）。v45 attackHitRadius=42。 */
  attackHitRadiusPx: number;
  /** 揮擊傷害（餵進現有 applyAttackDamage/takeHit）。v45 attackDamage=36。 */
  attackDamage: number;
  /** 揮擊擊退（餵進現有 takeHit）。v45 knockback=380。 */
  knockback: number;
  /** 攻擊冷卻（ms）：唯一移動節流（防連點瞬移）。v45 attackCooldownMs=160。 */
  attackCooldownMs: number;
  /** 滑鼠靜止判定閾值（px）：pointer 兩幀位移 < 此值視為靜止（配合 aimActiveWindowMs）。 */
  pointerIdleEpsilonPx: number;
}

/** ★海牛 v45 實際值（異靈轉）。 */
export const DOUQI_CONTROL_CONFIG: DouqiControlConfig = {
  aimConeHalfAngleDeg: 35,
  searchRadiusPx: 560,
  loseTargetRadiusPx: 620,
  switchAngleDeg: 35,
  aimActiveWindowMs: 700,
  itemAimPriorityMult: 0.7,
  dashSpeedPxPerSec: 1400,
  dashDistancePx: 320,
  dashHitRadiusPx: 32,
  bodyRadiusPx: 16,
  attackReachPx: 44,
  attackHitRadiusPx: 42,
  attackDamage: 36,
  knockback: 380,
  attackCooldownMs: 160,
  pointerIdleEpsilonPx: 3,
};

/**
 * ★鬥氣連段技 config（階段 2，海牛《鬥氣割草》v45 值）。★普通模式不掛不觸發、只 douqi。
 *
 * combo 累積＝普攻揮擊命中 +1（命中次數計，一次掃幾隻只 +1；連段技 AOE 命中【不】累積 combo）。
 * 無時間衰減、達 max 歸零重來。門檻+teamLevel 雙條件（達 combo 門檻【且】等級到才觸發）；各技無獨立 cooldown（靠 combo 門檻節流）。
 */
export interface DouqiComboConfig {
  /** combo 上限（達此歸零重來）。v45=10。 */
  maxCombo: number;
  /** 觸發門檻（combo ≥）。 */
  thresholds: { circle: number; line: number; burst: number; empower: number };
  /** 解鎖等級（teamLevel ≥）。 */
  unlockLevel: { circle: number; line: number; burst: number; empower: number };
  /** ①圓形斬：中心圓 AOE。 */
  circle: { radiusPx: number; damage: number; knockback: number; ringColor: number; ringDurationMs: number };
  /** ②直線氣波：朝 aimAngle 矩形貫穿。 */
  line: { lengthPx: number; widthPx: number; damage: number; knockback: number; beamColor: number; beamDurationMs: number };
  /** ③爆發：原地無敵多段亂打段數（清場解圍、擊退不變）。 */
  burst: { hits: number };
  /** ④滿連段強化 buff（limited）。 */
  empower: {
    durationMs: number;
    damageMult: number; // ×1.8
    rangeMult: number; // ×1.5
    moveMult: number; // ×1.4（走位/衝刺終點距離）
    dashSpeedMult: number; // ×1.5（衝速 2100）
  };
}

/** ★海牛 v45 連段值。 */
export const DOUQI_COMBO_CONFIG: DouqiComboConfig = {
  maxCombo: 10,
  thresholds: { circle: 3, line: 6, burst: 9, empower: 10 },
  unlockLevel: { empower: 1, circle: 2, line: 4, burst: 6 },
  circle: { radiusPx: 160, damage: 40, knockback: 200, ringColor: 0x00e5ff, ringDurationMs: 280 },
  line: { lengthPx: 420, widthPx: 90, damage: 70, knockback: 260, beamColor: 0xff4d6d, beamDurationMs: 300 },
  burst: { hits: 16 },
  empower: { durationMs: 5000, damageMult: 1.8, rangeMult: 1.5, moveMult: 1.4, dashSpeedMult: 1.5 },
};
