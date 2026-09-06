// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveDash, dashDistance, validateDash, defaultDashFile } from '@/config/dashSchema';
import type { DashConfig } from '@/config/dashSchema';

/**
 * dashSchema — 衝刺範圍可調：dash-editor 套用→localStorage override→遊戲讀（翼騎 53d0e03，同 resolveEnemies/resolveSkills 模式）。
 * 簽章(讀 src 53d0e03)：
 *   resolveDash(override:unknown, packaged=DASH_CONFIG) → null/undefined→packaged；validateDash.ok?override.dash:packaged。
 *   dashDistance(speed,duration) = speed × duration。
 *   validateDash：speed/duration/damage/knockback/radius 皆 checkNum{min:0}（numeric，0 合法、負不合法）。
 * 維度3 斷 resolve 選擇 + dashDistance 值。含壞版必紅 + ★0-value 合法不被 fallback。
 * ⚠️ getResolvedDash cache + 6 消費點接線屬狀態機(需 boot,翼騎 headless override 0.15 生效驗)——不補;resolveDash/dashDistance 純函式補足。
 */

/** 哨兵 packaged：辨識回 override 還是打包預設。 */
const SENTINEL: DashConfig = { speed: 111, duration: 0.111, damage: 111, knockback: 111, radius: 111 };

/** 合法 override（改 speed，證明用的是 override）。 */
function validOverrideWithSpeed(speed: number): unknown {
  const file = defaultDashFile();
  file.dash.speed = speed;
  return file;
}

describe('dashDistance — speed × duration', () => {
  it('= speed × duration（15×0.15=2.25、8×0.2=1.6）', () => {
    expect(dashDistance(15, 0.15)).toBeCloseTo(2.25);
    expect(dashDistance(8, 0.2)).toBeCloseTo(1.6);
    expect(dashDistance(0, 0.2)).toBe(0);
    expect(dashDistance(10, 0)).toBe(0);
  });
});

describe('resolveDash — override 優先 / null·壞 fallback packaged（同 resolveEnemies）', () => {
  it('★ 合法 override（過 validateDash）→ 回 override.dash（dash-editor 套用生效）', () => {
    const file = validOverrideWithSpeed(999);
    expect(validateDash(file).ok).toBe(true);
    const r = resolveDash(file, SENTINEL);
    expect(r.speed).toBe(999); // 用 override 的值
    expect(r).not.toBe(SENTINEL);
  });

  it('★ override=null / undefined → 回 packaged（無 override 行為不變）', () => {
    expect(resolveDash(null, SENTINEL)).toBe(SENTINEL);
    expect(resolveDash(undefined, SENTINEL)).toBe(SENTINEL);
  });

  it('★ override 壞（validate 失敗：欄位型別錯/負值/缺 dash/非物件）→ 回 packaged（fallback 不炸）', () => {
    const badType = defaultDashFile();
    (badType.dash as unknown as Record<string, unknown>).speed = 'fast';
    expect(validateDash(badType).ok).toBe(false);
    expect(resolveDash(badType, SENTINEL)).toBe(SENTINEL);

    const neg = defaultDashFile();
    neg.dash.radius = -5; // min 0 → 不合法
    expect(validateDash(neg).ok).toBe(false);
    expect(resolveDash(neg, SENTINEL)).toBe(SENTINEL);

    expect(resolveDash({ version: 1 }, SENTINEL)).toBe(SENTINEL); // 缺 dash
    expect(resolveDash('garbage', SENTINEL)).toBe(SENTINEL);
    expect(resolveDash(123, SENTINEL)).toBe(SENTINEL);
  });

  it('★ 0-value 合法不被 fallback：damage=0 / knockback=0 / radius=0 → 過 validate、用 override（min:0 含 0，非 truthiness）', () => {
    const file = defaultDashFile();
    file.dash.damage = 0;
    file.dash.knockback = 0;
    file.dash.radius = 0;
    expect(validateDash(file).ok).toBe(true); // 0 合法
    const r = resolveDash(file, SENTINEL);
    expect(r).not.toBe(SENTINEL); // 沒被誤 fallback
    expect(r.damage).toBe(0);
    expect(r.knockback).toBe(0);
    expect(r.radius).toBe(0);
  });

  it('負值才不合法（min:0）：speed=0 過、speed=-1 擋', () => {
    const zero = defaultDashFile();
    zero.dash.speed = 0;
    expect(validateDash(zero).ok).toBe(true); // 0 合法
    const neg = defaultDashFile();
    neg.dash.speed = -1;
    expect(validateDash(neg).ok).toBe(false); // 負不合法
  });

  it('override 不同 speed → 各自回該值（非恆 packaged）', () => {
    expect(resolveDash(validOverrideWithSpeed(10), SENTINEL).speed).toBe(10);
    expect(resolveDash(validOverrideWithSpeed(20), SENTINEL).speed).toBe(20);
  });
});
