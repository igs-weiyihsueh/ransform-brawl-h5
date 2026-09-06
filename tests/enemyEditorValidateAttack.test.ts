// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateEnemies, SHAPE_TYPES } from '../enemy-editor/enemySchema';

/**
 * enemy-editor/enemySchema validateAttack 攻擊形狀驗證（用戶#2 怪物編輯器攻擊範圍 + 扇形，翼騎 9e50b3d 整合波騎）。
 * shape=circle(radius) / rectangle(length+width) / ★fan(radius+angle, angle≤360, 新增)。
 * validateAttack 為 module-private → 透過公開 validateEnemies(整檔) 入口測（餵合法敵人只換 attack）。
 * 維度3 斷實際驗證過/擋。含壞版必紅（fan 缺 angle / angle>360 / 白名單漏 fan）。
 * ⚠️ 這是 enemy-editor 前端驗證純函式（波騎領域、已進 main），零 Phaser、走相對路徑 import。
 */

/** 一份合法敵人共同欄位（不含 attack 的形狀特定欄位）。 */
function baseAttack(): Record<string, unknown> {
  return {
    shapeType: 'circle',
    radius: 45,
    offsetX: 0,
    offsetY: 0,
    damage: 10,
    hitDelay: 0.1,
    knockback: 5,
  };
}

/** 用給定 attack 覆寫，包成合法單敵檔丟 validateEnemies。 */
function fileWithAttack(attack: Record<string, unknown>): unknown {
  return {
    version: 1,
    enemies: {
      Test: {
        characterKey: 'Enemy_Rush',
        hp: 30,
        moveSpeed: 3,
        detectRange: 30,
        attackRange: 5,
        chargeTime: 0.5,
        attackCooldown: 1,
        hitStun: 0.2,
        knockbackForce: 5,
        attackKind: 'melee',
        attack,
      },
    },
  };
}

/** 驗證並回錯誤陣列（ok 時空陣列）。 */
function errorsOf(file: unknown): string[] {
  const r = validateEnemies(file);
  return r.ok ? [] : r.errors;
}
/** 任一錯誤是否提到某 token（如 'angle'、'shapeType'）。 */
function mentions(errs: string[], token: string): boolean {
  return errs.some((e) => e.includes(token));
}

describe('enemy-editor validateAttack — 攻擊形狀（circle / rectangle / fan）', () => {
  it('白名單三種形狀 = circle/rectangle/fan（含新增 fan）', () => {
    expect([...SHAPE_TYPES]).toEqual(['circle', 'rectangle', 'fan']);
  });

  it('circle：有 radius → 過', () => {
    expect(validateEnemies(fileWithAttack({ ...baseAttack(), shapeType: 'circle', radius: 45 })).ok).toBe(
      true,
    );
  });

  it('rectangle：有 length + width → 過', () => {
    const a = { ...baseAttack(), shapeType: 'rectangle', length: 80, width: 40 };
    delete a.radius;
    expect(validateEnemies(fileWithAttack(a)).ok).toBe(true);
  });

  it('★ fan（扇形，新增）：有 radius + angle 且 angle≤360 → 過', () => {
    const a = { ...baseAttack(), shapeType: 'fan', radius: 45, angle: 90 };
    expect(validateEnemies(fileWithAttack(a)).ok).toBe(true);
    // 邊界：angle 恰 360 → 過（≤360）。
    const a360 = { ...baseAttack(), shapeType: 'fan', radius: 45, angle: 360 };
    expect(validateEnemies(fileWithAttack(a360)).ok).toBe(true);
  });

  // 🔴 壞版對照：fan 缺 angle → 擋（沒驗 angle 會誤過）。
  it('★ 壞版對照：fan 缺 angle → 擋（錯誤提到 angle）', () => {
    const a = { ...baseAttack(), shapeType: 'fan', radius: 45 }; // 無 angle
    const errs = errorsOf(fileWithAttack(a));
    expect(errs.length).toBeGreaterThan(0);
    expect(mentions(errs, 'angle')).toBe(true);
  });

  // 🔴 壞版對照：fan angle>360 → 擋（上限沒 gate 會誤過）。
  it('★ 壞版對照：fan angle > 360 → 擋（錯誤提到 angle 與 360）', () => {
    const a = { ...baseAttack(), shapeType: 'fan', radius: 45, angle: 361 };
    const errs = errorsOf(fileWithAttack(a));
    expect(errs.length).toBeGreaterThan(0);
    expect(mentions(errs, 'angle')).toBe(true);
    expect(mentions(errs, '360')).toBe(true);
  });

  it('fan angle 負數 → 擋（min 0）', () => {
    const a = { ...baseAttack(), shapeType: 'fan', radius: 45, angle: -10 };
    expect(mentions(errorsOf(fileWithAttack(a)), 'angle')).toBe(true);
  });

  // 🔴 壞版對照：亂名 shape（非白名單三種）→ 擋，錯誤列出合法三種。
  it('壞版對照：亂名 shapeType → 擋（錯誤提到 shapeType 且列 circle/rectangle/fan）', () => {
    const a = { ...baseAttack(), shapeType: 'triangle' };
    const errs = errorsOf(fileWithAttack(a));
    expect(mentions(errs, 'shapeType')).toBe(true);
    expect(mentions(errs, 'fan')).toBe(true); // 訊息列出合法三種含 fan
  });
});
