// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  resolveFireRain,
  validateFireRain,
  getResolvedFireRainPreset,
  defaultFireRainFile,
  clearResolvedFireRainCache,
} from '@/config/fireRainSchema';
import {
  resolveGuard,
  validateGuard,
  getResolvedGuardPreset,
  defaultGuardFile,
  clearResolvedGuardCache,
} from '@/config/guardSchema';

/**
 * fireRainSchema / guardSchema — 火雨/守護波單獨編輯（用戶七輪#1#2，翼騎 9d0bca7+edc9344，第 6/7 個 EDITOR_STORE_KEYS）。
 * ★關鍵差異(對比 dash/overhead 逐欄 ??)：**整 preset 覆蓋** `{...packaged, ...override.presets}`——
 *   override 同名 preset 整包取代、可新增、未覆蓋沿用;因整包覆蓋(非逐欄 nullish)，0 值(intervalSec/introFocusSec=0)天然保留。
 * 簽章(讀 src)：resolveFireRain/resolveGuard(override, packaged) → null/undefined·壞→packaged;ok→{...packaged, ...presets}。
 *   validateFireRain：per-preset intervalSec/radiusPx/warningSec/damage/edgeMarginPx/durationSec min0、maxConcurrent/burstCount min1 int。
 *   validateGuard：timeLimit/rewardTickets/spawnInterval/introFocusSec... min0、targetHP min1、maxAlive/spawnThreshold min0 int、spawns(enemyType 白名單+weight min0)。
 * 維度3 斷 resolve 選擇 + 整包覆蓋 + 0 值保留 + validate 界線。含壞版必紅。
 * ⚠️ getResolvedX cache + WaveSystem/GuardEvent 消費接線屬狀態機(需 boot,翼騎 headless 驗)——不補;resolve/validate 純函式補足。
 */

// ---- FireRain ----
function fireRainBase() {
  const f = defaultFireRainFile();
  const name = Object.keys(f.presets)[0];
  return { file: f, name };
}
const FR_SENTINEL = { __fr_sentinel__: fireRainBase().file.presets[fireRainBase().name] };

describe('resolveFireRain — 整 preset 覆蓋 / fallback', () => {
  it('無 override（null/undefined）→ 打包預設', () => {
    expect(resolveFireRain(null, FR_SENTINEL as never)).toBe(FR_SENTINEL);
    expect(resolveFireRain(undefined, FR_SENTINEL as never)).toBe(FR_SENTINEL);
  });

  it('★ 合法 override → 整 preset 覆蓋（override 同名整包取代；packaged 有 override 沒的沿用）', () => {
    const { file, name } = fireRainBase();
    // packaged 該 preset damage=1（與 override 不同,才能鑑別「用 override 非 packaged」）+ 一個獨有 KeepMe。
    const packagedPreset = { ...file.presets[name], damage: 1 };
    const packaged = { [name]: packagedPreset, KeepMe: { ...packagedPreset } } as never;
    file.presets[name].damage = 999; // override 值
    expect(validateFireRain(file).ok).toBe(true);
    const r = resolveFireRain(file, packaged);
    expect((r as Record<string, { damage: number }>)[name].damage).toBe(999); // 用 override(非 packaged 的 1)
    expect((r as Record<string, unknown>).KeepMe).toBeDefined(); // packaged 獨有的沿用
  });

  it('★ override preset 某欄=0（intervalSec/damage=0，min0 合法）→ 整包覆蓋保留 0（非被吞）', () => {
    const { file, name } = fireRainBase();
    file.presets[name].intervalSec = 0;
    file.presets[name].damage = 0;
    expect(validateFireRain(file).ok).toBe(true); // 0 合法(min0)
    const r = resolveFireRain(file) as Record<string, { intervalSec: number; damage: number }>;
    expect(r[name].intervalSec).toBe(0); // 整包覆蓋保留 0
    expect(r[name].damage).toBe(0);
  });

  it('★ 壞 override → 打包預設（fallback 不炸）', () => {
    const { file, name } = fireRainBase();
    file.presets[name].maxConcurrent = 0; // min1 → 不合法
    expect(validateFireRain(file).ok).toBe(false);
    expect(resolveFireRain(file, FR_SENTINEL as never)).toBe(FR_SENTINEL);
    expect(resolveFireRain({ version: 1 }, FR_SENTINEL as never)).toBe(FR_SENTINEL); // 缺 presets
    expect(resolveFireRain('x', FR_SENTINEL as never)).toBe(FR_SENTINEL);
  });

  it('validateFireRain 界線：maxConcurrent/burstCount min1(0 擋)、intervalSec/damage min0(0 過)', () => {
    const okZero = defaultFireRainFile();
    const n = Object.keys(okZero.presets)[0];
    okZero.presets[n].intervalSec = 0;
    okZero.presets[n].damage = 0;
    expect(validateFireRain(okZero).ok).toBe(true); // min0 欄 0 過
    const badMax = defaultFireRainFile();
    badMax.presets[n].maxConcurrent = 0;
    expect(validateFireRain(badMax).ok).toBe(false); // min1 欄 0 擋
    const badBurst = defaultFireRainFile();
    badBurst.presets[n].burstCount = 1.5; // int
    expect(validateFireRain(badBurst).ok).toBe(false);
  });

  it('getResolvedFireRainPreset：無 override 回打包該 name；不存在 name → fallback FireRain', () => {
    clearResolvedFireRainCache();
    const { name } = fireRainBase();
    expect(getResolvedFireRainPreset(name)).toBeDefined();
    expect(getResolvedFireRainPreset('__nope__')).toBeDefined(); // fallback 不炸
    clearResolvedFireRainCache();
  });
});

// ---- Guard ----
function guardBase() {
  const f = defaultGuardFile();
  const name = Object.keys(f.presets)[0];
  return { file: f, name };
}
const G_SENTINEL = { __g_sentinel__: guardBase().file.presets[guardBase().name] };

describe('resolveGuard — 整 preset 覆蓋 / fallback', () => {
  it('無 override → 打包預設', () => {
    expect(resolveGuard(null, G_SENTINEL as never)).toBe(G_SENTINEL);
    expect(resolveGuard(undefined, G_SENTINEL as never)).toBe(G_SENTINEL);
  });

  it('★ 合法 override → 整 preset 覆蓋（override 同名取代 + packaged 獨有沿用）', () => {
    const { file, name } = guardBase();
    const packagedPreset = { ...file.presets[name], targetHP: 1 };
    const packaged = { [name]: packagedPreset, KeepMe: { ...packagedPreset } } as never;
    file.presets[name].targetHP = 500; // override 值
    expect(validateGuard(file).ok).toBe(true);
    const r = resolveGuard(file, packaged) as Record<string, { targetHP: number }>;
    expect(r[name].targetHP).toBe(500); // 用 override(非 packaged 的 1)
    expect((r as Record<string, unknown>).KeepMe).toBeDefined();
  });

  it('★ override preset 某欄=0（timeLimit/introFocusSec=0，min0 合法）→ 整包覆蓋保留 0', () => {
    const { file, name } = guardBase();
    file.presets[name].timeLimit = 0;
    file.presets[name].introFocusSec = 0;
    expect(validateGuard(file).ok).toBe(true);
    const r = resolveGuard(file) as Record<string, { timeLimit: number; introFocusSec: number }>;
    expect(r[name].timeLimit).toBe(0);
    expect(r[name].introFocusSec).toBe(0);
  });

  it('★ 壞 override → 打包預設（targetHP=0 min1 擋 / 壞 enemyType / 缺 presets）', () => {
    const badHP = defaultGuardFile();
    const n = Object.keys(badHP.presets)[0];
    badHP.presets[n].targetHP = 0; // min1
    expect(validateGuard(badHP).ok).toBe(false);
    expect(resolveGuard(badHP, G_SENTINEL as never)).toBe(G_SENTINEL);

    const badEnemy = defaultGuardFile();
    (badEnemy.presets[n].spawns as unknown as { enemyType: string }[])[0].enemyType = 'Enemy_Nope';
    expect(validateGuard(badEnemy).ok).toBe(false);
    expect(resolveGuard(badEnemy, G_SENTINEL as never)).toBe(G_SENTINEL);

    expect(resolveGuard({ version: 1 }, G_SENTINEL as never)).toBe(G_SENTINEL);
  });

  it('validateGuard 界線：targetHP min1(0 擋)、timeLimit min0(0 過)、壞 enemyType 擋', () => {
    const okZero = defaultGuardFile();
    const n = Object.keys(okZero.presets)[0];
    okZero.presets[n].timeLimit = 0;
    expect(validateGuard(okZero).ok).toBe(true); // min0 過
    const badHP = defaultGuardFile();
    badHP.presets[n].targetHP = 0;
    expect(validateGuard(badHP).ok).toBe(false); // min1 擋
  });

  it('getResolvedGuardPreset：不存在 name → fallback Guard60 不炸', () => {
    clearResolvedGuardCache();
    const { name } = guardBase();
    expect(getResolvedGuardPreset(name)).toBeDefined();
    expect(getResolvedGuardPreset('__nope__')).toBeDefined();
    clearResolvedGuardCache();
  });
});
