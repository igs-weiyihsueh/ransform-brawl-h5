// headless probe: hitfeel-editor 頁——控制項在、按「觸發受擊」canvas 有白閃/火花像素變化 + 5連結入口。
// 用法: node scripts/probe-hitfeel-editor.mjs
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(path.resolve(__dirname, '..'), 'dist');
const BASE = '/ransform-brawl-h5';
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json','.css':'text/css' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u.startsWith(BASE)) u = u.slice(BASE.length);
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

// 1) 主頁右下角入口第 5 連結。
await page.goto(`http://127.0.0.1:${port}${BASE}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('#editor-entry > summary').click();
const links = await page.$$eval('#editor-entry .editor-links a', (as) => as.map((a) => ({ t: a.textContent, href: a.href })));
console.log('[probe] 入口連結數=', links.length);
const hf = links.find((l) => l.href.endsWith('/hitfeel-editor/'));
console.log('[probe] 打擊手感編輯器連結=', hf ? hf.href : '(缺!)');
if (hf) console.log('[probe] GET hitfeel-editor ->', (await page.request.get(hf.href)).status());

// 2) 開 hitfeel-editor 頁：控制項在 + 觸發受擊 canvas 變化。
await page.goto(`http://127.0.0.1:${port}${BASE}/hitfeel-editor/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const ctrlCount = await page.$$eval('.row', (rs) => rs.length);
const hasHitBtn = await page.locator('#btn-hit').count();
const hasCanvas = await page.locator('#preview').count();
console.log('[probe] 控制項 .row 數=', ctrlCount, ' 受擊鈕=', hasHitBtn, ' canvas=', hasCanvas);

// canvas baseline 取樣 → 點觸發受擊 → 幾幀內取樣，比對白閃/火花像素出現。
async function sampleWhiteSpark() {
  return page.evaluate(() => {
    const cv = document.getElementById('preview');
    const cx = cv.getContext('2d');
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    let white = 0, spark = 0;
    for (let i = 0; i < d.length; i += 8) {
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a > 200 && r > 240 && g > 240 && b > 240) white++;
      if (a > 150 && r > 220 && g > 200 && b > 60 && b < 200) spark++;
    }
    return { white, spark };
  });
}
const before = await sampleWhiteSpark();
await page.locator('#btn-hit').click();
let peak = { white: 0, spark: 0 };
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(30);
  const s = await sampleWhiteSpark();
  peak.white = Math.max(peak.white, s.white);
  peak.spark = Math.max(peak.spark, s.spark);
}
console.log('[probe] 受擊前 white/spark=', before, ' 受擊後峰值=', peak);

// 玩家 hitlag 控制項 + 預覽標記（新增 #3）：控制項有「玩家 hitlag」、觸發後攻擊者上方出現 ❄hitlag。
const hasHitlagCtrl = await page.evaluate(() =>
  [...document.querySelectorAll('.row label')].some((l) => l.textContent.includes('玩家 hitlag')),
);
console.log('[probe] 玩家 hitlag 控制項在?', hasHitlagCtrl);
await page.screenshot({ path: path.join(path.resolve(__dirname, '..'), 'probe-shot-hitfeel-editor.png') });
console.log('[probe] screenshot: probe-shot-hitfeel-editor.png');
await browser.close();
server.close();
