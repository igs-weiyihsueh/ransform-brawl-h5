// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { FIELD_ITEM_SPAWN_ENABLED, ITEM_SPAWN_INTERVAL } from '@/config/transformConfig';
import type { GameContext } from '@/systems/GameContext';
import { TransformSystem } from '@/systems/TransformSystem';

/**
 * FIELD_ITEM_SPAWN_ENABLED 鎖（測騎，配合翼騎大更動回歸修#3：場上先不生變身道具）。
 * TransformSystem.update 週期 spawnItem 受 FIELD_ITEM_SPAWN_ENABLED gate（false 關）——
 *   flag false 時，update 跨過 spawnTimer 週期也【不】呼叫 spawnItem（items 保持空）。
 * ★壞版必紅：spawnItem 會 `new TransformItem(this.ctx.scene, ...)`（需 scene）——headless ctx 無 scene，
 *   故若拿掉 `if (FIELD_ITEM_SPAWN_ENABLED)` gate → update 跨週期時呼叫 spawnItem → 無 scene 爆 → 此測（不拋+items空）紅。
 * ★不影響 debug 手動生(G)/heroDrop 掉落（各自路徑，不經此 gate）。
 */
function priv(sys: TransformSystem): { items: unknown[] } {
  return sys as unknown as { items: unknown[] };
}

function makeHeadless() {
  const player = {
    playerId: 0,
    getCharacterKey: () => 'Human',
    getPosition: () => ({ x: 0, y: 0 }),
    switchCharacter: () => {},
    setSoulDamageSink: () => {},
    playTransformFlash: () => {},
  };
  const sys = new TransformSystem();
  sys.init({ player } as unknown as GameContext); // 無 scene（headless）
  return sys;
}

describe('FIELD_ITEM_SPAWN_ENABLED — 週期生道具總開關（#3 場上先不生）', () => {
  it('flag 現為 false（場上先不生變身道具）', () => {
    expect(FIELD_ITEM_SPAWN_ENABLED).toBe(false);
  });

  it('★flag 關 → update 跨過 spawnTimer 週期也不 spawnItem（items 保持空、不拋）', () => {
    const sys = makeHeadless();
    expect(priv(sys).items.length).toBe(0);
    // 跨越多個 spawn 週期（每次 dt 大於 interval）→ 若 gate 失效會呼 spawnItem（無 scene→爆）。
    expect(() => {
      for (let i = 0; i < 5; i++) sys.update(ITEM_SPAWN_INTERVAL + 1);
    }).not.toThrow();
    expect(priv(sys).items.length).toBe(0); // flag 關 → 全程沒生任何道具
  });
});
