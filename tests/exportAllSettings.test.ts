// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  exportAllSettings,
  exportSettingsFilename,
  EDITOR_STORE_KEYS,
  applyToGame,
  SETTINGS_EXPORT_VERSION,
} from '@/config/editorStore';

/**
 * 匯出當前全部設定（用戶第十六輪：把調好的設定定為打包預設的第一步，additive）。
 *  1. exportAllSettings()：純讀 localStorage 所有 override key → 結構化（只含有存的 key + label/target/value；沒調的列 unset）。
 *  2. exportSettingsFilename()：帶日期戳 transform-brawl-settings-YYYYMMDD.json。
 * 維度3 斷結構/只含有值 key/unset/version 帶出。含壞版必紅（沒調→unset、有調→settings 帶原始值+version）。
 */
describe('exportAllSettings — 讀 localStorage override 打包', () => {
  beforeEach(() => localStorage.clear());

  it('全無 override → settings 空、所有設定列 unset', () => {
    const out = exportAllSettings();
    expect(out.exportVersion).toBe(SETTINGS_EXPORT_VERSION);
    expect(Object.keys(out.settings)).toHaveLength(0);
    expect(out.unset).toContain('hitfeel');
    expect(out.unset).toContain('mapBounds');
    expect(typeof out.exportedAt).toBe('string');
  });

  it('只匯出有存 override 的 key（用戶實際調過的），其餘列 unset', () => {
    applyToGame(EDITOR_STORE_KEYS.hitfeel, { version: 1, hitFeel: { microFreezeDuration: 0.2 } });
    applyToGame(EDITOR_STORE_KEYS.mapBounds, { version: 1, bounds: { minX: -10, maxX: 10, minY: -4, maxY: 4 } });
    const out = exportAllSettings();
    expect(Object.keys(out.settings).sort()).toEqual(['hitfeel', 'mapBounds']);
    expect(out.unset).not.toContain('hitfeel');
    expect(out.unset).not.toContain('mapBounds');
    expect(out.unset).toContain('dash'); // 沒調
  });

  it('settings 每筆帶 key/label/target/原始 value（含其自身 version，供翼騎對應寫 default）', () => {
    const payload = { version: 1, bounds: { minX: -10, maxX: 10, minY: -4, maxY: 4 } };
    applyToGame(EDITOR_STORE_KEYS.mapBounds, payload);
    const out = exportAllSettings();
    const mb = out.settings.mapBounds;
    expect(mb.key).toBe(EDITOR_STORE_KEYS.mapBounds);
    expect(mb.label).toBe('地圖邊界');
    expect(mb.target).toContain('mapConfig');
    expect(mb.value).toEqual(payload); // 原始 override 物件（含 version）原封帶出
  });

  it('壞 JSON override（loadOverride 回 null）→ 該 key 列 unset（不炸）', () => {
    localStorage.setItem(EDITOR_STORE_KEYS.dash, '{ not json');
    const out = exportAllSettings();
    expect(out.settings.dash).toBeUndefined();
    expect(out.unset).toContain('dash');
  });
});

describe('exportSettingsFilename — 帶日期戳', () => {
  it('transform-brawl-settings-YYYYMMDD.json（補零）', () => {
    expect(exportSettingsFilename(new Date(2026, 8, 7))).toBe('transform-brawl-settings-20260907.json'); // 月 0-index：8=9月
    expect(exportSettingsFilename(new Date(2026, 11, 25))).toBe('transform-brawl-settings-20261225.json');
  });
});
