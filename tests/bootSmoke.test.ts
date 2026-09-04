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
 *   5. 資源以本機 HTTP server 服務 public/（loader 真的載得到），並用
 *      loader.imageLoadType='HTMLImageElement'（走 img.src 直載，配合上面 onload 墊片，
 *      避開 jsdom XHR→blob 這條在測試環境無法完成解碼的路徑）。
 *
 * 目前能達到的最遠點（誠實）：場景會走到 CREATING 狀態（create() 已完整執行、5 個系統都 init 完），
 * 之後 step 數幀不丟例外。RUNNING(5) 這一步在 jsdom+HEADLESS 下未穩定達到（見報告），
 * 但 create() 全程跑完 + 系統全接上 = 已足以抓「接線斷」這個目標。
 * 成功信號 = 場景進入 RUNNING(5)：Phaser 只有在 scene.create() 完整跑完（沒丟例外）後
 * 才把狀態設為 RUNNING；若 create() 中途丟例外，狀態會卡在 CREATING(4)。
 * 因此「有沒有到 RUNNING」正是「create() 接線有沒有全程跑通」的鑑別點。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import Phaser from 'phaser';
import { GameScene } from '../src/scenes/GameScene';

/** 期望的系統註冊順序（= 每幀執行順序，見 GameScene.registerSystems 的架構註解）。 */
const EXPECTED_SYSTEMS = [
  'PlayerControlSystem',
  'EnemySystem',
  'WaveSystem',
  'UISystem',
  'DebugSystem',
] as const;

const PUBLIC_DIR = join(process.cwd(), 'public');
const MIME: Record<string, string> = { '.png': 'image/png', '.json': 'application/json' };
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

let server: Server | null = null;
let game: Phaser.Game | null = null;
let originalFetch: typeof fetch | null = null;

afterEach(() => {
  game?.destroy(true);
  game = null;
  server?.close();
  server = null;
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
});

/** 起一個只服務 public/ 的最小 HTTP server（jsdom 的 asset 請求會打到 127.0.0.1:3000）。 */
async function startAssetServer(): Promise<void> {
  server = createServer(async (req, res) => {
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
  await new Promise<void>((r) => server!.listen(3000, '127.0.0.1', () => r()));

  // WaveSystem.init 會 fetch('assets/data/levels.json')（相對 URL）。node/jsdom 的 fetch
  // 無法解析相對 URL → reject → 因 WaveSystem 用 void fetch().then() 無 catch → 變 unhandled
  // rejection，讓 test process 退出碼變 1（Advisory CI 誤紅）。這裡把 global fetch 包一層：
  // 相對路徑補上本機 asset server 的 origin，讓關卡 JSON 真的載得到（也順帶測到真實載入路徑）。
  const realFetch = globalThis.fetch.bind(globalThis);
  originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && !/^https?:\/\//.test(input)) {
      const url = `http://127.0.0.1:3000/${input.replace(/^\//, '')}`;
      return realFetch(url, init);
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

/** 建一個 HEADLESS game，帶入場景陣列。 */
function createHeadlessGame(scenes: typeof GameScene[]): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.HEADLESS,
    width: 800,
    height: 600,
    audio: { noAudio: true },
    banner: false,
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 } } },
    // 走 img.src 直載（配合 setup 的 onload 墊片），避開 jsdom XHR→blob 無法解碼的路徑。
    loader: { imageLoadType: 'HTMLImageElement' },
    scene: scenes,
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
  it('遊戲能 boot、GameScene.create() 完整跑到 RUNNING、5 個系統依序接上 registry、無 create 期例外', async () => {
    await startAssetServer();
    game = createHeadlessGame([GameScene]);

    const ready = await waitReady(game);
    expect(ready).toBe(true); // 環境陷阱沒處理好 → 根本不 READY（instrument 有效性檢查）

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
    game = createHeadlessGame([GameScene]);
    await waitReady(game);
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
