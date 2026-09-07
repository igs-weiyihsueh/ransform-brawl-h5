// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  resolveMapBounds,
  validateMapBounds,
  MAP_BOUNDS_SCHEMA_VERSION,
  type MapBoundsUnits,
} from '@/config/mapBoundsSchema';

/**
 * mapBoundsSchema（用戶第十五輪：地圖邊界編輯器，additive）。
 *  1. resolveMapBounds(override, packaged)：override 過 validate → 逐欄 ?? 打包；壞/null → 打包（行為不變）。
 *  2. validateMapBounds：座標 ★可負可 0（只擋非數字 + 超 ±1000 範圍）+ 幾何 minX<maxX / minY<maxY 必須。
 * ★0/負語意（異靈定）：邊界座標 0/負合法（unit 中心原點，minX 常負），resolveMapBounds 用 ?? 非 ||（0 不被吃）。
 * 維度3 斷解析值/過擋。含壞版必紅（★minX=0 保留 / 負保留 / min>=max 擋 / 缺欄 fallback）。
 */
const PACKAGED: MapBoundsUnits = { minX: -8, maxX: 8, minY: -4, maxY: 4 };
function makeFile(b: Partial<MapBoundsUnits>) {
  return { version: MAP_BOUNDS_SCHEMA_VERSION, bounds: { ...PACKAGED, ...b } };
}

describe('resolveMapBounds — override 優先、逐欄 ??（0/負合法）', () => {
  it('override=null → 打包預設（行為不變）', () => {
    expect(resolveMapBounds(null, PACKAGED)).toEqual(PACKAGED);
  });

  it('override 壞（validate 失敗）→ 打包預設', () => {
    expect(resolveMapBounds({ version: 999, bounds: PACKAGED }, PACKAGED)).toEqual(PACKAGED);
    expect(resolveMapBounds({ bounds: { minX: 5, maxX: 5, minY: -4, maxY: 4 } }, PACKAGED)).toEqual(PACKAGED); // minX>=maxX
  });

  it('合法 override（拉大範圍）→ 用 override 值', () => {
    const r = resolveMapBounds(makeFile({ minX: -12, maxX: 12 }), PACKAGED);
    expect(r.minX).toBe(-12);
    expect(r.maxX).toBe(12);
    expect(r.minY).toBe(-4); // 未覆蓋沿用
  });

  it('★0/負合法：minX=0 保留（不被 || 退回 -8）', () => {
    const r = resolveMapBounds(makeFile({ minX: 0 }), PACKAGED);
    expect(r.minX).toBe(0); // 0 是合法邊界，非退回預設
  });

  it('★負座標保留：minY=-6', () => {
    const r = resolveMapBounds(makeFile({ minY: -6 }), PACKAGED);
    expect(r.minY).toBe(-6);
  });
});

describe('validateMapBounds — 座標 0/負合法、min<max 必須', () => {
  it('打包預設檔通過', () => {
    expect(validateMapBounds(makeFile({})).ok).toBe(true);
  });

  it('★minX=0 / 負座標 通過（0/負合法）', () => {
    expect(validateMapBounds(makeFile({ minX: 0, minY: -6 })).ok).toBe(true);
  });

  it('★min>=max 擋（反轉/退化，場地寬高必須>0）', () => {
    expect(validateMapBounds(makeFile({ minX: 8, maxX: 8 })).ok).toBe(false); // 相等
    expect(validateMapBounds(makeFile({ minX: 9, maxX: 8 })).ok).toBe(false); // 反轉
    expect(validateMapBounds(makeFile({ minY: 5, maxY: 4 })).ok).toBe(false);
  });

  it('非數字 / 超 ±1000 範圍 擋', () => {
    expect(validateMapBounds(makeFile({ minX: 'x' as unknown as number })).ok).toBe(false);
    expect(validateMapBounds(makeFile({ maxX: 2000 })).ok).toBe(false);
    expect(validateMapBounds(makeFile({ minX: -2000 })).ok).toBe(false);
  });

  it('version 錯 / bounds 缺 / 根非物件 擋', () => {
    expect(validateMapBounds({ version: 2, bounds: PACKAGED }).ok).toBe(false);
    expect(validateMapBounds({ version: MAP_BOUNDS_SCHEMA_VERSION }).ok).toBe(false);
    expect(validateMapBounds(null).ok).toBe(false);
  });
});
