// headless probe: hitFeel 打擊瞬間——生一隻敵人貼近玩家、玩家攻擊，連拍數幀找白閃/火花。
// 用法: node scripts/probe-hitfeel.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(path.resolve(__dirname, '..'), 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.map': 'application/json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/' || u === '') u = '/index.html';
  let fp = path.join(distDir, u);
  if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
  if (!fp.startsWith(distDir) || !fs.existsSync(fp)) { res.statusCode = 404; res.end('404'); return; }
  res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// 用 __PHASER_GAME__ 確認遊戲起來（不深入 ctx，改用按鍵驅動 + canvas 取樣）。
const info = await page.evaluate(() => {
  const g = window.__PHASER_GAME__;
  if (!g) return { err: 'no game' };
  const scenes = g.scene.getScenes(true).map((s) => s.scene.key);
  return { ok: true, scenes };
});
console.log('[probe] game info=', info);

// 連拍：先截一張 baseline，再靠 debug 生怪(按 E 切/補) + 玩家貼近攻擊，連拍找火花色。
await page.keyboard.press('KeyR'); // 補一隻敵人（DebugSystem R）
await page.waitForTimeout(300);
await page.keyboard.press('KeyR'); // 再補一隻，提高貼到的機率
await page.waitForTimeout(300);
// 玩家往右移動貼近敵人（敵人生在 0.7*W 右側）
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(1100);
await page.keyboard.up('ArrowRight');

// 連續攻擊 + 每幀在 canvas 端取樣白閃(setTintFill 全白剪影)/白黃火花，取整段最大值。
let maxSpark = 0, maxWhite = 0;
for (let i = 0; i < 16; i++) {
  await page.keyboard.press('KeyZ');
  const s = await page.evaluate(() => {
    const g = window.__PHASER_GAME__;
    const cv = g && g.canvas;
    if (!cv) return { spark: 0, white: 0 };
    const c = document.createElement('canvas');
    c.width = cv.width; c.height = cv.height;
    const cx = c.getContext('2d');
    cx.drawImage(cv, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    let spark = 0, white = 0;
    for (let j = 0; j < d.length; j += 16) {
      const r = d[j], gg = d[j + 1], b = d[j + 2];
      if (r > 230 && gg > 215 && b > 70 && b < 190) spark++;
      if (r > 248 && gg > 248 && b > 248) white++;
    }
    return { spark, white };
  });
  if (s.spark > maxSpark) maxSpark = s.spark;
  if (s.white > maxWhite) maxWhite = s.white;
  if (i === 8) fs.writeFileSync(path.join(path.resolve(__dirname, '..'), 'probe-shot-hitfeel.png'), await page.screenshot());
  await page.waitForTimeout(55);
}
console.log('[probe] hitFeel 取樣(整段最大): 白黃火花 px=', maxSpark, ' 白閃剪影 px=', maxWhite);
console.log('[probe] saved a mid-attack frame: probe-shot-hitfeel.png');
await browser.close();
server.close();
