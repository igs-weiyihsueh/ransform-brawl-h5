// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  resolveChest,
  validateChest,
  chestChargeForResolved,
  CHEST_SCHEMA_VERSION,
} from '@/config/chestSchema';
import type { ResolvedChest } from '@/config/chestSchema';

/**
 * chestSchema — 寶盒開箱門檻 + 各怪擊殺能量開放編輯（用戶九輪#6，波騎/翼騎 3abdfb1，additive）。
 * 讀 src 校準簽章：
 *   resolveChest(override, packagedThreshold=CHEST_OPEN_THRESHOLD, packagedCharge=CHEST_CHARGE_BY_ENEMY): ResolvedChest{openThreshold,chargeByEnemy}
 *     → null/undefined/validate 失敗 → fallback 打包；openThreshold ?? 打包（★0 保留）；chargeByEnemy {...打包,...override}（逐鍵合併,含 0）。
 *   validateChest(json)：version 必須===1;openThreshold optional 給則數字≥0(0 合法);chargeByEnemy optional 給則物件各值數字≥0(0 合法)。
 *   chestChargeForResolved(resolved, key)：查表 ?? 0。
 * 維度3 斷 resolve 選擇 + 0-value 保留。對齊 resolveDash/resolveFireRainGuard 0-nullish。
 * ⚠️ getResolvedChest cache + 開箱門檻 accumulate + 擊殺讀 charge 接線屬狀態機(需 boot,翼騎 headless 驗)——不補。
 */

const PT = 165; // packagedThreshold 哨兵
const PC = { Enemy_Rush: 1, Enemy_Tank: 3, Enemy_Boss: 10 }; // packagedCharge 哨兵

/** 合法 override（帶 version，過 validateChest）。 */
function overrideFile(partial: { openThreshold?: number; chargeByEnemy?: Record<string, number> }): unknown {
  return { version: CHEST_SCHEMA_VERSION, ...partial };
}

describe('resolveChest — 寶盒能量/門檻開放（override>打包，0-nullish safe）', () => {
  it('null/undefined override → 全用打包（行為不變）', () => {
    expect(resolveChest(null, PT, PC)).toEqual({ openThreshold: PT, chargeByEnemy: PC });
    expect(resolveChest(undefined, PT, PC)).toEqual({ openThreshold: PT, chargeByEnemy: PC });
  });

  it('★ openThreshold=0 保留（合法 0 值不被 fallback 成 165）', () => {
    const r = resolveChest(overrideFile({ openThreshold: 0, chargeByEnemy: PC }), PT, PC);
    expect(r.openThreshold).toBe(0); // ★ ?? 非 ||：0 保留
  });

  it('★ chargeByEnemy 某鍵=0 保留（override Enemy_Rush=0 → 0，非打包預設 1）', () => {
    const r = resolveChest(overrideFile({ chargeByEnemy: { Enemy_Rush: 0 } }), PT, PC);
    expect(r.chargeByEnemy.Enemy_Rush).toBe(0); // ★ 逐鍵合併保留 0
    expect(r.chargeByEnemy.Enemy_Tank).toBe(3); // 其餘沿用打包
  });

  it('override 缺鍵 → fallback 打包（只給 openThreshold → chargeByEnemy 用打包）', () => {
    const r = resolveChest(overrideFile({ openThreshold: 200 }), PT, PC);
    expect(r.openThreshold).toBe(200); // 用 override
    expect(r.chargeByEnemy).toEqual(PC); // 缺 chargeByEnemy → 打包
  });

  it('chargeByEnemy 逐鍵合併（覆蓋部分鍵→其餘沿用打包 + 可新增敵種鍵）', () => {
    const r = resolveChest(
      overrideFile({ chargeByEnemy: { Enemy_Rush: 5, Enemy_New: 7 } }),
      PT,
      PC,
    );
    expect(r.chargeByEnemy.Enemy_Rush).toBe(5); // 覆蓋同名
    expect(r.chargeByEnemy.Enemy_Tank).toBe(3); // 未覆蓋→沿用打包
    expect(r.chargeByEnemy.Enemy_Boss).toBe(10); // 未覆蓋→沿用打包
    expect(r.chargeByEnemy.Enemy_New).toBe(7); // 新增敵種鍵
  });

  it('壞/version 錯 override → fallback 打包（行為 100% 不變）', () => {
    expect(resolveChest({ garbage: true } as unknown, PT, PC)).toEqual({ openThreshold: PT, chargeByEnemy: PC });
    expect(resolveChest('not-an-object' as unknown, PT, PC)).toEqual({ openThreshold: PT, chargeByEnemy: PC });
    // version 錯（=2）→ validate 失敗 → 打包，即使 openThreshold 有給也不採用。
    expect(resolveChest({ version: 2, openThreshold: 0 } as unknown, PT, PC)).toEqual({ openThreshold: PT, chargeByEnemy: PC });
  });

  it('不改打包來源（回傳 chargeByEnemy 是新物件）', () => {
    const pc = { Enemy_Rush: 1 };
    const r = resolveChest(overrideFile({ chargeByEnemy: { Enemy_Rush: 9 } }), PT, pc);
    expect(r.chargeByEnemy.Enemy_Rush).toBe(9);
    expect(pc.Enemy_Rush).toBe(1); // 打包來源未被污染
  });
});

describe('chestChargeForResolved — 查某敵人能量（未列→0）', () => {
  const resolved: ResolvedChest = { openThreshold: 165, chargeByEnemy: { Enemy_Rush: 1, Enemy_Zero: 0 } };
  it('列表內 → 回該值', () => {
    expect(chestChargeForResolved(resolved, 'Enemy_Rush')).toBe(1);
  });
  it('★ 值=0 → 回 0（非 fallback）', () => {
    expect(chestChargeForResolved(resolved, 'Enemy_Zero')).toBe(0);
  });
  it('未列 → 0', () => {
    expect(chestChargeForResolved(resolved, 'Enemy_Unknown')).toBe(0);
  });
});

describe('validateChest — 門檻/能量驗證（負擋、0 合法過）', () => {
  it('default（帶 version 的合法基準）→ ok', () => {
    expect(validateChest(overrideFile({ openThreshold: 165, chargeByEnemy: { Enemy_Rush: 1 } })).ok).toBe(true);
  });

  it('openThreshold=0 合法 → ok（0 是合法門檻）', () => {
    expect(validateChest(overrideFile({ openThreshold: 0 })).ok).toBe(true);
  });

  it('★ 負門檻 → 擋（ok=false）', () => {
    expect(validateChest(overrideFile({ openThreshold: -1 })).ok).toBe(false);
  });

  it('charge 非數字 / 負 → 擋', () => {
    expect(validateChest(overrideFile({ chargeByEnemy: { Enemy_Rush: 'x' as unknown as number } })).ok).toBe(false);
    expect(validateChest(overrideFile({ chargeByEnemy: { Enemy_Rush: -5 } })).ok).toBe(false);
  });

  it('charge=0 合法 → ok（0 是合法能量）', () => {
    expect(validateChest(overrideFile({ chargeByEnemy: { Enemy_Rush: 0 } })).ok).toBe(true);
  });

  it('★ version 缺/錯 → 擋（凍結相容：只接受 v1）', () => {
    expect(validateChest({ openThreshold: 165 }).ok).toBe(false); // 缺 version
    expect(validateChest({ version: 2, openThreshold: 165 }).ok).toBe(false); // 錯 version
  });
});
