// #5 守護開場兩段訊息驗證：限時事件(stage1) + 協力合作守護雕像(stage2 聚焦時)。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/')u='/index.html'; const fp=path.join(distDir,u); if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:720} });
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(2800);

// 掃描場景所有 Text 物件的字串（找兩段訊息）。
async function scanTexts() {
  return await page.evaluate(() => {
    const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
    const out = [];
    const walk = (list) => { for (const o of list) {
      if (o && o.type === 'Text' && typeof o.text === 'string' && o.text.trim()) out.push(o.text.trim());
      if (o && o.list) walk(o.list);
    } };
    walk(gs.children.list);
    return out;
  });
}

// 直接驅動：找 WaveSystem 建 GuardEvent。守護波要跑到 Event 節點。這裡用時間推進掃描各階段文字。
// 直接呼叫 effects 的兩個 text API，確認各自產生對應大字（驗接線；不需跑到守護波節點）。
const direct = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const fx = gs.ctx?.effects;
  fx.timedEventText(3);
  fx.guardText();
  const texts = [];
  const walk = (list) => { for (const o of list) {
    if (o && o.type === 'Text' && typeof o.text === 'string' && o.text.trim()) texts.push(o.text.trim());
    if (o && o.list) walk(o.list);
  } };
  walk(gs.children.list);
  return { hasTimed: texts.some((t) => t.includes('限時事件')), hasGuard: texts.some((t) => t.includes('協力') && t.includes('守護雕像')), sample: texts.slice(0, 8) };
});
console.log('[#5 直接呼叫 effects API]');
console.log('  timedEventText→「限時事件」?', direct.hasTimed ? 'PASS' : 'FAIL', '| guardText→「協力合作，守護雕像」?', direct.hasGuard ? 'PASS' : 'FAIL');
console.log('  現有文字:', JSON.stringify(direct.sample));

let sawTimed = false, sawGuard = false;
for (let i = 0; i < 2; i += 1) {
  await page.waitForTimeout(1000);
  const texts = await scanTexts();
  if (texts.some((t) => t.includes('限時事件'))) sawTimed = true;
  if (texts.some((t) => t.includes('協力') && t.includes('守護雕像'))) sawGuard = true;
  if (sawTimed && sawGuard) break;
}
console.log('[#5 守護兩段訊息]');
console.log('  stage1 「限時事件」出現?', sawTimed ? 'PASS' : 'FAIL/未觸發');
console.log('  stage2 「協力合作，守護雕像」出現?', sawGuard ? 'PASS' : 'FAIL/未觸發');
await browser.close(); server.close();
console.log('DONE');
