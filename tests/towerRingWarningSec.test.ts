// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveTowerRingParams } from '@/systems/towerRingSkill';

/**
 * towerRingSkill 補鎖（測騎複核 C9 phase machine 562e9b7）：既有 tests/towerRingSkill.test.ts 35 測鑑別足
 *  —— warning 零判定/warningSec 倒數→active/一環 active 完才開下環 warning/warningSec=0 無預警/
 *     hitPlayersThisRing 進 active 清去重/ringHitsPlayer squashY 橢圓化，跑壞版皆紅、背書。
 * ★一個未鎖（跑壞版驗出）：resolveTowerRingParams 的 warningSec `>= 0` 守衛。
 *   既有測只用合法 warningSec(0.5 / 0)，沒測「負值 → 退回預設」——拿掉 `ring.warningSec >= 0` 守衛 → 負值被採用 → 不紅。
 *   負 warningSec 會讓 phase machine 的 warnSec=Math.max(0,負)=0（預警消失）或若下游沒夾更糟，故該退回預設。
 *   比照既有 vacuumRadiusPx「負→退回 baseRadiusPx」的 0-nullish 守衛慣例。維度2：warningSec 是 schema 欄。
 */
describe('resolveTowerRingParams — warningSec >=0 守衛補鎖（負→退回預設）', () => {
  it('★warningSec 負 → 退回預設（不採用負值，防 phase 預警秒數異常）', () => {
    const def = resolveTowerRingParams(null); // 預設 warningSec
    const p = resolveTowerRingParams({ warningSec: -1 });
    expect(p.warningSec).toBe(def.warningSec); // 負值退回預設，非 -1
  });

  it('warningSec 0 合法（0-nullish：0＝無預警，立即 active，非退預設）', () => {
    const p = resolveTowerRingParams({ warningSec: 0 });
    expect(p.warningSec).toBe(0); // 0 是合法值（無預警環），不退預設
  });

  it('warningSec 正常值 → 採用', () => {
    const p = resolveTowerRingParams({ warningSec: 0.8 });
    expect(p.warningSec).toBe(0.8);
  });

  it('warningSec 省略/null → 預設', () => {
    const def = resolveTowerRingParams(null);
    expect(resolveTowerRingParams({}).warningSec).toBe(def.warningSec);
  });
});
