// #4 驗證: FireRain Event 節點 → 遊戲觸發火雨(宣告字→預警圈落點)。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
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
// 啟動含 FireRain Event 節點的 preview 關卡。
await page.evaluate(() => {
  const g = window.__PHASER_GAME__;
  const level = { id: 'probe', nodes: [{ nodeType: 'Event', eventPresetName: 'FireRain' }] };
  g.scene.stop('BootScene'); g.scene.stop('GameScene');
  g.scene.start('GameScene', { previewLevels: [level] });
});
// 宣告字階段(~2.5s)：確認「天降火雨！」大字出現(火雨事件觸發了)。
await page.waitForTimeout(2500);
const announce = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const txt = gs.children.list.find((o) => o.type === 'Text' && o.text === '天降火雨！');
  return { announceVisible: !!txt && txt.visible, x: txt ? Math.round(txt.x) : null };
});
console.log('[#4 probe] 火雨事件宣告字=', JSON.stringify(announce));
// 宣告演完(3.8s)+ 火雨落下：等預警圈出現(fireWarningRing depth -5)。
await page.waitForTimeout(3500);
const rain = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const rings = gs.children.list.filter((o) => o.type === 'Graphics' && o.depth === -5);
  return { warningRings: rings.length };
});
console.log('[#4 probe] 火雨預警圈落點數=', JSON.stringify(rain));
await browser.close(); server.close();
