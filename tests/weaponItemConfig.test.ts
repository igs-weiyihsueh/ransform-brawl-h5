// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  weaponTextureKey,
  weaponTexturePath,
  WEAPON_ITEM_TEXTURES,
  WEAPON_ITEM_SPAWN_ENABLED,
} from '@/config/weaponItemConfig';
import { HERO_ROSTER } from '@/config/heroRoster';

/**
 * weaponItemConfig — 武器指定變身道具（測騎複核翼騎 2e1a884：撿武器→變對應英雄）。
 * 純函式/config：texture key/path 格式、WEAPON_ITEM_TEXTURES 對齊 HERO_ROSTER、spawn flag 現關（備着）。
 * ★整合邏輯（onPickup source==='weapon'→transform(heroKey) 不論凡人/英雄都變）屬狀態機接線，翼騎 probe 驗，此不補。
 */
describe('weaponItemConfig — texture key/path 格式', () => {
  it('weaponTextureKey = weapon-<heroKey>（原樣 heroKey，SunWukong 大寫保留）', () => {
    expect(weaponTextureKey('SunWukong')).toBe('weapon-SunWukong'); // 大小寫原樣
    expect(weaponTextureKey('devil1')).toBe('weapon-devil1');
    expect(weaponTextureKey('elf1')).toBe('weapon-elf1');
  });

  it('weaponTexturePath = assets/images/items/weapons/<heroKey>.png', () => {
    expect(weaponTexturePath('SunWukong')).toBe('assets/images/items/weapons/SunWukong.png');
    expect(weaponTexturePath('human2')).toBe('assets/images/items/weapons/human2.png');
    // ★路徑用 heroKey 原樣（含大小寫）→ key 與 path 的 heroKey 段一致。
    expect(weaponTexturePath('elf2').endsWith('/elf2.png')).toBe(true);
  });
});

describe('weaponItemConfig — WEAPON_ITEM_TEXTURES 對齊 HERO_ROSTER（6 筆）', () => {
  it('★覆蓋全部 6 個 roster key、順序對齊、無漏無多', () => {
    expect(WEAPON_ITEM_TEXTURES.length).toBe(HERO_ROSTER.length); // 6
    expect(WEAPON_ITEM_TEXTURES.map((w) => w.heroKey)).toEqual([...HERO_ROSTER]); // 順序/內容對齊
    expect(new Set(WEAPON_ITEM_TEXTURES.map((w) => w.key)).size).toBe(HERO_ROSTER.length); // key 無重複
  });

  it('★每筆 key/path 與 heroKey 一致（用同兩個純函式導出，不寫死）', () => {
    for (const w of WEAPON_ITEM_TEXTURES) {
      expect(w.key).toBe(weaponTextureKey(w.heroKey)); // key = weapon-<heroKey>
      expect(w.path).toBe(weaponTexturePath(w.heroKey)); // path 對齊
      expect(w.path).toContain(w.heroKey); // path 含該 heroKey 段
    }
  });

  it('SunWukong 那筆：key=weapon-SunWukong、path 尾 /SunWukong.png（大寫鎖）', () => {
    const sw = WEAPON_ITEM_TEXTURES.find((w) => w.heroKey === 'SunWukong');
    expect(sw).toBeDefined();
    expect(sw!.key).toBe('weapon-SunWukong');
    expect(sw!.path).toBe('assets/images/items/weapons/SunWukong.png');
  });
});

describe('weaponItemConfig — WEAPON_ITEM_SPAWN_ENABLED（場上生成總開關，備着）', () => {
  it('★現為 false（給予方式之後再定，先關着）', () => {
    // 壞版對照：若誤開成 true → 場上會生武器道具（非用戶當前意圖）→ 此測紅。
    expect(WEAPON_ITEM_SPAWN_ENABLED).toBe(false);
  });
});
