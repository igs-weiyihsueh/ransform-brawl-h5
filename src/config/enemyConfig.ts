import type { AttackData } from '@/systems/AttackData';
import { SPRITE_SCALE } from '@/config/combatConfig';

/**
 * 敵人 AI 設定（資料驅動，全部對照 Unity 數值）。
 *
 * 單位為 Unity world unit（除非另註）；用到時 ×PPU 換像素。
 * 之後要加新敵人，在 ENEMY_AI 加一筆即可，Enemy entity 不用改。
 */

/** 敵人攻擊方式：近戰圓形判定 or 射出射彈。 */
export type EnemyAttackKind = 'melee' | 'projectile';

/**
 * 一般波敵人登場預警時間（秒，對應 Unity spawnWarningDuration=3）：
 * 生成點先冒預警圈淡入這麼久 → 怪才原地出現（非場邊走進）。守護波不用（維持場邊走進）。
 */
export const SPAWN_WARNING_DURATION_SEC = 3;

/**
 * 敵人碰撞 body 半徑基準（像素，用戶試玩#1#2a 根治）：取代舊「256 frame 半徑」(134px, 含大量透明 padding)。
 * 量測 Enemy_Rush 非透明 bbox ≈113px 寬（可視半寬 ~56px，×SPRITE_SCALE），取角色核心 body ~45px 當基準
 * （比全可視半寬略緊、對齊攻擊形狀 reach，讓真空帶=視覺圈、怪停攻擊形狀內能攻擊）。依 perCharScale 縮放（菁英大隻 body 也大）。
 */
export const ENEMY_BODY_RADIUS_PX = 45;

/**
 * 視覺 body 中心相對 sprite 幾何中心的向下偏移（像素，五輪#4）：
 * sprite frame(256×SPRITE_SCALE) 上方留白、角色美術畫在 frame 下半 → sprite 幾何中心(getHitCenter)
 * 在角色胸口/頭上方、比可見 body 中心高。範圍攻擊圓心(預警圈+爆發+傷害判定)應以「可見 body 中心」為圓心，
 * 菁英/近戰才在圈正中央（用戶#4：菁英不在正中心）。
 * 從 SPRITE_SCALE 算（對齊 FOOT_GLOW.offsetYPx=72×SPRITE_SCALE 到腳底的同套 frame 幾何；body 中心約腳底一半高）非寫死。
 * 再依 perCharScale 縮放（菁英大隻偏移也大）。subagent 看圖迭代係數到「置中」。
 */
export const ENEMY_BODY_CENTER_OFFSET_Y = 40 * SPRITE_SCALE; // ≈42（72×scale 到腳底的約一半，body 中心）

export interface EnemyAIConfig {
  /** 對應動畫角色 key（也決定 perCharScale）。 */
  characterKey: string;
  hp: number;
  /** 移動速度（unit/s）。 */
  moveSpeed: number;
  /** 偵測範圍（unit）：進入才開始追。 */
  detectRange: number;
  /** 攻擊範圍（unit）：進入就停下、開始蓄力出手。 */
  attackRange: number;
  /** 蓄力時間（秒）：進入攻擊距離後，播 attack 前的前搖。 */
  chargeTime: number;
  /** 攻擊冷卻（秒）。 */
  attackCooldown: number;
  /** 攻擊方式。 */
  attackKind: EnemyAttackKind;
  /** 攻擊資料（近戰用形狀/半徑/offset；射彈用 damage/knockback，形狀給射彈碰撞半徑）。 */
  attack: AttackData;
  /**
   * 出手視覺類型（三輪#12 修回歸）：
   * - 'slash'（預設/省略）：揮斬斬光（衝鋒/一般近戰）。
   * - 'aoe'：圓形範圍預告圈+爆發（真大範圍敵人，如菁英）。
   * ⚠️ 不可用 attack.shapeType 判斷——所有近戰都是 meleeCircle(shapeType='circle')，那是命中形狀非視覺語意。
   * 射彈(projectile)不吃此欄（有自己的射彈視覺，不播 slash/aoe）。
   */
  attackVfx?: 'slash' | 'aoe' | 'fan';
  /**
   * 十六輪②：攻擊只朝水平（左右）——true 時出手方向/攻擊圓 offset/揮砍 fx 皆 clamp 到水平 facing，
   * 排除正上/正下垂直攻擊（衝鋒怪，類玩家 ec318b03 水平限制）。省略/false=可朝 aim 全向（原行為）。
   */
  horizontalAttackOnly?: boolean;
  /** 射彈速度（unit/s），attackKind='projectile' 時使用。 */
  projectileSpeed?: number;
  /**
   * 體型縮放（第十輪#3，enemy-editor 大小欄位遊戲端型別）：override 優先。
   * 省略 → fallback getPerCharScale(characterKey)（舊行為）。scaleFactor 一改全動 body 半徑/攻擊圓/視覺（所見即所得）。
   */
  scale?: number;
  /** 受擊硬直時間（秒）。 */
  hitStun: number;
  /** 被擊退力道（對應玩家 knockback 語意：unit → 像素/秒等效）。 */
  knockbackForce: number;
  /**
   * 防穿透抗性（像牆，用戶 #4）：true = 玩家頂不動這隻（immovable），改成玩家自己被擋在敵人外。
   * 菁英 Enemy_Elite=true（Unity hitStun=0.05 幾乎不退像牆）；一般敵人省略/false 照舊被頂開。
   */
  immovable?: boolean;
}

/** 近戰圓形攻擊的 AttackData 輔助。 */
const meleeCircle = (
  radius: number,
  offsetX: number,
  damage: number,
  knockback: number,
): AttackData => ({
  shapeType: 'circle',
  radius,
  offsetX,
  offsetY: 0,
  damage,
  hitDelay: 0, // 敵人用 chargeTime 當前搖，出手當下即判定
  knockback,
});

export const ENEMY_AI: Record<string, EnemyAIConfig> = {
  // 衝鋒兵（近戰）
  Enemy_Rush: {
    characterKey: 'Enemy_Rush',
    hp: 3,
    moveSpeed: 2,
    detectRange: 11.5,
    attackRange: 2,
    chargeTime: 1,
    attackCooldown: 2,
    attackKind: 'melee',
    // 十六輪設定打包：用戶匯出的衝鋒兵攻擊形狀＝扇形(fan, radius 1.1, angle 115, offsetY 0.05)。
    attack: {
      shapeType: 'fan',
      radius: 1.1,
      offsetX: 0.35,
      offsetY: 0.05,
      damage: 10,
      hitDelay: 0,
      knockback: 3,
      angle: 115,
    },
    attackVfx: 'fan', // 七輪：衝鋒兵出手播扇形揮砍 fx_enemy_fan(取代通用 slash)
    horizontalAttackOnly: true, // 十六輪②：衝鋒怪攻擊只朝左右(排除正上/正下垂直攻擊，類玩家 ec318b03)——程式 bug 修，設定匯出不含故沿用保留
    hitStun: 1,
    knockbackForce: 3,
  },
  // 遠程兵（射彈）
  Enemy_Ranged: {
    characterKey: 'Enemy_Ranged',
    hp: 2,
    moveSpeed: 1.5,
    detectRange: 14,
    attackRange: 2.5,
    chargeTime: 2,
    attackCooldown: 4,
    attackKind: 'projectile',
    // 射彈：radius 當射彈碰撞半徑；offset 讓射彈從身體前方生成。
    attack: {
      shapeType: 'circle',
      radius: 0.2,
      offsetX: 0.75,
      offsetY: 0.05,
      damage: 15,
      hitDelay: 0,
      knockback: 2,
    },
    projectileSpeed: 10,
    hitStun: 1,
    knockbackForce: 2,
  },
  // 菁英兵（大範圍坦）
  Enemy_Elite: {
    characterKey: 'Enemy_Elite',
    hp: 10,
    moveSpeed: 1,
    detectRange: 20,
    attackRange: 2,
    chargeTime: 2.5,
    attackCooldown: 3.5,
    attackKind: 'melee',
    attack: meleeCircle(2, 0, 25, 2),
    attackVfx: 'aoe', // 菁英=大範圍坦 → 圓形 AOE 預告圈+爆發(三輪#12：只此類走純 AOE，衝鋒兵走 slash)
    hitStun: 0.15, // 幾乎不退，像牆
    knockbackForce: 2,
    immovable: true, // 防穿透豁免：玩家頂不動菁英，改成玩家被擋在菁英外（用戶 #4，對應像牆）
    scale: 1.85, // 十六輪設定打包：用戶匯出菁英放大 1.85
  },
};
