import { describe, expect, it } from 'vitest';
import { ENEMY_AI } from '@/config/enemyConfig';
import { pushOutOfPlayer } from '@/systems/enemySeparation';

/**
 * 菁英防穿透豁免（像牆，用戶 #4）測試。
 * resolvePenetration 的分支在 Enemy(Phaser 相依)，這裡測：
 *  - cfg flag：菁英 immovable=true、一般敵人非 true。
 *  - pushOutOfPlayer 的對稱用法：菁英頂玩家 = 以菁英為中心把玩家推到 minDist 邊緣。
 * 含壞版必紅。
 */
describe('菁英防穿透豁免（immovable）', () => {
  it('菁英 Enemy_Elite.immovable=true（像牆頂不動）', () => {
    expect(ENEMY_AI.Enemy_Elite.immovable).toBe(true);
  });

  it('一般敵人 Rush/Ranged 非 immovable（照舊被頂開）', () => {
    expect(ENEMY_AI.Enemy_Rush.immovable).not.toBe(true);
    expect(ENEMY_AI.Enemy_Ranged.immovable).not.toBe(true);
  });

  it('菁英頂玩家：以菁英為中心把玩家推到 minDist 邊緣（玩家不穿進菁英）', () => {
    const elite = { x: 500, y: 500 };
    const player = { x: 520, y: 500 }; // 距 20，穿進菁英內
    const minDist = 100;
    const out = pushOutOfPlayer(player, elite, minDist); // 對稱：推玩家而非敵人
    const dist = Math.hypot(out.x - elite.x, out.y - elite.y);
    expect(dist).toBeCloseTo(minDist, 5); // 玩家被推到剛好 minDist 邊緣
    expect(out.x).toBe(600); // 沿 +x 推到 500+100
  });

  it('沒穿透（玩家已在 minDist 外）→ 玩家不動', () => {
    const elite = { x: 500, y: 500 };
    const player = { x: 700, y: 500 }; // 距 200 > minDist
    const out = pushOutOfPlayer(player, elite, 100);
    expect(out.x).toBe(700); // 原位
    expect(out.y).toBe(500);
  });

  // 🔴 壞版對照：菁英必須 immovable，否則菁英會被玩家頂開（非像牆）。
  it('壞版對照：菁英 immovable 為 true（非 false/undefined）', () => {
    expect(ENEMY_AI.Enemy_Elite.immovable).toBe(true);
    expect(ENEMY_AI.Enemy_Elite.immovable).not.toBeFalsy();
  });

  // 🔴 壞版對照：穿透時玩家確實被推出（非留在菁英體內）。
  it('壞版對照：穿透玩家被推出（新位置在 minDist 邊緣、非原穿透位置）', () => {
    const out = pushOutOfPlayer({ x: 510, y: 500 }, { x: 500, y: 500 }, 100);
    expect(out.x).not.toBe(510); // 有被推
    expect(Math.hypot(out.x - 500, out.y - 500)).toBeCloseTo(100, 5);
  });
});
