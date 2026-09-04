// @vitest-environment jsdom
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Phaser from 'phaser';
import { Enemy, ENEMY_CHARACTERS } from '@/entities/Enemy';

/**
 * Enemy 定身（applyStun / isStunned）測試（B#6 頭盔 Lightning/Freeze 用）。
 * 需 Phaser scene（Enemy 建 CharacterAnimator）→ jsdom + HEADLESS 共用 scene。
 * 每測 forceDestroy 建立的 enemy，避免共用 scene 累積物件（延續 guard OOM 教訓）。
 */
let game: Phaser.Game;
let scene: Phaser.Scene;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    class Boot extends Phaser.Scene {
      constructor() {
        super({ key: 'Boot' });
      }
      create(): void {
        scene = this;
        resolve();
      }
    }
    game = new Phaser.Game({
      type: Phaser.HEADLESS,
      width: 100,
      height: 100,
      scene: [Boot],
      audio: { noAudio: true },
      banner: false,
    });
  });
});

afterAll(() => game?.destroy(true));

function makeEnemy(): Enemy {
  return new Enemy(scene, 500, 500, ENEMY_CHARACTERS[0]);
}

describe('Enemy — applyStun / isStunned', () => {
  it('初始未定身', () => {
    const e = makeEnemy();
    expect(e.isStunned()).toBe(false);
    e.forceDestroy();
  });

  it('applyStun(2) → 定身中；update 倒數；到期恢復', () => {
    const e = makeEnemy();
    e.applyStun(2);
    expect(e.isStunned()).toBe(true);
    e.update({ x: 0, y: 0 }, 1); // 定身中倒數 1s（剩 1）→ 不行動
    expect(e.isStunned()).toBe(true);
    e.update({ x: 0, y: 0 }, 1.1); // 再 1.1s → 到期
    expect(e.isStunned()).toBe(false);
    e.forceDestroy();
  });

  it('重複 applyStun 取【較長】者（不縮短）：先 2 再 1 仍 2；先 1 再 3 變 3', () => {
    const a = makeEnemy();
    a.applyStun(2);
    a.applyStun(1); // 較短 → 不縮短
    a.update({ x: 0, y: 0 }, 1.5); // 剩 0.5（若被縮成 1 早該到期）
    expect(a.isStunned()).toBe(true);
    a.forceDestroy();

    const b = makeEnemy();
    b.applyStun(1);
    b.applyStun(3); // 較長 → 延長
    b.update({ x: 0, y: 0 }, 1.5); // 剩 1.5（若還是 1 早到期）
    expect(b.isStunned()).toBe(true);
    b.forceDestroy();
  });

  it('定身中 update 不丟例外（只 idle 倒數、不跑 AI）', () => {
    const e = makeEnemy();
    e.applyStun(1);
    expect(() => e.update({ x: 0, y: 0 }, 0.1)).not.toThrow();
    e.forceDestroy();
  });

  it('已死亡的 enemy applyStun 為 no-op（不定身）', () => {
    const e = makeEnemy();
    e.forceDestroy(); // 標記死亡
    e.applyStun(5);
    expect(e.isStunned()).toBe(false); // dead → guard 擋住
  });
});
