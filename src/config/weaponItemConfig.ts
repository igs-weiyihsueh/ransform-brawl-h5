/**
 * weaponItemConfig.ts — 武器指定變身道具（用戶：撿某武器→變對應英雄）。
 *
 * 每把武器綁一隻英雄（key 對齊 HERO_ROSTER）：撿了 → 變身成該指定英雄（非隨機）。
 * 道具外觀 = 對應武器 PNG（public/assets/images/items/weapons/<heroKey>.png）。
 * 對應（照角色實際拿）：human2=斧 / elf2=小斧 / elf1=法杖 / devil1=匕首 / legacy1=大木槌 / SunWukong=藍劍。
 *
 * ★給予方式（場上生成）用戶「之後再考慮」→ WEAPON_ITEM_SPAWN_ENABLED=false 先關著、備著（比照 HERO_DROP_ENABLED）。
 *   只把「武器道具→指定變身英雄 + 道具圖用武器」邏輯做好，場上不生成。
 */
import { HERO_ROSTER } from '@/config/heroRoster';

const BASE_PATH = 'assets/images/items/weapons';

/**
 * ★武器道具「場上生成」總開關（用戶：給予方式之後再定，先關著備著）。
 * false=關（不週期/不掉落生成武器道具）；之後定給予方式再開。
 * 別刪邏輯——只用此 flag gate，撿了變身+道具圖邏輯已備好。
 */
export const WEAPON_ITEM_SPAWN_ENABLED = false;

/** 武器貼圖 texture key（對齊 heroKey；SunWukong 大小寫對齊 HERO_ROSTER）。 */
export function weaponTextureKey(heroKey: string): string {
  return `weapon-${heroKey}`;
}

/** 武器貼圖檔路徑（clean 名 = heroKey.png）。 */
export function weaponTexturePath(heroKey: string): string {
  return `${BASE_PATH}/${heroKey}.png`;
}

/** 全部武器道具 texture（key+path），供 preload 迭代。key 對齊 HERO_ROSTER。 */
export const WEAPON_ITEM_TEXTURES: readonly { heroKey: string; key: string; path: string }[] =
  HERO_ROSTER.map((heroKey) => ({
    heroKey,
    key: weaponTextureKey(heroKey),
    path: weaponTexturePath(heroKey),
  }));
