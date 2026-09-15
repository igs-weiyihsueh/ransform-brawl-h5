/**
 * douqiItemMath — 鬥氣道具系統純函式（階段1）。零 Phaser/場景依賴，交測騎測。
 *
 * 掉落 roll、加權挑選、護盾扣血/破盾（階段1.5 接操控策略用、階段1 先備好+測）、
 * lifespan 相位（alive/blinking/expired）、閃爍顯隱。
 */

import type { DouqiItemSkill } from '@/config/douqiItemConfig';

/** 掉落判定：rng() ≤ dropChance 則掉落。 */
export function rollDrop(dropChance: number, rng: () => number = Math.random): boolean {
  if (dropChance <= 0) return false;
  return rng() < dropChance;
}

/**
 * 加權挑一種道具 skill（輪盤法，仿 waveMath.pickWeightedType 風格）。
 * 空陣列→null；總權重<=0→第一筆；否則 r=rng()*total 逐筆扣、r<=0 命中；掃完回最後一筆（浮點保險）。
 * @param entries {skill, weight}[]（weight 負值以 0 計）。
 * @param rng [0,1) 隨機源（可注入定值測）。
 */
export function pickWeightedDropSkill<T extends { skill: DouqiItemSkill; weight: number }>(
  entries: readonly T[],
  rng: () => number = Math.random,
): DouqiItemSkill | null {
  if (entries.length === 0) return null;
  let total = 0;
  for (const e of entries) total += Math.max(0, e.weight);
  if (total <= 0) return entries[0].skill;
  let r = rng() * total;
  for (const e of entries) {
    r -= Math.max(0, e.weight);
    if (r <= 0) return e.skill;
  }
  return entries[entries.length - 1].skill;
}

/** 護盾扣血（攻擊打道具）：回新盾量（夾 ≥0）。階段1.5 接。 */
export function damageShield(shieldHp: number, dmg: number): number {
  return Math.max(0, shieldHp - Math.max(0, dmg));
}

/** 是否破盾（盾 ≤ 0＝可拾）。 */
export function isShieldBroken(shieldHp: number): boolean {
  return shieldHp <= 0;
}

/** 道具 lifespan 相位。 */
export type ItemLifePhase = 'alive' | 'blinking' | 'expired';

/**
 * lifespan 相位判定：
 *  - elapsed ≥ lifespan → expired（該移除）。
 *  - elapsed ≥ lifespan − blinkBefore → blinking（閃爍提示即將消失）。
 *  - 否則 alive。
 */
export function lifespanPhase(elapsedMs: number, lifespanMs: number, blinkBeforeMs: number): ItemLifePhase {
  if (elapsedMs >= lifespanMs) return 'expired';
  if (elapsedMs >= lifespanMs - blinkBeforeMs) return 'blinking';
  return 'alive';
}

/** 閃爍顯隱：以 periodMs 為週期，前半顯、後半隱（回 true＝該顯示）。 */
export function blinkVisible(elapsedMs: number, periodMs: number): boolean {
  if (periodMs <= 0) return true;
  return elapsedMs % periodMs < periodMs / 2;
}

/** overlap 拾取判定：兩點距離 ≤ pickupRadius + playerRadius。 */
export function overlapPickup(
  itemX: number,
  itemY: number,
  playerX: number,
  playerY: number,
  pickupRadiusPx: number,
  playerRadiusPx: number,
): boolean {
  const dx = itemX - playerX;
  const dy = itemY - playerY;
  return dx * dx + dy * dy <= (pickupRadiusPx + playerRadiusPx) * (pickupRadiusPx + playerRadiusPx);
}
