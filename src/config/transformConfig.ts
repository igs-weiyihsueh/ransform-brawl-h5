/**
 * transformConfig.ts — 變身系統設定（對照 Unity 決策 15fec2a4）。
 * H5 只有 凡人(Human) ↔ 悟空(SunWukong)。
 */

/** 凡人角色 key。 */
export const HUMAN_KEY = 'Human';
/** 悟空角色 key。 */
export const SUNWUKONG_KEY = 'SunWukong';

/** 魂力上限（變身時滿）。 */
export const MAX_SOUL_POWER = 100;

/** 變身中再撿道具回復的魂力（clamp 到上限）。 */
export const RECOVER_SOUL = 50;

/** 變身金光閃無敵時間（秒）。 */
export const TRANSFORM_IFRAME = 1.0;

/** 道具週期生成間隔（秒）。 */
export const ITEM_SPAWN_INTERVAL = 10;

/** 場上同時最多道具數。 */
export const MAX_ITEMS_ON_FIELD = 3;

/**
 * ★場上「週期生成變身道具」總開關（用戶#3：場上先不生變身道具）。
 * false=關（TransformSystem.update 不週期 spawnItem）；之後要開回設 true 即恢復。
 * 別刪週期生成 code——只用此 flag gate，保留機制供日後開回（對齊 heroDropMath.HERO_DROP_ENABLED 慣例）。
 * ★不影響：debug 手動生（G 鍵）、heroDrop 掉落路徑（各自 gate）。
 */
export const FIELD_ITEM_SPAWN_ENABLED = false;
