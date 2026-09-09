/**
 * eventsConfig.ts — 2 新事件（地雷陷阱 + 魔尖塔）共用參數。階段 A：麻痺（stun）狀態。
 *
 * 麻痺＝暫時定住 N 秒不能移動/攻擊/行動，時間到自動解除。★不扣血（角色無血量），純狀態。
 * 玩家 Player.applyStun / 怪 Enemy.applyStun 皆吃秒數；地雷爆炸/魔尖塔環狀技命中呼叫 applyStun(target, 秒數)。
 */

/** 麻痺預設時長（秒）——地雷爆炸預設 3 秒（用戶）。事件端可傳自訂秒數覆蓋。 */
export const STUN_DEFAULT_SEC = 3;
