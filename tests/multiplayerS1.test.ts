// @vitest-environment jsdom
/**
 * 多人遷移 Stage 1 測試（骨架 + getter alias + 單人回歸保存）。翼騎 S1 = c78a528。
 *
 * S1 是 additive 零行為改變：Player 加 playerId/kind、GameContext 加 players[]、
 * GameScene ctx 用 `players:[player]` + `get player(){return players[0]}` alias。
 *
 * ⚠️ 涵蓋邊界（誠實）：S1 結構上**只有 P1**，測不了「P1/P2 state 獨立」（那要 S4 才有 P2-P4）。
 *   本檔測的是：①Player 新欄位構造正確 ②getter alias `ctx.player === ctx.players[0]` 恆真
 *   ③骨架形狀（players.length===1、[0]===本地 P1）。單人「行為同舊」由現有 302 測試守著（S1 沒改邏輯）。
 *   **per-player 獨立鑑別留 S4**（現在寫不出，如同「威脅不存在則保護不可測」的判準）。
 */
import { describe, expect, it, beforeAll, afterEach, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import Phaser from 'phaser';
import { Player, PLAYER_CHARACTERS } from '../src/entities/Player';
import { GameScene } from '../src/scenes/GameScene';
import type { GameContext } from '../src/systems/GameContext';
import type { LevelData } from '../src/config/levelSchema';

// ---------------------------------------------------------------------------
// Part 1：Player 新欄位（playerId / kind）— 直接構造，需 Phaser scene。
// ---------------------------------------------------------------------------
let sharedGame: Phaser.Game;
let sharedScene: Phaser.Scene;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    class Boot extends Phaser.Scene {
      constructor() {
        super({ key: 'Boot' });
      }
      create(): void {
        sharedScene = this;
        resolve();
      }
    }
    sharedGame = new Phaser.Game({
      type: Phaser.HEADLESS,
      width: 100,
      height: 100,
      scene: [Boot],
      audio: { noAudio: true },
      banner: false,
    });
  });
});

afterAll(() => sharedGame?.destroy(true));

describe('S1 — Player 新欄位 playerId / kind（constructor 帶預設）', () => {
  it('現有呼叫 new Player(scene,x,y,charKey) → 預設 playerId=0、kind=human（不改既有行為）', () => {
    const p = new Player(sharedScene, 0, 0, PLAYER_CHARACTERS[0]);
    expect(p.playerId).toBe(0);
    expect(p.kind).toBe('human');
  });

  it('帶參數 new Player(...,2,"ai") → playerId=2、kind=ai（構造子參數正確存）', () => {
    const p = new Player(sharedScene, 0, 0, PLAYER_CHARACTERS[0], 2, 'ai');
    expect(p.playerId).toBe(2);
    expect(p.kind).toBe('ai');
  });

  it('playerId / kind 為 readonly（型別層；執行期驗值有存即可）', () => {
    const p = new Player(sharedScene, 0, 0, PLAYER_CHARACTERS[0], 1, 'human');
    expect(p.playerId).toBe(1);
    expect(p.kind).toBe('human');
  });
});

// ---------------------------------------------------------------------------
// Part 2：GameScene ctx 的 getter alias（真 boot 讀真 ctx，讓「getter 改錯」會紅）。
// 用 bootSmoke 同套 HEADLESS + preview 注入關卡（不 fetch，無 teardown race）。
// ---------------------------------------------------------------------------
const PREVIEW_LEVELS: LevelData[] = [
  {
    id: 's1',
    name: 's1',
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

async function startAssetServer(): Promise<void> {
  // 若 3000 已被別的測試檔的 asset server 佔用（平行跑時），沿用它（服務同一個 public/ 目錄即可），
  // 不自己再 listen（避免 EADDRINUSE）。只在自己成功 listen 時才在 afterEach 關閉。
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
        server = null; // 別人已在服務 3000，沿用、不持有
        resolve();
      } else {
        throw e;
      }
    });
    srv.listen(3000, '127.0.0.1', () => {
      server = srv; // 自己持有 → afterEach 關
      resolve();
    });
  });
}

/** boot 真 GameScene 到 RUNNING，回傳 scene（含 create 後的私有 ctx）。 */
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

describe('S1 — GameScene ctx getter alias（真 boot 讀真 ctx）', () => {
  it('ctx.player === ctx.players[0]（getter alias 恆真）、players.length===1（S1 只 P1）', async () => {
    await startAssetServer();
    const scene = await bootGameScene();
    expect(scene?.sys.settings.status).toBe(Phaser.Scenes.RUNNING);
    const ctx = (scene as unknown as { ctx: GameContext }).ctx;
    // getter alias：這條就是「getter 被改成回 players[1]/別的」的鑑別點。
    expect(ctx.player === ctx.players[0]).toBe(true);
    expect(ctx.players.length).toBe(1); // S1 骨架只有 P1
    // 本地 P1 是 human、playerId 0（GameScene 建的那個玩家）。
    expect(ctx.player.kind).toBe('human');
    expect(ctx.player.playerId).toBe(0);
  }, 30000);
}); 
