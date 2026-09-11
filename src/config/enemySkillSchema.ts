/**
 * enemySkillSchema — 敵人技能三層（Skill / BulletShooter / Bullet）資料格式 + 驗證 + resolve（純函式、零 Phaser）。
 * 怪物 AI 移植第 1 塊（鬥破規格第 7 節）。★與玩家 skillSchema.ts（角色連段/能量）不同域——此為敵人 AI 彈幕技能。
 * 比照 enemySchema/towerSchema：型別自洽、resolve* 逐欄 ?? 補預設、validate 大聲失敗。
 *
 * ★三契約：本檔純資料/驗證，不碰世界座標/命中/registry（那些在 BulletShooter runtime + EnemySpawner）。
 * ★第 1 塊只需「一般怪單招直線」：Skill 單份 + 單 Phase + BulletShooter 1 顆 + Bullet 直線。
 *   欄位以規格第 7 節命名（Boss 多招/多 Phase/追蹤/曲線之後擴充，欄位先留 optional 不改名）。
 */
import type { BulletMovementType, BulletLifetime } from '@/systems/bulletMath';

// ---- Bullet（最底層：一顆子彈的資料）--------------------------------------
export interface BulletDef {
  /** 速度（unit/s）。 */
  speedUnits: number;
  /** 碰撞半徑（unit）。 */
  radiusUnits: number;
  /** 傷害。 */
  damage: number;
  /** 擊退。 */
  knockback: number;
  /** 運動型別（預設 straight）。 */
  movementType?: BulletMovementType;
  /** 壽命三態（距離為主，offset-無關）。 */
  lifetime?: BulletLifetime;
  /** 追蹤參數（movementType='tracking' 時用）。 */
  trackingRangeUnits?: number;
  rotationSpeedDegPerSec?: number;
  /** 子彈/命中特效引用（key 字串；先可省，特效手素材到再填）。 */
  vfxKey?: string;
  hitVfxKey?: string;
}

// ---- BulletShooter（中層：一次發射幾顆、如何展開）--------------------------
export interface BulletShooterDef {
  /** 每次射幾顆。 */
  bulletsPerShot: number;
  /** 多顆之間的射擊間隔（秒；0=同時齊發）。 */
  intervalSec: number;
  /** 展開總角度（度；多顆以 aim 為中心對稱分佈，0=全同向）。 */
  spreadDeg: number;
  /** 子彈定義。 */
  bullet: BulletDef;
}

// ---- Skill（頂層：能力名、冷卻、觸發 Phase）--------------------------------
export interface SkillPhaseDef {
  /** 觸發前延遲（秒）。 */
  delaySec: number;
  /** 觸發機率（0..1；1=必觸發）。 */
  probability: number;
  /** 此 Phase 用的發射器。 */
  shooter: BulletShooterDef;
}

export interface EnemySkillDef {
  /** 能力名（debug/引用）。 */
  abilityName: string;
  /** 冷卻（秒）。 */
  cooldownSec: number;
  /** 觸發階段（一般怪 1 個；Boss 多個連段）。 */
  phases: SkillPhaseDef[];
}

// ---- 驗證 -----------------------------------------------------------------
export type ValidateEnemySkillResult =
  | { ok: true; data: EnemySkillDef }
  | { ok: false; errors: string[] };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
function asObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}
function checkNum(obj: Record<string, unknown>, key: string, label: string, errors: string[], min?: number): void {
  const v = obj[key];
  if (!isFiniteNumber(v)) errors.push(`${label}「${key}」缺少或非數字。`);
  else if (min !== undefined && v < min) errors.push(`${label}「${key}」=${v} 不可小於 ${min}。`);
}

function validateBullet(raw: unknown, label: string, errors: string[]): void {
  const b = asObject(raw);
  if (!b) { errors.push(`${label} 的「bullet」缺少或不是物件。`); return; }
  checkNum(b, 'speedUnits', `${label} bullet`, errors, 0);
  checkNum(b, 'radiusUnits', `${label} bullet`, errors, 0);
  checkNum(b, 'damage', `${label} bullet`, errors, 0);
  checkNum(b, 'knockback', `${label} bullet`, errors, 0);
  if (b.movementType !== undefined && b.movementType !== 'straight' && b.movementType !== 'tracking') {
    errors.push(`${label} bullet.movementType="${String(b.movementType)}" 不合法（straight / tracking）。`);
  }
}

function validateShooter(raw: unknown, label: string, errors: string[]): void {
  const s = asObject(raw);
  if (!s) { errors.push(`${label} 的「shooter」缺少或不是物件。`); return; }
  checkNum(s, 'bulletsPerShot', `${label} shooter`, errors, 1);
  checkNum(s, 'intervalSec', `${label} shooter`, errors, 0);
  checkNum(s, 'spreadDeg', `${label} shooter`, errors, 0);
  validateBullet(s.bullet, `${label} shooter`, errors);
}

/** 驗證單一敵人 Skill（大聲失敗、精準定位）。 */
export function validateEnemySkill(json: unknown): ValidateEnemySkillResult {
  const errors: string[] = [];
  const sk = asObject(json);
  if (!sk) return { ok: false, errors: ['敵人技能必須是物件 { abilityName, cooldownSec, phases }。'] };
  if (!isNonEmptyString(sk.abilityName)) errors.push('敵人技能「abilityName」缺少或非非空字串。');
  checkNum(sk, 'cooldownSec', '敵人技能', errors, 0);
  const phases = sk.phases;
  if (!Array.isArray(phases) || phases.length === 0) {
    errors.push('敵人技能「phases」缺少或為空陣列（至少 1 個 Phase）。');
  } else {
    phases.forEach((p, i) => {
      const ph = asObject(p);
      const label = `敵人技能 phases[${i}]`;
      if (!ph) { errors.push(`${label} 必須是物件。`); return; }
      checkNum(ph, 'delaySec', label, errors, 0);
      checkNum(ph, 'probability', label, errors, 0);
      if (isFiniteNumber(ph.probability) && ph.probability > 1) errors.push(`${label}「probability」=${ph.probability} 不可大於 1。`);
      validateShooter(ph.shooter, label, errors);
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: json as EnemySkillDef };
}

// ---- resolve（逐欄 ?? 補預設，0-nullish 安全）------------------------------
/** Bullet 預設（一般怪直線單顆）。 */
export const DEFAULT_BULLET: Required<Pick<BulletDef, 'speedUnits' | 'radiusUnits' | 'damage' | 'knockback' | 'movementType'>> = {
  speedUnits: 6,
  radiusUnits: 0.25,
  damage: 1,
  knockback: 0,
  movementType: 'straight',
};

/** 解析 Bullet（逐欄 ??；壽命預設飛行距離 12 unit + 命中 1）。 */
export function resolveBullet(def?: Partial<BulletDef>): BulletDef {
  return {
    speedUnits: def?.speedUnits ?? DEFAULT_BULLET.speedUnits,
    radiusUnits: def?.radiusUnits ?? DEFAULT_BULLET.radiusUnits,
    damage: def?.damage ?? DEFAULT_BULLET.damage,
    knockback: def?.knockback ?? DEFAULT_BULLET.knockback,
    movementType: def?.movementType ?? DEFAULT_BULLET.movementType,
    lifetime: {
      distanceUnits: def?.lifetime?.distanceUnits ?? 12,
      timeSec: def?.lifetime?.timeSec,
      maxHits: def?.lifetime?.maxHits ?? 1,
    },
    trackingRangeUnits: def?.trackingRangeUnits,
    rotationSpeedDegPerSec: def?.rotationSpeedDegPerSec,
    vfxKey: def?.vfxKey,
    hitVfxKey: def?.hitVfxKey,
  };
}

/** 解析 BulletShooter（逐欄 ??；預設單顆齊發不展開）。 */
export function resolveShooter(def?: Partial<BulletShooterDef>): BulletShooterDef {
  return {
    bulletsPerShot: def?.bulletsPerShot ?? 1,
    intervalSec: def?.intervalSec ?? 0,
    spreadDeg: def?.spreadDeg ?? 0,
    bullet: resolveBullet(def?.bullet),
  };
}

/**
 * 由現有敵人 projectile 攻擊參數建「等效單招直線」Skill（升級接線用，行為對齊現況）。
 * 一般怪單招：1 Phase、無延遲、必觸發、1 顆直線子彈，速度/半徑/傷害/擊退來自現有欄。
 */
export function enemySkillFromProjectileAttack(p: {
  speedUnits: number;
  radiusUnits: number;
  damage: number;
  knockback: number;
  cooldownSec: number;
}): EnemySkillDef {
  return {
    abilityName: 'BasicShot',
    cooldownSec: p.cooldownSec,
    phases: [
      {
        delaySec: 0,
        probability: 1,
        shooter: resolveShooter({
          bulletsPerShot: 1,
          intervalSec: 0,
          spreadDeg: 0,
          bullet: {
            speedUnits: p.speedUnits,
            radiusUnits: p.radiusUnits,
            damage: p.damage,
            knockback: p.knockback,
            movementType: 'straight',
          },
        }),
      },
    ],
  };
}
