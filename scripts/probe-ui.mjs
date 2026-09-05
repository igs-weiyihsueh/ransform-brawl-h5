// headless probe: 抓 bug3 彩票 UI icon 載入實況（console/requestfailed + textures.exists）
// 用法: node scripts/probe-ui.mjs [subpath]   subpath 省略=root serve，'sub'=模擬 /ransform-brawl-h5/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const mode = process.argv[2] === 'sub' ? 'sub' : 'root';
const BASE = mode === 'sub' ? '/ransform-brawl-h5' : '';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.map': 'application/json', '.css': 'text/css',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (BASE && urlPath.startsWith(BASE)) urlPath = urlPath.slice(BASE.length);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = path.join(distDir, urlPath);
  if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.statusCode = 404; res.end('404'); return;
  }
  res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}${BASE}/`;
console.log(`[probe] mode=${mode} serving dist at ${url}`);

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`[console.${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400 && /assets\//.test(r.url())) errors.push(`[http ${r.status()}] ${r.url()}`); });

await page.goto(url, { waitUntil: 'networkidle' });
// 等 GameScene 進來（BootScene delayedCall 600ms → GameScene create + loader）
await page.waitForTimeout(4000);

const result = await page.evaluate(() => {
  const g = window.__PHASER_GAME__ || (window.Phaser && window.Phaser.GAMES && window.Phaser.GAMES[0]);
  if (!g) return { error: 'no game instance found on window' };
  const keys = ['ui-ticket', 'ui-coin', 'ui-ring', 'ui-chest', 'ui-lamp', 'ui-platform', 'ui-statue'];
  const charSample = ['Human/idle/00', 'Enemy_Rush/idle/00'];
  const exists = {};
  for (const k of [...keys, ...charSample]) {
    const has = g.textures.exists(k);
    let size = null;
    if (has) { const t = g.textures.get(k)?.getSourceImage?.(); if (t) size = `${t.width}x${t.height}`; }
    exists[k] = { exists: has, size };
  }
  const sceneKeys = g.scene.scenes.map((s) => `${s.scene.key}:${s.scene.isActive() ? 'active' : 'inactive'}`);
  return { exists, scenes: sceneKeys };
});

console.log('[probe] textures:', JSON.stringify(result, null, 2));
console.log('[probe] errors/failed (' + errors.length + '):');
for (const e of errors.slice(0, 40)) console.log('   ' + e);

// 截圖存證（bottom panel 區域）：確認彩票圖真的畫出來、非黃塊。
const shotPath = path.join(root, `probe-shot-${mode}.png`);
await page.screenshot({ path: shotPath });
console.log('[probe] screenshot saved:', shotPath);

await browser.close();
server.close();
