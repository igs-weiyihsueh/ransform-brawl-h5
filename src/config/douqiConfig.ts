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
  /**
   * ③爆發：★原地無敵「時間軸多段連打」（v45 割草：非一瞬結算）。每 intervalMs 一段共 hits 段，
   *   每段對 radiusPx 內怪 damagePerHit（擊退 knockback，v45=0 原地狂斬不推怪）+命中 hitstopMs 破頓+閃白+小震+隨機位置斬光。
   */
  burst: {
    hits: number; // 段數（16）
    intervalMs: number; // 每段間隔（55→總~880ms）
    damagePerHit: number; // 每段傷（22，總 16×22=352）
    radiusPx: number; // 每段作用半徑（140，以角色為心）
    knockback: number; // 擊退（0＝原地狂斬不推）
    hitstopMs: number; // 每段命中破頓（55）
    invulnMs: number; // 原地無敵時長（~1180＝hits×interval+300）
    slashScatterPx: number; // 每段斬光隨機散佈半徑（±70）
  };
  /** ④滿連段強化 buff（limited）。 */
  empower: {
    durationMs: number;
    damageMult: number; // ×1.8
    rangeMult: number; // ×1.5
    moveMult: number; // ×1.4（走位/衝刺終點距離）
    dashSpeedMult: number; // ×1.5（衝速 2100）
  };
  /**
   * ★打擊感三元素參數（震動/頓幀；只 douqi 連段技呼，normal 命中路徑完全不碰）。
   *   shakeOnce(intensity,durationSec)。招式中震 skillShake、爆發開場大震 burstOpenShake、爆發每段小震 burstTickShake。
   */
  juice: {
    skillShakeIntensity: number; // 圓/氣波中震強度（0.006）
    skillShakeDurationMs: number; // 80
    burstOpenShakeIntensity: number; // 爆發開場大震（0.009）
    burstOpenShakeDurationMs: number; // 300
    burstTickShakeIntensity: number; // 爆發每段小震（0.006）
    burstTickShakeDurationMs: number; // 60
    hitFlashColor: number; // 命中閃白色（0xffffff）
    hitFlashDurationMs: number; // 80
  };
}

/** ★海牛 v45 連段值。 */
export const DOUQI_COMBO_CONFIG: DouqiComboConfig = {
  maxCombo: 10,
  thresholds: { circle: 3, line: 6, burst: 9, empower: 10 },
  unlockLevel: { empower: 1, circle: 2, line: 4, burst: 6 },
  circle: { radiusPx: 160, damage: 40, knockback: 200, ringColor: 0x00e5ff, ringDurationMs: 280 },
  line: { lengthPx: 420, widthPx: 90, damage: 70, knockback: 260, beamColor: 0xff4d6d, beamDurationMs: 300 },
  burst: { hits: 16, intervalMs: 55, damagePerHit: 22, radiusPx: 140, knockback: 0, hitstopMs: 55, invulnMs: 1180, slashScatterPx: 70 },
  empower: { durationMs: 5000, damageMult: 1.8, rangeMult: 1.5, moveMult: 1.4, dashSpeedMult: 1.5 },
  juice: {
    skillShakeIntensity: 0.006,
    skillShakeDurationMs: 80,
    burstOpenShakeIntensity: 0.009,
    burstOpenShakeDurationMs: 300,
    burstTickShakeIntensity: 0.006,
    burstTickShakeDurationMs: 60,
    hitFlashColor: 0xffffff,
    hitFlashDurationMs: 80,
  },
};

/**
 * ★鬥氣等級雙軌 config（階段 3，海牛 v45）。一條 teamLevel（全隊共用，cap 10），擊殺經驗升級；
 * levelLerp 雙軌：(A) 角色成長（Lv1×lv1Scale→Lv10 滿）、(B) 敵人難度成長（HP/傷/量/間隔隨等級）。
 */
export interface DouqiLevelConfig {
  cap: number;
  /** 每殺一隻基礎經驗（×敵種倍率）。 */
  expPerKillBase: number;
  /** 敵種經驗倍率（tower/npc/anchor=0 不給經驗）。 */
  killExpMult: Record<string, number>;
  /** 升級曲線：expToNext[i]＝從 Lv(i+1) 升 Lv(i+2) 所需（length=cap−1）。 */
  expToNext: number[];
  /** (A) 角色成長 Lv1 倍率（→Lv10 滿值 1.0）。 */
  characterLv1: {
    attackDamage: number; // 普攻傷 ×0.6→滿
    skillDamage: number; // 招傷 ×0.55→滿
    skillRange: number; // 招範圍 ×0.6→滿
    dashHitRadius: number; // 衝撞命中半徑 ×0.6→滿
  };
  /** (B) 敵人難度成長 Lv1 倍率（→Lv10 滿值 1.0）。 */
  difficultyLv1: {
    enemyHp: number; // ×0.35→滿（前期刻意脆）
    enemyDamage: number; // ×0.55→滿
    maxAlive: number; // ×0.5→滿
    spawnInterval: number; // ×1.6(慢)→1.0(快)
  };
}

/** ★海牛 v45 等級雙軌值。 */
export const DOUQI_LEVEL_CONFIG: DouqiLevelConfig = {
  cap: 10,
  expPerKillBase: 10,
  killExpMult: {
    Enemy_Rush: 1, // normal
    Enemy_Elite: 3, // tank/菁英
    Enemy_Tower: 0, // 塔不給經驗
    // shielder2/shooter1.5/charger2/bomber1.8/boss20：怪種齊全後補（10 關 DouqiSpawnSystem 對齊 key）。
  },
  expToNext: [50, 100, 150, 200, 250, 290, 340, 380, 440], // Lv1→2..9→10，總 2200
  characterLv1: { attackDamage: 0.6, skillDamage: 0.55, skillRange: 0.6, dashHitRadius: 0.6 },
  difficultyLv1: { enemyHp: 0.35, enemyDamage: 0.55, maxAlive: 0.5, spawnInterval: 1.6 },
};

/**
 * ★鬥氣怪種數值表 base（階段 3 commit2 config 化備用）。海牛 v45 值。
 * 實際 HP=maxHp×curEnemyHpScale(teamLevel)、傷害×curEnemyDamageScale。
 * ★怪種 pick/byWave 解鎖/成群密度＝10 關流程階段的 DouqiSpawnSystem 才用（現在生怪仍走 WaveSystem 佔位、只套 scale）。
 */
export interface DouqiEnemyStat {
  maxHp: number;
  speed: number;
  radius: number;
  spawnWeight: number;
  unlockWave: number; // byWave 解鎖（10 關階段用）
  frontDamageMult?: number; // shielder 正面減傷
  /** ★鬥氣專屬 base 攻擊傷害（scaleSpawnedEnemy 用 douqi base×等級 scale，非 normal config 極小值）。v45 attackDamage。 */
  attackDamage: number;
  /**
   * ★實際生怪素材 key（spawner.spawn 用）。目前我方只有 Enemy_Rush/Enemy_Ranged/Enemy_Elite 三種素材，
   *  shielder/bomber/charger/boss 尚無專屬素材→暫時 fallback 到現有素材（數值/行為仍走該怪 stat，
   *  待特效手/美術補素材後換真 key）。★DouqiSpawnSystem pickWeightedType 只從 spawnWeight>0 的抽。
   */
  spawnKey: string;
}
export const DOUQI_ENEMY_STATS: Record<string, DouqiEnemyStat> = {
  normal: { maxHp: 90, speed: 70, radius: 14, spawnWeight: 75, unlockWave: 1, attackDamage: 12, spawnKey: 'Enemy_Rush' },
  tank: { maxHp: 200, speed: 40, radius: 22, spawnWeight: 12, unlockWave: 2, attackDamage: 18, spawnKey: 'Enemy_Elite' },
  shooter: { maxHp: 45, speed: 60, radius: 13, spawnWeight: 10, unlockWave: 6, attackDamage: 10, spawnKey: 'Enemy_Ranged' },
  // ★以下尚無專屬素材，暫 fallback（數值走各自 stat/killExpMult 待補；有素材即換 spawnKey）：
  shielder: { maxHp: 100, speed: 58, radius: 16, spawnWeight: 6, unlockWave: 4, frontDamageMult: 0.15, attackDamage: 12, spawnKey: 'Enemy_Rush' },
  bomber: { maxHp: 60, speed: 55, radius: 15, spawnWeight: 8, unlockWave: 5, attackDamage: 22, spawnKey: 'Enemy_Rush' },
  charger: { maxHp: 110, speed: 66, radius: 15, spawnWeight: 0, unlockWave: 99, attackDamage: 14, spawnKey: 'Enemy_Rush' }, // 未啟用（不在表）
  boss: { maxHp: 3000, speed: 46, radius: 42, spawnWeight: 0, unlockWave: 99, attackDamage: 40, spawnKey: 'Enemy_Elite' }, // 階段 5
};

/**
 * ★鬥氣 10 關生怪驅動設定（階段 3 後半 DouqiSpawnSystem）。海牛 v45 值。
 * 難度全靠 teamLevel 雙軌 scale + quota 遞增 + 怪種 byWave 解鎖；關卡自身無額外難度乘數。
 */
export interface DouqiSpawnConfig {
  /** 生怪間隔基準（ms，存活越久越快）。v45 initialIntervalMs=1700。 */
  initialIntervalMs: number;
  /** 每存活秒 interval 遞減（ms）。v45 intervalDecayPerSec=16。 */
  intervalDecayPerSec: number;
  /** interval 下限（ms）。v45 minIntervalMs=650。 */
  minIntervalMs: number;
  /** 同屏敵人上限基準。v45 maxAlive=416。 */
  maxAliveBase: number;
  /** 登場保護時間（ms）：生成後半透明不可傷不可被打。v45 spawnTelegraphMs=420。 */
  spawnTelegraphMs: number;
  /** 生怪離玩家最小距離（px，避免貼臉）。v45 safeDistanceFromPlayer=130。 */
  safeDistanceFromPlayerPx: number;
  /** 生怪離地圖邊緣內縮（px）。v45 edgeInset=90。 */
  edgeInsetPx: number;
  /** 喘息（intermission）時長（ms）。 */
  intermissionMs: number;
  /** quota 基準（第1關）。v45 base=10。 */
  quotaBase: number;
  /** quota 每關成長。v45 growth=8。 */
  quotaGrowth: number;
  /** 第 8/9 關 quota 乘數（BOSS 前壓力）。v45 preBossQuotaMult=1.5。 */
  preBossQuotaMult: number;
  /** quota 上限。v45 cap=90。 */
  quotaCap: number;
  /** 總關數。v45=10（第 10 關 BOSS）。 */
  totalWaves: number;
  /** 事件關（循環內第 N 關，wave%10 命中）。v45 event=[3,5,7]。 */
  eventWaves: readonly number[];
  /** 陣型類型加權（v45 名→我方 FormationType 映射見 DouqiSpawnSystem）。 */
  formationWeights: Record<string, number>;
  /** 陣型成員數範圍（依類型，v45 一陣型 6~25 隻）。 */
  formationCountMin: number;
  formationCountMax: number;
  /** 陣型成員間隔（unit）。 */
  formationSpacingUnit: number;
  /** 等級 → spawnInterval 乘數（Lv1 慢 ×1.6 → Lv10 快 ×1.0；線性內插）。 */
  intervalMultLv1: number;
  intervalMultCap: number;
  /** 等級 → 同屏上限乘數（Lv1 ×0.5 → Lv10 ×1.0）。 */
  maxAliveMultLv1: number;
  maxAliveMultCap: number;
}

/** ★鬥氣 10 關生怪驅動 v45 值。 */
export const DOUQI_SPAWN_CONFIG: DouqiSpawnConfig = {
  initialIntervalMs: 1700,
  intervalDecayPerSec: 16,
  minIntervalMs: 650,
  maxAliveBase: 416,
  spawnTelegraphMs: 420,
  safeDistanceFromPlayerPx: 130,
  edgeInsetPx: 90,
  intermissionMs: 2600,
  quotaBase: 10,
  quotaGrowth: 8,
  preBossQuotaMult: 1.5,
  quotaCap: 90,
  totalWaves: 10,
  eventWaves: [3, 5, 7],
  formationWeights: { matrix: 20, ring: 24, line: 16, wedge: 14, doubleRing: 12, scatter: 14 },
  formationCountMin: 6,
  formationCountMax: 25,
  formationSpacingUnit: 0.9,
  intervalMultLv1: 1.6,
  intervalMultCap: 1.0,
  maxAliveMultLv1: 0.5,
  maxAliveMultCap: 1.0,
};

/**
 * ★鬥氣三事件設定（階段 4）。海牛 v45 值。事件關（eventWaves 循環內 3/5/7）達 quota 後啟動；
 * 成功獎勵 dropCount+expKills+banner；失敗無獎勵但仍過關（不重來不扣血）。
 */
export interface DouqiTowerEventConfig {
  baseHp: number; // 塔 base HP（×(1+(wave-1)×hpGrowthPerWave)×curEnemyHpScale）
  hpGrowthPerWave: number;
  radiusPx: number; // 塔判定半徑
  spawnIntervalMs: number; // 塔生怪間隔
  spawnBatch: number; // 每次生幾隻
  spawnAroundPx: number; // 塔周圍生怪半徑
  // 四扇形 fanBlast
  fanCount: number; // 扇形數
  fanArcDeg: number; // 每扇形弧度（留縫）
  fanRadiusPx: number; // 扇形半徑（塔中心往外）
  fanFillMs: number; // 填滿預警時長→填滿瞬間發射
  fanDamage: number; // 命中傷害（走二段能量倒扣）
  fanRootMs: number; // 命中定身
  fanCycleMs: number; // 每組間隔
}
export interface DouqiGuardEventConfig {
  npcHp: number;
  radiusPx: number;
  spawnIntervalMs: number;
  spawnBatch: number;
  npcAttackCooldownMs: number; // 每隻怪對 NPC 攻擊冷卻
  durationMs: number; // 撐過即成功
}
export interface DouqiCaptureEventConfig {
  captureRadiusPx: number;
  waveSize: number; // 每波生幾隻
  spawnInsideRatio: number; // 生在圈心此比例半徑內
  waveGapMs: number; // 圈內清空後隔多久出下波
  progressPerSec: number; // 在圈+無怪時推進/秒
  timeLimitMs: number; // 限時
}
export interface DouqiEventRewardConfig {
  dropCount: number; // 掉道具數
  dropRingPx: number; // 場中心周圍環半徑
  expKills: number; // 等效擊殺經驗數（≈expKills×normal killExp）
}

export const DOUQI_TOWER_EVENT_CONFIG: DouqiTowerEventConfig = {
  baseHp: 2000,
  hpGrowthPerWave: 0.12,
  radiusPx: 34,
  spawnIntervalMs: 800,
  spawnBatch: 2,
  spawnAroundPx: 300,
  fanCount: 4,
  fanArcDeg: 48,
  fanRadiusPx: 520,
  fanFillMs: 2000,
  fanDamage: 24,
  fanRootMs: 2000,
  fanCycleMs: 3200,
};
export const DOUQI_GUARD_EVENT_CONFIG: DouqiGuardEventConfig = {
  npcHp: 1600,
  radiusPx: 26,
  spawnIntervalMs: 550,
  spawnBatch: 2,
  npcAttackCooldownMs: 1000,
  durationMs: 30000,
};
export const DOUQI_CAPTURE_EVENT_CONFIG: DouqiCaptureEventConfig = {
  captureRadiusPx: 340,
  waveSize: 5,
  spawnInsideRatio: 0.85,
  waveGapMs: 1800,
  progressPerSec: 12,
  timeLimitMs: 45000,
};
export const DOUQI_EVENT_REWARD_CONFIG: DouqiEventRewardConfig = {
  dropCount: 4,
  dropRingPx: 60,
  expKills: 20,
};

/**
 * ★鬥氣 BOSS 設定（階段 5，第10關最終王）。海牛 v45 值。★BOSS 招 a 圓/c 扇形/d 半場 = towerRingSkill/技能三層
 * 形狀區域 telegraph→fire pattern（塔四扇形做過）；固定場中央不動；HP 接 teamLevel curEnemyHpScale。
 */
export interface DouqiBossConfig {
  maxHp: number; // base HP（×(1+(bossCount-1)×hpGrowthPerBoss)×curEnemyHpScale）
  hpGrowthPerBoss: number;
  radiusPx: number;
  skillFillMs: number; // 招填滿預警時長→填滿發射
  skillDamage: number; // a/c/d 命中傷害（走 curEnemyDamageScale）
  skillRootMs: number; // a/c/d 命中定身
  skillGapMs: number; // ★招間隔（從釋放完起算，非蓄力開始）
  // a 圓
  aRadiusPx: number;
  // c 扇形
  cRangePx: number;
  cArcDeg: number; // 250°（留 110°缺口）
  // d 左右半場接力
  dHalfOverlap: number; // 左半 fill 到此比例時右半開始 fill
  // 空檔 gap 球
  gapBallIntervalMs: number;
  gapBallSpeedPxPerSec: number;
  gapBallRadiusPx: number;
  gapBallDamage: number;
  // 掉道具
  dropCount: number; // 打倒掉幾個
  dropDistPx: number; // 打倒掉落環半徑
  dropEveryDamage: number; // 每累積受此傷→掉 1
  dropScatterPx: number; // 過程掉落散佈
}
export const DOUQI_BOSS_CONFIG: DouqiBossConfig = {
  maxHp: 3000,
  hpGrowthPerBoss: 0.15,
  radiusPx: 42,
  skillFillMs: 4000,
  skillDamage: 30,
  skillRootMs: 2000,
  skillGapMs: 3000,
  aRadiusPx: 260,
  cRangePx: 500,
  cArcDeg: 250,
  dHalfOverlap: 0.5,
  gapBallIntervalMs: 900,
  gapBallSpeedPxPerSec: 320,
  gapBallRadiusPx: 12,
  gapBallDamage: 15,
  dropCount: 4,
  dropDistPx: 170,
  dropEveryDamage: 600,
  dropScatterPx: 90,
};
