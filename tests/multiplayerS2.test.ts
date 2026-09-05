// @vitest-environment jsdom
/**
 * 多人遷移 Stage 2 測試（InputSource 抽象 = 重構零行為改變）。翼騎 S2 = 14e0ce4。
 *
 * S2：新 InputSource 介面(getMoveVector/justPressedAttack/justPressedDash)；InputSystem implements 它；
 * Player 加 inputSource；PlayerControl 改 pull-based 讀 player.inputSource（P1=同一 InputSystem 實例→零行為）。
 *
 * ⚠️ 涵蓋邊界（誠實）：S2 仍只有 P1、只有一個人類 InputSource。測不了「多 InputSource / AI 獨立」(S4)。
 *   本檔測：①PlayerControl 確實 pull-based 從 player.inputSource 取意圖（移動/攻擊/衝刺）
 *   ②P1 wiring：ctx.player.inputSource === ctx.input（注入的 InputSystem 實例）
 *   ③壞版必紅：斷 P1 inputSource 接線 → P1 不回應輸入。
 *   per-player/AI 獨立鑑別留 S4。
 *
 * Part 1（pull-based 契約）用 fake ctx 純邏輯測 PlayerControlSystem，不需 Phaser。
 * Part 2（wiring）真 boot 讀真 ctx。
 */
import { describe, expect, it, beforeAll, afterEach, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import Phaser from 'phaser';
import { PlayerControlSystem } from '../src/systems/PlayerControlSystem';
import { GameScene } from '../src/scenes/GameScene';
import type { GameContext } from '../src/systems/GameContext';
import type { InputSource } from '../src/systems/InputSource';
import type { LevelData } from '../src/config/levelSchema';

// ---------------------------------------------------------------------------
// Part 1：PlayerControl pull-based 從 player.inputSource 取意圖（fake ctx，純邏輯）。
// ---------------------------------------------------------------------------

/** 可控 fake InputSource：測試逐項設定意圖。 */
function fakeInputSource(over: Partial<Record<'move' | 'attack' | 'dash', unknown>> = {}) {
  const state = {
    move: (over.move as { x: number; y: number }) ?? { x: 0, y: 0 },
    attack: (over.attack as boolean) ?? false,
    dash: (over.dash as boolean) ?? false,
    moveReads: 0,
    attackReads: 0,
    dashReads: 0,
  };
  const src: InputSource = {
    getMoveVector: () => {
      state.moveReads += 1;
      return state.move;
    },
    justPressedAttack: () => {
      state.attackReads += 1;
      return state.attack;
    },
    justPressedDash: () => {
      state.dashReads += 1;
      return state.dash;
    },
  };
  return { src, state };
}

/** 最小 fake player：記錄 PlayerControl 驅動的動作（move/startDash/tryStartAttack）。 */
function fakePlayer(inputSource: InputSource | null) {
  const calls = {
    moveVecs: [] as Array<{ x: number; y: number }>,
    startDashVecs: [] as Array<{ x: number; y: number }>,
    tryAttackCount: 0,
    dashing: false,
  };
  const player = {
    inputSource,
    isDashing: () => calls.dashing,
    move: (v: { x: number; y: number }) => calls.moveVecs.push(v),
    startDash: (v: { x: number; y: number }) => calls.startDashVecs.push(v),
    updateDash: () => {},
    updateTimers: () => false,
    setSpeedMultiplier: () => {},
    setDashSpeedMultiplier: () => {},
    setShielded: () => {},
    tryStartAttack: () => {
      calls.tryAttackCount += 1;
      return true;
    },
  };
  return { player, calls };
}

/** 建 PlayerControlSystem + fake ctx（credit 可行動/攻擊、buff 中性、energy 給普攻）。 */
function makePcs(player: unknown) {
  const ctx = {
    player,
    credit: { canAct: () => true, canAttack: () => true },
    buff: { getStatMultiplier: () => 1, isActive: () => false },
    energy: {
      resolveAttackIntent: () => ({ attack: { hitDelay: 0.1 }, multiplier: 1, isSkill: false }),
    },
    getEnemies: () => [],
    input: {}, // 保留但 S2 不該再被 PlayerControl 直讀
  } as unknown as GameContext;
  const pcs = new PlayerControlSystem();
  pcs.init(ctx);
  return pcs;
}

describe('S2 — PlayerControl pull-based 從 player.inputSource 取意圖', () => {
  it('移動：讀 player.inputSource.getMoveVector() 並驅動 player.move（同向量）', () => {
    const { src, state } = fakeInputSource({ move: { x: 1, y: 0 } });
    const { player, calls } = fakePlayer(src);
    makePcs(player).update(0.016);
    expect(state.moveReads).toBeGreaterThan(0); // 有從 inputSource 讀移動
    expect(calls.moveVecs.length).toBeGreaterThan(0);
    expect(calls.moveVecs[0]).toEqual({ x: 1, y: 0 }); // 驅動 player.move 用的是 inputSource 的向量
  });

  it('衝刺：inputSource.justPressedDash()=true → 觸發 player.startDash（用 inputSource 的移動向量）', () => {
    const { src } = fakeInputSource({ dash: true, move: { x: -1, y: 0 } });
    const { player, calls } = fakePlayer(src);
    makePcs(player).update(0.016);
    expect(calls.startDashVecs.length).toBe(1);
    expect(calls.startDashVecs[0]).toEqual({ x: -1, y: 0 });
  });

  it('攻擊：inputSource.justPressedAttack()=true → 觸發 player.tryStartAttack', () => {
    const { src } = fakeInputSource({ attack: true });
    const { player, calls } = fakePlayer(src);
    makePcs(player).update(0.016);
    expect(calls.tryAttackCount).toBe(1);
  });

  it('無輸入（move 0、無 edge）：move 用 0 向量、不 dash/attack', () => {
    const { src } = fakeInputSource();
    const { player, calls } = fakePlayer(src);
    makePcs(player).update(0.016);
    expect(calls.moveVecs[0]).toEqual({ x: 0, y: 0 });
    expect(calls.startDashVecs.length).toBe(0);
    expect(calls.tryAttackCount).toBe(0);
  });

  // 🔴 壞版必紅（S2 核心）：斷 P1 的 inputSource 接線 → P1 不回應輸入。
  it('壞版對照：player.inputSource=null → PlayerControl 早退、P1 完全不回應（不 move/dash/attack）', () => {
    const { player, calls } = fakePlayer(null); // 接線斷
    makePcs(player).update(0.016);
    expect(calls.moveVecs.length).toBe(0); // 沒 move
    expect(calls.startDashVecs.length).toBe(0);
    expect(calls.tryAttackCount).toBe(0);
  });

  it('壞版對照：inputSource.getMoveVector 恆回 0（來源壞）→ P1 移動意圖恆 0（不動）', () => {
    const deadSrc: InputSource = {
      getMoveVector: () => ({ x: 0, y: 0 }),
      justPressedAttack: () => false,
      justPressedDash: () => false,
    };
    const { player, calls } = fakePlayer(deadSrc);
    makePcs(player).update(0.016);
    expect(calls.moveVecs[0]).toEqual({ x: 0, y: 0 }); // 不動
  });
});

// ---------------------------------------------------------------------------
// Part 2：P1 wiring（真 boot 讀真 ctx）——ctx.player.inputSource === ctx.input（注入的 InputSystem）。
// ---------------------------------------------------------------------------
const PREVIEW_LEVELS: LevelData[] = [
  {
    id: 's2',
    name: 's2',
    nodes: [
      {
        nodeType: 'Spawn',
        killQuota: 1,
        maxAlive: 1,
        spawnThreshold: 1,
        spawnInterval: 1,
        spawns: [{ enemyType: 'Enemy_Rush', weight: 1 }],
      },
    ],
  },
];
const PUBLIC_DIR = join(process.cwd(), 'public');
const MIME: Record<string, string> = { '.png': 'image/png', '.json': 'application/json' };
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

let server: Server | null = null;
let bootGame: Phaser.Game | null = null;

afterEach(() => {
  bootGame?.destroy(true);
  bootGame = null;
  server?.close();
  server = null;
});
afterAll(() => {});

/** asset server（埠 3000）；已被別的測試檔佔用時沿用不自己 listen（避免 EADDRINUSE）。 */
async function startAssetServer(): Promise<void> {
  await new Promise<void>((resolve) => {
    const srv = createServer(async (req, res) => {
      try {
        const p = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
        const buf = await readFile(`${PUBLIC_DIR}${p}`);
        res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
        res.end(buf);
      } catch {
        res.writeHead(404);
        res.end('nf');
      }
    });
    srv.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE') {
        server = null;
        resolve();
      } else {
        throw e;
      }
    });
    srv.listen(3000, '127.0.0.1', () => {
      server = srv;
      resolve();
    });
  });
}

async function bootGameScene(): Promise<Phaser.Scene | null> {
  bootGame = new Phaser.Game({
    type: Phaser.HEADLESS,
    width: 800,
    height: 600,
    audio: { noAudio: true },
    banner: false,
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 } } },
    loader: { imageLoadType: 'HTMLImageElement' },
  });
  await new Promise<void>((resolve) => {
    bootGame!.events.once(Phaser.Core.Events.READY, () => resolve());
    setTimeout(resolve, 5000);
  });
  const sm = bootGame.scene as unknown as { update: (t: number, d: number) => void };
  bootGame.scene.add('GameScene', GameScene, true, { previewLevels: PREVIEW_LEVELS });
  let t = 16;
  for (let i = 0; i < 500; i++) {
    sm.update(t, 16); t += 16;
    sm.update(t, 16); t += 16;
    sm.update(t, 16); t += 16;
    await tick();
    const scene = bootGame.scene.getScene('GameScene');
    if (scene && scene.sys.settings.status === Phaser.Scenes.RUNNING) return scene;
  }
  return bootGame.scene.getScene('GameScene');
}

describe('S2 — P1 inputSource wiring（真 boot 讀真 ctx）', () => {
  it('ctx.player.inputSource === ctx.input（P1 的意圖來源=注入的 InputSystem 實例，非 null）', async () => {
    await startAssetServer();
    const scene = await bootGameScene();
    expect(scene?.sys.settings.status).toBe(Phaser.Scenes.RUNNING);
    const ctx = (scene as unknown as { ctx: GameContext }).ctx;
    // 接線正確：P1 的 inputSource 就是注入的 InputSystem（同一實例）。
    expect(ctx.player.inputSource === ctx.input).toBe(true);
    expect(ctx.player.inputSource !== null).toBe(true);
  }, 30000);
});
