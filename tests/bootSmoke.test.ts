// @vitest-environment jsdom
/**
 * boot smoke — QA（測騎）維護。踏進「執行期沒人驗」的第一步。
 *
 * 目標：證明「遊戲能 boot + 各系統透過 registry 正確接進 GameScene + create() 不丟例外」，
 *      用來抓【整合接線斷了】——某系統沒 register、或某 init 一跑就爆。
 *
 * 涵蓋邊界（誠實說明，務必看）：
 *   ✅ 只證明：Phaser 能在測試環境 boot、GameScene.create() 全程跑完不丟例外、
 *      registerSystems() 把預期的系統依正確順序接上 registry、每個 system.init(ctx) 有被呼叫。
 *   ❌ 不證明：畫面正確、玩法正確、生怪真的對、手感/動畫/命中體驗——那些要人肉或 E2E。
 *      HEADLESS 下不畫任何像素；本測試看不到「畫對沒」。
 *   ❌ 不證明：真實資源檔（PNG/JSON）內容正確；這裡雖真的載入 assets，但只驗「載得動、
 *      不讓 boot 掛」，不驗圖對不對。
 *
 * 🔴 環境陷阱與解法（instrument-validity：smoke 必須在「boot 真能發生」的環境跑）：
 *   1. Phaser 一 import 就跑 CanvasFeatures 對 <canvas> 呼叫 getContext('2d')，jsdom 沒實作 →
 *      由 tests/setup/phaserHeadless.ts 補一個假 2D context（在 Phaser import 前執行）。
 *   2. jsdom 的 <img> 不會觸發 onload → Phaser TextureManager 等內建貼圖 ready 時卡死 →
 *      同 setup 讓 img.src 一設定就在 microtask 觸發 onload。
 *   3. node_modules/phaser 的 main 指向 src（給 bundler），vitest 會去 require WebGL 除錯依賴
 *      phaser3spectorjs 而爆 → vitest.config.ts 把 'phaser' alias 到預打包的 dist/phaser.js（UMD，
 *      default interop 正確；也是瀏覽器實際跑的同一份 bundle）。
 *   4. render 模式用 Phaser.HEADLESS：跳過 WebGL/canvas 繪製，只跑場景生命週期 + 邏輯。
 *   5. 資源以本機 HTTP server 服務 public/ 的角色/特效 PNG（scene.load.image），並用
 *      loader.imageLoadType='HTMLImageElement'（走 img.src 直載，配合上面 onload 墊片，
 *      避開 jsdom XHR→blob 這條在測試環境無法完成解碼的路徑）。
 *   6. teardown race 防護：以 preview 模式 boot（scene.add(...,{previewLevels})），
 *      WaveSystem 走注入不 fetch levels.json → 沒有 in-flight promise 在 afterEach 後才 reject
 *      → 不會有 unhandled rejection 讓退出碼變 1（見 PREVIEW_LEVELS 說明）。
 *
 * 成功信號 = 場景進入 RUNNING(5)：Phaser 只有在 scene.create() 完整跑完（沒丟例外）後
 * 才把狀態設為 RUNNING；若 create() 中途丟例外，狀態會卡在 CREATING(4)。
 * 因此「有沒有到 RUNNING」正是「create() 接線有沒有全程跑通」的鑑別點。
 * （通則同決策 0a45909b：只信「只有正常系統才滿足」的信號 RUNNING，不信代理信號 CREATING；
 *   並保留「拿掉一個 register→系統清單相等斷言必紅」當守衛。退出碼 0 才是 CI 真信號，
 *   不是只看 passed 數——in-flight fetch 的 unhandled rejection 會讓 passed 全綠卻退出碼 1。）
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import Phaser from 'phaser';
import { GameScene } from '../src/scenes/GameScene';
import type { LevelData } from '../src/config/levelSchema';

/** 期望的系統註冊順序（= 每幀執行順序，見 GameScene.registerSystems 的架構註解）。 */
const EXPECTED_SYSTEMS = [
  'InputSystem',
  'BuffSystem',
  'HelmetSystem',
  'CreditSystem',
  'EnergySystem',
  'PlayerControlSystem',
  'EnemySystem',
  'TransformSystem',
  'ComboSystem',
  'TicketSystem',
  'ChestSystem',
  'JpSystem',
  'WaveSystem',
  'ProgressBarSystem', // #7 頂部進度條 HUD（排 Wave 後、UI 前，commit 48289f1）
  'UISystem',
  'DebugSystem',
] as const;

/**
 * 注入用的已驗證關卡（preview 模式）。
 *
 * 為什麼用 preview 模式 boot：
 *   GameScene.init 收到 previewLevels 時，會用 new WaveSystem(previewLevels) 注入關卡，
 *   WaveSystem.init 就【不會】走 `void loadLevels().then()` 那條 async-無-catch 的 fetch。
 *   一般（無 data）boot 會 fetch levels.json；那個 in-flight fetch 若在測試 afterEach
 *   關掉 asset server／還原 fetch【之後】才 reject，就變成 unhandled rejection → 退出碼 1
 *   （本機 timing 剛好先 resolve 看似綠，CI 慢一點就 race 到紅）。這是 boot smoke 的
 *   teardown race。用 preview 注入關卡 → 根本不 fetch → 沒有 in-flight promise → 無 race，
 *   且 boot smoke 仍完整驗到「create 到 RUNNING + 系統接線」的真信號（不變）。
 *
 * 形狀對齊 config/levelSchema 的 LevelData（單一關、單一 Spawn 節點，已符 validateLevels）。
 */
const PREVIEW_LEVELS: LevelData[] = [
  {
    id: 'smoke-1',
    name: 'boot smoke',
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
let game: Phaser.Game | null = null;

afterEach(() => {
  game?.destroy(true);
  game = null;
  server?.close();
  server = null;
});

/**
 * 起一個只服務 public/ 的最小 HTTP server。
 * 注意：這裡只為 GameScene.preload() 的角色/特效 PNG（scene.load.image）服務；
 * 關卡 JSON 走 preview 注入不 fetch（見 PREVIEW_LEVELS 說明），故不再需要 fetch polyfill。
 *
 * ⚠️ 埠 3000 是寫死的（jsdom 文件 base URL 預設 http://localhost:3000/，Phaser 用它解相對
 * 資源路徑；不能改 ephemeral 埠否則資源解析會指向 3000 找不到）。因此不用 listen(0)，
 * 改用「EADDRINUSE 容錯沿用」：若 3000 已被別的測試檔 asset server（多人 S1/S2/本檔平行）
 * 或前次殘留佔用 → 沿用它（服務同一個 public/），不自己 listen、不持有（afterEach 不關）。
 * 只有自己成功 listen 時才持有並在 afterEach 關閉。呼應 QA 平行測試固定埠容錯慣例。
 */
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
        res.end('not found');
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

/**
 * 建一個 HEADLESS game。scene 不放進 config 陣列（避免無 data 自動啟動 → 觸發 fetch），
 * boot 後由呼叫端 game.scene.add(key, GameScene, true, {previewLevels}) 帶 data 啟動。
 */
function createHeadlessGame(): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.HEADLESS,
    width: 800,
    height: 600,
    audio: { noAudio: true },
    banner: false,
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 } } },
    // 走 img.src 直載（配合 setup 的 onload 墊片），避開 jsdom XHR→blob 無法解碼的路徑。
    loader: { imageLoadType: 'HTMLImageElement' },
  });
}

/** 等 game READY（或逾時）。 */
async function waitReady(g: Phaser.Game, timeoutMs = 5000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    g.events.once(Phaser.Core.Events.READY, () => resolve(true));
    setTimeout(() => resolve(false), timeoutMs);
  });
}

/**
 * pump 場景管理器，直到目標場景進入 RUNNING（create() 完整跑完）或逾時。
 * 全程捕捉 create() 期間丟出的例外（Phaser 從 loader COMPLETE 事件呼叫 create，
 * 例外可能以 uncaughtException 冒出而非直接 throw 回這裡）。
 */
async function bootToRunning(
  g: Phaser.Game,
  key: string,
  maxIterations = 500,
): Promise<{ scene: Phaser.Scene | null; running: boolean; errors: string[] }> {
  const sm = g.scene as unknown as { update: (t: number, d: number) => void };
  const errors: string[] = [];
  const onUncaught = (e: unknown): void => {
    errors.push((e as Error)?.message ?? String(e));
  };
  process.on('uncaughtException', onUncaught);
  try {
    let t = 16;
    for (let i = 0; i < maxIterations; i++) {
      try {
        sm.update(t, 16); t += 16;
        sm.update(t, 16); t += 16;
        sm.update(t, 16); t += 16;
      } catch (e) {
        errors.push((e as Error)?.message ?? String(e));
      }
      await tick(); // 讓 img onload microtask 觸發
      const scene = g.scene.getScene(key);
      if (scene && scene.sys.settings.status === Phaser.Scenes.RUNNING) {
        return { scene, running: true, errors };
      }
    }
    return { scene: g.scene.getScene(key), running: false, errors };
  } finally {
    process.off('uncaughtException', onUncaught);
  }
}

describe('boot smoke — GameScene 接線 + create 跑通', () => {
  it('遊戲能 boot、GameScene.create() 完整跑到 RUNNING、系統依序接上 registry、無 create 期例外', async () => {
    await startAssetServer();
    game = createHeadlessGame();

    const ready = await waitReady(game);
    expect(ready).toBe(true); // 環境陷阱沒處理好 → 根本不 READY（instrument 有效性檢查）

    // preview 模式啟動：帶 previewLevels → WaveSystem 不 fetch（消除 teardown race）。
    game.scene.add('GameScene', GameScene, true, { previewLevels: PREVIEW_LEVELS });

    const { scene, running, errors } = await bootToRunning(game, 'GameScene');

    // 鑑別點 1：create() 期間不得有例外（某 system.init 一跑就爆會在這裡被抓）。
    // 過濾掉 destroy 之後才冒出的 loader teardown 雜訊（nextFile）。
    const createErrors = errors.filter((m) => !m.includes('nextFile'));
    expect(createErrors).toHaveLength(0);

    // 鑑別點 2：必須真的到 RUNNING(5)。Phaser 只在 create() 全程跑完才設 RUNNING；
    // create() 中途丟例外會卡在 CREATING(4) → 這裡會紅。
    expect(running).toBe(true);

    // 鑑別點 3：系統以【正確順序】全數接上 registry。少接/多接/順序錯 → 這條相等斷言紅。
    const systems = (scene as unknown as { systems?: Array<{ name: string }> }).systems;
    expect(systems?.map((s) => s.name)).toEqual([...EXPECTED_SYSTEMS]);
  }, 30000);

  it('RUNNING 後 step 數幀，全程不丟例外（每幀 system.update 都跑）', async () => {
    await startAssetServer();
    game = createHeadlessGame();
    await waitReady(game);
    game.scene.add('GameScene', GameScene, true, { previewLevels: PREVIEW_LEVELS });
    const { scene, running } = await bootToRunning(game, 'GameScene');
    expect(running).toBe(true);

    const sm = game.scene as unknown as { update: (t: number, d: number) => void };
    const stepErrors: unknown[] = [];
    let t = 100000;
    for (let i = 0; i < 10; i++) {
      try {
        sm.update(t, 16);
        t += 16;
      } catch (e) {
        stepErrors.push(e);
      }
    }
    // 抓「某系統每幀 update 一跑就爆」這類執行期接線斷裂。
    expect(stepErrors).toHaveLength(0);
    // 場景在 step 後仍為 RUNNING（沒被打掛）。
    expect(scene?.sys.settings.status).toBe(Phaser.Scenes.RUNNING);
  }, 30000);
});
