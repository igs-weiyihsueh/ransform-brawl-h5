// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  parseImportedSettings,
  importAllSettings,
  exportAllSettings,
  EDITOR_STORE_KEYS,
  applyToGame,
  loadOverride,
} from '@/config/editorStore';

/**
 * 匯入設定 JSON（用戶第十七輪：對齊匯出全部設定 f813de9 反向，additive、容錯）。
 *  1. parseImportedSettings：相容完整匯出檔 {settings:{name:{value}}} 或裸 {name:value}；只回認得的 name；缺項略過。
 *  2. importAllSettings：依 EDITOR_STORE_META 分派 applyToGame(存 localStorage)；★缺項不動、不認得列 unknown。
 *  3. round-trip：export → import 還原（localStorage 值一致）。
 * 維度3 斷分派值/缺項不動/unknown/round-trip。含壞版必紅（缺項不清空、不認得略過、裸格式相容）。
 */
beforeEach(() => localStorage.clear());

describe('parseImportedSettings — 相容完整檔/裸對照、只取認得的', () => {
  it('完整匯出檔 {settings:{name:{value}}} → 取 value', () => {
    const json = { exportVersion: 1, exportedAt: 'x', settings: {
      hitfeel: { key: 'transformbrawl:hitfeel', label: '打擊感', target: 't', value: { version: 1, hitFeel: { microFreezeDuration: 0.2 } } },
    }, unset: [] };
    const { values, unknown } = parseImportedSettings(json);
    expect(values.hitfeel).toEqual({ version: 1, hitFeel: { microFreezeDuration: 0.2 } });
    expect(unknown).toHaveLength(0);
  });

  it('裸對照 {name:value} → value 直接是 override 物件', () => {
    const json = { mapBounds: { version: 1, bounds: { minX: -10, maxX: 10, minY: -4, maxY: 4 } } };
    const { values } = parseImportedSettings(json);
    expect(values.mapBounds).toEqual({ version: 1, bounds: { minX: -10, maxX: 10, minY: -4, maxY: 4 } });
  });

  it('不認得的 key → 列 unknown（略過），meta 欄位(exportVersion/exportedAt/unset)不當設定', () => {
    const json = { exportVersion: 1, exportedAt: 'x', unset: [], settings: { bogusThing: { value: 1 }, dash: { value: { version: 1, dash: {} } } } };
    const { values, unknown } = parseImportedSettings(json);
    expect(unknown).toContain('bogusThing');
    expect('dash' in values).toBe(true);
    expect('exportVersion' in values).toBe(false);
  });

  it('根非物件 → 空（不炸）', () => {
    expect(parseImportedSettings(null).values).toEqual({});
    expect(parseImportedSettings('str').unknown).toEqual([]);
  });
});

describe('importAllSettings — 分派 applyToGame、缺項不動', () => {
  it('匯入 → 對應 key 存進 localStorage（editor 讀得到）', () => {
    const json = { settings: {
      mapBounds: { value: { version: 1, bounds: { minX: -10, maxX: 10, minY: -4, maxY: 4 } } },
    } };
    const res = importAllSettings(json);
    expect(res.ok).toBe(true);
    expect(res.imported).toContain('地圖邊界');
    expect(loadOverride(EDITOR_STORE_KEYS.mapBounds)).toEqual({ version: 1, bounds: { minX: -10, maxX: 10, minY: -4, maxY: 4 } });
  });

  it('★缺項保持不變（不清空原有 override）', () => {
    // 先有 hitfeel override，匯入只帶 mapBounds → hitfeel 不動。
    applyToGame(EDITOR_STORE_KEYS.hitfeel, { version: 1, hitFeel: { microFreezeDuration: 0.5 } });
    importAllSettings({ settings: { mapBounds: { value: { version: 1, bounds: { minX: -6, maxX: 6, minY: -4, maxY: 4 } } } } });
    expect(loadOverride(EDITOR_STORE_KEYS.hitfeel)).toEqual({ version: 1, hitFeel: { microFreezeDuration: 0.5 } }); // 沒被清
  });

  it('不認得的 key → 略過列 unknown、不影響已知項匯入', () => {
    const res = importAllSettings({ settings: { bogus: { value: 1 }, dash: { value: { version: 1, dash: {} } } } });
    expect(res.unknown).toContain('bogus');
    expect(res.imported).toContain('衝刺');
  });

  it('★round-trip：export → import 還原（localStorage 值一致）', () => {
    applyToGame(EDITOR_STORE_KEYS.hitfeel, { version: 1, hitFeel: { microFreezeDuration: 0.33 } });
    applyToGame(EDITOR_STORE_KEYS.mapBounds, { version: 1, bounds: { minX: -9, maxX: 9, minY: -4, maxY: 4 } });
    const exported = exportAllSettings();
    localStorage.clear(); // 模擬換瀏覽器
    const res = importAllSettings(exported);
    expect(res.ok).toBe(true);
    expect(loadOverride(EDITOR_STORE_KEYS.hitfeel)).toEqual({ version: 1, hitFeel: { microFreezeDuration: 0.33 } });
    expect(loadOverride(EDITOR_STORE_KEYS.mapBounds)).toEqual({ version: 1, bounds: { minX: -9, maxX: 9, minY: -4, maxY: 4 } });
  });
});
