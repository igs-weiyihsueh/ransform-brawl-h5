// @vitest-environment node
import { describe, expect, it } from 'vitest';
// ⚠️ 對著波騎 55c6e18 預期簽章預寫（attackSpeedSchema.ts 尚未 land）。land 後讀 src 校準簽章/形狀/version 再 push。
import {
  resolveAttackSpeed,
  validateAttackSpeed,
  ATTACK_SPEED_DEFAULT_MULT,
} from '@/config/attackSpeedSchema';

/**
 * attackSpeedSchema — 攻擊速度倍率開放（用戶第十一輪#1，波騎 55c6e18，additive）。
 * 一個 mult 統一調動畫速度+冷卻+前搖：resolveAttackSpeed(override, baseCooldown?, baseHitDelay?)
 *   → { mult, cooldown: base/mult, hitDelay: base/mult, animTimeScale: mult }。
 *   倍率大 → 冷卻/前搖小(除法)、animTimeScale 大(動畫快)——三者連動。
 * ★mult 語意 = scale（>0 倍率，0/負/非數字不合法），**非** chest/dash 的 0-合法。
 *   0-值辨析譜系再加一個「倍率 0 不合法」（攻擊速度 0=不出手,無意義,擋）。
 * 省略/null/壞/version 錯 → mult=1.0（原節奏 cooldown0.333/hitDelay0.1/anim1）。
 * 維度3 斷連動數值 + validate ok/擋。含壞版必紅(沒擋 mult<=0 / cooldown 方向錯 base×mult / mult 0-合法)。
 * ⚠️ getResolvedAttackSpeed cache + 遊戲端套 anims.timeScale/攻擊冷卻計時接線屬狀態機(需 boot,翼騎 headless 驗)——不補。
 */

const BASE_CD = 0.333; // baseCooldown 哨兵(對齊 combatConfig attackCooldown)
const BASE_HD = 0.1; // baseHitDelay 哨兵(對齊 combatConfig hitDelay)

/** 合法 override（帶 version；land 後若 version 常數名不同再校準）。 */
function overrideMult(mult: unknown): unknown {
  return { version: 1, mult };
}

describe('resolveAttackSpeed — mult 統一連動（cooldown/hitDelay=base/mult, anim=mult）', () => {
  it('★ mult=2 → cooldown=base/2、hitDelay=base/2、animTimeScale=2（變快,三者連動）', () => {
    const r = resolveAttackSpeed(overrideMult(2), BASE_CD, BASE_HD);
    expect(r.mult).toBe(2);
    expect(r.cooldown).toBeCloseTo(0.333 / 2); // 0.1665
    expect(r.hitDelay).toBeCloseTo(0.1 / 2); // 0.05
    expect(r.animTimeScale).toBe(2);
  });

  it('mult=0.5 → cooldown=base/0.5(0.666)、hitDelay=0.2、anim=0.5（變慢）', () => {
    const r = resolveAttackSpeed(overrideMult(0.5), BASE_CD, BASE_HD);
    expect(r.cooldown).toBeCloseTo(0.666);
    expect(r.hitDelay).toBeCloseTo(0.2);
    expect(r.animTimeScale).toBe(0.5);
  });

  it('省略/null/undefined → mult=預設（十六輪打包 default=1.5，cooldown=base/mult、hitDelay=base/mult、anim=mult）', () => {
    for (const ov of [null, undefined]) {
      const r = resolveAttackSpeed(ov, BASE_CD, BASE_HD);
      expect(r.mult).toBe(ATTACK_SPEED_DEFAULT_MULT);
      expect(r.cooldown).toBeCloseTo(BASE_CD / ATTACK_SPEED_DEFAULT_MULT);
      expect(r.hitDelay).toBeCloseTo(BASE_HD / ATTACK_SPEED_DEFAULT_MULT);
      expect(r.animTimeScale).toBe(ATTACK_SPEED_DEFAULT_MULT);
    }
  });

  it('壞/version 錯 override → mult=預設（行為＝fallback 打包 default）', () => {
    expect(resolveAttackSpeed({ garbage: true } as unknown, BASE_CD, BASE_HD).mult).toBe(ATTACK_SPEED_DEFAULT_MULT);
    expect(resolveAttackSpeed('nope' as unknown, BASE_CD, BASE_HD).mult).toBe(ATTACK_SPEED_DEFAULT_MULT);
    expect(resolveAttackSpeed({ version: 2, mult: 2 } as unknown, BASE_CD, BASE_HD).mult).toBe(ATTACK_SPEED_DEFAULT_MULT); // version 錯→不採用
  });

  it('★ cooldown 連動方向：倍率大→冷卻小（mult=2 的 cooldown < mult=1 的 cooldown）', () => {
    const fast = resolveAttackSpeed(overrideMult(2), BASE_CD, BASE_HD).cooldown;
    const normal = resolveAttackSpeed(overrideMult(1), BASE_CD, BASE_HD).cooldown;
    expect(fast).toBeLessThan(normal); // 除法：倍率大冷卻小(非 base×mult 的反向)
  });
});

describe('validateAttackSpeed — ★mult 必須 >0（0/負/非數字擋，跟 scale 同、非 chest/dash 0-合法）', () => {
  it('mult=1（正常）→ ok', () => {
    expect(validateAttackSpeed(overrideMult(1)).ok).toBe(true);
  });
  it('mult=2 / 0.5（正常倍率）→ ok', () => {
    expect(validateAttackSpeed(overrideMult(2)).ok).toBe(true);
    expect(validateAttackSpeed(overrideMult(0.5)).ok).toBe(true);
  });
  it('★ mult=0 → 擋（攻擊速度 0 無意義,倍率 0 不合法；跟 chest/dash 0-合法相反）', () => {
    expect(validateAttackSpeed(overrideMult(0)).ok).toBe(false);
  });
  it('mult=負 → 擋', () => {
    expect(validateAttackSpeed(overrideMult(-1)).ok).toBe(false);
  });
  it('mult=非數字 → 擋', () => {
    expect(validateAttackSpeed(overrideMult('fast')).ok).toBe(false);
  });
});
