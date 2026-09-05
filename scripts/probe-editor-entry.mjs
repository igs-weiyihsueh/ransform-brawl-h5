// headless probe: 遊戲右下角「編輯器入口」——驗按鈕出現/位置(右下)/展開/連結在 Pages 子路徑下指對且可開。
// 用法: node scripts/probe-editor-entry.mjs   (以 sub 模式模擬 /ransform-brawl-h5/)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(path.resolve(__dirname, '..'), 'dist');
const BASE = '/ransform-brawl-h5';
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.map': 'application/json', '.css': 'text/css',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.startsWith(BASE)) urlPath = urlPath.slice(BASE.length);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  let filePath = path.join(distDir, urlPath);
  // 目錄請求 → 補 index.html（模擬 GitHub Pages）。
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  if (!filePath.startsWith(distDir) || !fs.existsSync(filePath)) {
    res.statusCode = 404; res.end('404'); return;
  }
  res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}${BASE}/`;
console.log(`[probe] serving dist(sub) at ${url}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// 1) 入口按鈕存在 + 右下角。
const summary = page.locator('#editor-entry > summary');
const box = await summary.boundingBox();
const vp = page.viewportSize();
console.log('[probe] ⚙按鈕 box=', box && { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width) });
console.log('[probe] 右下角?', box ? (box.x + box.width > vp.width - 60 && box.y + box.height > vp.height - 60) : false);

// 2) 展開 → 4 連結 href 解析後的絕對 URL。
await summary.click();
await page.waitForTimeout(200);
const links = await page.$$eval('#editor-entry .editor-links a', (as) =>
  as.map((a) => ({ text: a.textContent, href: a.href })),
);
console.log('[probe] 連結:');
for (const l of links) console.log(`   ${l.text} -> ${l.href}`);

// 3) 每個連結實際 GET 是否 200（Pages 子路徑下能開）。
for (const l of links) {
  const r = await page.request.get(l.href);
  console.log(`[probe] GET ${new URL(l.href).pathname} -> ${r.status()}`);
}

await page.screenshot({ path: path.join(path.resolve(__dirname, '..'), 'probe-shot-editor-entry.png') });
console.log('[probe] screenshot: probe-shot-editor-entry.png');
await browser.close();
server.close();
