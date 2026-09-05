// #8 statue probe: 用 preview 注入含 Event(Guard) 節點的關卡，推進到守護波，抓 GuardTarget 用真雕像圖。
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
await page.waitForTimeout(3500);

// 直接用 game API 啟動 GameScene 帶一個 Guard 節點的 preview 關卡，跳過 spawn。
const r = await page.evaluate(async () => {
  const g = window.__PHASER_GAME__;
  const level = { id: 'probe', nodes: [{ nodeType: 'Event', eventPresetName: 'Guard60' }] };
  g.scene.stop('BootScene');
  g.scene.stop('GameScene');
  g.scene.start('GameScene', { previewLevels: [level] });
  await new Promise((res) => setTimeout(res, 2500)); // 等 create + Guard 生 GuardTarget
  const gs = g.scene.getScene('GameScene');
  await new Promise((res) => setTimeout(res, 1500)); // 再等敵人生成靠近雕像
  const kids = gs.children.list;
  // GuardTarget 是 Container(depth 15) 內含雕像 image；找 depth 15 的 Container
  const containers = kids.filter((o) => o.type === 'Container' && o.depth === 15);
  let statueInfo = 'no-guard-container';
  let collision = 'n/a';
  if (containers.length) {
    const c = containers[0];
    const imgs = c.list.filter((o) => o.type === 'Image');
    if (imgs.length) {
      const im = imgs[0];
      statueInfo = { texture: im.texture?.key, displayW: Math.round(im.displayWidth), displayH: Math.round(im.displayHeight) };
    } else {
      statueInfo = 'container-no-image(fallback rectangle?)';
    }
    // 碰撞驗證：場上敵人 sprite 與雕像中心距離，應 >= 雕像半徑(不穿進體內)。
    const sprites = kids.filter((o) => o.type === 'Sprite' && o.depth !== 10 && o.depth !== 900);
    const dists = sprites.map((s) => Math.round(Math.hypot(s.x - c.x, s.y - c.y)));
    collision = { enemyCount: sprites.length, distsToStatue: dists.slice(0, 6) };
  }
  return { containers: containers.length, statueInfo, collision, statueExists: g.textures.exists('ui-statue') };
});
console.log('[#8 probe]', JSON.stringify(r));
await page.screenshot({ path: path.join(__dirname, '..', 'probe-statue.png') });
console.log('[#8 probe] screenshot: probe-statue.png');
await browser.close();
server.close();
