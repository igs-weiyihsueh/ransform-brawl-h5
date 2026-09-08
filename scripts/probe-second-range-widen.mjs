// 二段變身 5 滑桿 min/max 放寬驗證：角色編輯器全域區，讀各滑桿 min/max 屬性確認新範圍。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(path.resolve(__dirname, '..'), 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json','.css':'text/css' };
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/'||u==='')u='/index.html'; let fp=path.join(distDir,u); if(fs.existsSync(fp)&&fs.statSync(fp).isDirectory())fp=path.join(fp,'index.html'); if(!fp.startsWith(distDir)||!fs.existsSync(fp)){res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1400,height:900} });
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil:'networkidle' });
await page.waitForTimeout(2500);

await page.click('.tb-editor-entry-btn');
await page.waitForTimeout(400);
await page.evaluate(() => {
  const t = Array.from(document.querySelectorAll('.tb-editor-tab')).find((x)=>x.textContent && x.textContent.includes('角色編輯器'));
  if (t) t.click();
});
await page.waitForTimeout(800);

const ranges = await page.evaluate(() => {
  const g = document.querySelector('#global-inspector');
  const rows = Array.from(g.querySelectorAll('.row'));
  const get = (kw) => {
    const r = rows.find((x) => (x.querySelector('label')?.textContent||'').includes(kw));
    const inp = r?.querySelector('input');
    return inp ? { min: inp.min, max: inp.max } : null;
  };
  return {
    energyPerKill: get('累積速度'),
    decayPerSec: get('消退速度'),
    scaleMult: get('放大倍率'),
    attackRangeMult: get('攻擊範圍'),
    fillThreshold: get('集滿門檻'),
  };
});
await page.screenshot({ path:'/tmp/second-range-widened.png' });

const pass=(b)=>b?'PASS':'★FAIL';
const eq=(o,mn,mx)=>o && o.min===mn && o.max===mx;
console.log('[二段變身 5 滑桿範圍放寬 驗證]');
console.log('  energyPerKill:', JSON.stringify(ranges.energyPerKill), pass(eq(ranges.energyPerKill,'0.02','1')));
console.log('  decayPerSec  :', JSON.stringify(ranges.decayPerSec), pass(eq(ranges.decayPerSec,'0.02','1')));
console.log('  scaleMult    :', JSON.stringify(ranges.scaleMult), pass(eq(ranges.scaleMult,'1.1','3')));
console.log('  attackRangeMult:', JSON.stringify(ranges.attackRangeMult), pass(eq(ranges.attackRangeMult,'1','4')));
console.log('  fillThreshold:', JSON.stringify(ranges.fillThreshold), pass(eq(ranges.fillThreshold,'0.02','1')));
console.log('  截圖: /tmp/second-range-widened.png');
await browser.close(); server.close();
console.log('DONE');
