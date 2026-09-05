// 火雨宣告字 probe: 啟動含 Guard 節點的 preview 關卡 → 火雨開始 → 抓「天降火雨！」大字滑入幀。
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// 啟動守護波 preview 關卡（→ FireRainSystem 開火雨 → 宣告字）。
await page.evaluate(() => {
  const g = window.__PHASER_GAME__;
  const level = { id: 'probe', nodes: [{ nodeType: 'Event', eventPresetName: 'Guard60' }] };
  g.scene.stop('BootScene');
  g.scene.stop('GameScene');
  g.scene.start('GameScene', { previewLevels: [level] });
});
await page.waitForTimeout(2500); // 等 create + Guard 啟動 + 宣告字滑入停留(3s 停留期間)

// 先檢查場景狀態：有沒有守護波 + 宣告字 Text 物件。
const state = await page.evaluate(() => {
  const g = window.__PHASER_GAME__;
  const gs = g.scene.getScene('GameScene');
  if (!gs || !gs.children) return { err: 'no-gamescene' };
  const texts = gs.children.list.filter((o) => o.type === 'Text').map((t) => ({ text: t.text, x: Math.round(t.x), depth: t.depth, alpha: t.alpha, visible: t.visible }));
  return { texts };
});
console.log('[fireRainAnnounce probe] 場上 Text 物件=', JSON.stringify(state));

// 取樣：畫面上半部找「天降火雨」黃字（#ffdd44≈(255,221,68)）。宣告字在中央略偏上、停留 3s。
const sample = await page.evaluate(() => {
  const g = window.__PHASER_GAME__;
  const cv = g && g.canvas;
  if (!cv) return { err: 'no-canvas' };
  const c = document.createElement('canvas');
  c.width = cv.width; c.height = cv.height;
  const cx = c.getContext('2d');
  cx.drawImage(cv, 0, 0);
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  let yellowText = 0;
  // 只掃上半部（宣告字在中央略偏上）。逐像素掃（大字筆畫）。
  for (let y = 0; y < c.height * 0.6; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (r > 210 && gg > 170 && b < 150 && r - b > 90) yellowText++;
    }
  }
  return { yellowText, w: c.width, h: c.height };
});
console.log('[fireRainAnnounce probe] 天降火雨黃字像素數=', JSON.stringify(sample));
await page.screenshot({ path: path.join(__dirname, '..', 'probe-shot-firerain-announce.png') });
console.log('[fireRainAnnounce probe] screenshot: probe-shot-firerain-announce.png');
await browser.close();
server.close();
