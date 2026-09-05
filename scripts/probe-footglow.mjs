// #6 foot glow alignment probe: 進場後讀 player sprite 中心 vs footGlow 中心，確認對齊。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.map': 'application/json' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/' || u === '') u = '/index.html';
  const fp = path.join(distDir, u);
  if (!fp.startsWith(distDir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.statusCode = 404; res.end('404'); return; }
  res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500); // GameScene create
// 投幣進場 P1（C 鍵），等落地
await page.keyboard.press('c');
await page.waitForTimeout(1500);
// 移動一下（D 右移）看環有沒有跟上
await page.keyboard.down('d');
await page.waitForTimeout(500);
await page.keyboard.up('d');
await page.waitForTimeout(300);

const r = await page.evaluate(() => {
  const g = window.__PHASER_GAME__;
  const gs = g.scene.getScene('GameScene');
  // 透過 registry 拿 ctx? 沒暴露；改從 scene children 找 footGlow(depth -10) + 角色 sprite。
  // 直接反射：GameScene 的 ctx 沒公開，改抓場上物件。
  const kids = gs.children.list;
  const glows = kids.filter((o) => o.type === 'Graphics' && o.depth === -10);
  // 角色 sprite：Sprite 類、depth 較高、有 texture
  const sprites = kids.filter((o) => o.type === 'Sprite' && o.depth === 10);
  const out = { glowCount: glows.length, sprites: sprites.length, pairs: [] };
  // 抓第一個活躍玩家 sprite（depth 10 = PLAY_DEPTH）與最近的 glow 比對
  for (const s of sprites.slice(0, 2)) {
    let best = null, bd = 1e9;
    for (const gl of glows) { const d = Math.hypot(gl.x - s.x, gl.y - s.y); if (d < bd) { bd = d; best = gl; } }
    if (best) out.pairs.push({ spriteX: Math.round(s.x), spriteY: Math.round(s.y), glowX: Math.round(best.x), glowY: Math.round(best.y), dx: Math.round(best.x - s.x), dy: Math.round(best.y - s.y) });
  }
  return out;
});
console.log('[#6 probe]', JSON.stringify(r));
await page.screenshot({ path: path.join(__dirname, '..', 'probe-footglow.png') });
console.log('[#6 probe] screenshot: probe-footglow.png');
await browser.close();
server.close();
