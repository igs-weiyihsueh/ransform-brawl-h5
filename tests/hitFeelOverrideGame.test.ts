// @vitest-environment jsdom
/**
 * hitFeel override 遊戲端生效整合測試（用戶第十一輪：hitfeel 補套用機制）。
 * 設 localStorage hitfeel override → Enemy.takeHit 讀 getResolvedHitFeel() → microFreezeDuration 生效：
 *  - override microFreeze=0.2 → 受擊後 freezeRemaining=0.2（非打包 0.06）。
 *  - override microFreeze=0 → 受擊後 freezeRemaining=0（不做頓幀，★0 合法）。
 *  - 無 override → 打包預設 0.06（行為不變）。
 * ⚠️ jsdom + HEADLESS scene；每測清 localStorage + clearResolvedHitFeelCache（cache 重讀）。
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import Phaser from 'phaser';
import { Enemy } from '@/entities/Enemy';
import { EDITOR_STORE_KEYS, applyToGame, clearOverride } from '@/config/editorStore';
import { HIT_FEEL_SCHEMA_VERSION, clearResolvedHitFeelCache } from '@/config/hitFeelSchema';
import { HIT_FEEL } from '@/config/hitFeelConfig';

let game: Phaser.Game;
let scene: Phaser.Scene;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    class T extends Phaser.Scene {
      constructor() { super({ key: 'T' }); }
      create(): void { scene = this; resolve(); }
    }
    game = new Phaser.Game({
      type: Phaser.HEADLESS, width: 100, height: 100, scene: [T],
      audio: { noAudio: true }, banner: false,
    });
  });
});
afterAll(() => game?.destroy(true));

beforeEach(() => {
  clearOverride(EDITOR_STORE_KEYS.hitfeel);
  clearResolvedHitFeelCache();
});

function applyMicroFreeze(v: number): void {
  applyToGame(EDITOR_STORE_KEYS.hitfeel, {
    version: HIT_FEEL_SCHEMA_VERSION,
    hitFeel: { ...HIT_FEEL, microFreezeDuration: v },
  });
  clearResolvedHitFeelCache();
}

/** 讀 enemy 私有 freezeRemaining（維度3 斷實際頓幀時長）。 */
function freezeOf(e: Enemy): number {
  return (e as unknown as { freezeRemaining: number }).freezeRemaining;
}

describe('hitFeel override 遊戲端生效（microFreeze）', () => {
  it('無 override → 受擊後 microFreeze=打包預設 0.06（行為不變）', () => {
    const e = new Enemy(scene, 500, 0, 'Enemy_Rush'); // 一般小怪（非 immovable/charge）
    e.takeHit(1, 1, { x: 0, y: 0 });
    expect(freezeOf(e)).toBeCloseTo(HIT_FEEL.microFreezeDuration); // 0.06
    e.forceDestroy();
  });

  it('override microFreeze=0.2 → 受擊後 freezeRemaining=0.2（套用生效）', () => {
    applyMicroFreeze(0.2);
    const e = new Enemy(scene, 500, 0, 'Enemy_Rush');
    e.takeHit(1, 1, { x: 0, y: 0 });
    expect(freezeOf(e)).toBeCloseTo(0.2);
    e.forceDestroy();
  });

  it('★override microFreeze=0 → 受擊後 freezeRemaining=0（不做頓幀，0 合法非退回預設）', () => {
    applyMicroFreeze(0);
    const e = new Enemy(scene, 500, 0, 'Enemy_Rush');
    e.takeHit(1, 1, { x: 0, y: 0 });
    expect(freezeOf(e)).toBe(0);
    e.forceDestroy();
  });
});
