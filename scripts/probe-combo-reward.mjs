// COMBO 獎 10 滑桿驗證（角色編輯器全域設定區）：
//  - 角色編輯器全域區有「COMBO 獎」10 滑桿，讀現值。
//  - 調數個 + 套用 → localStorage comboReward override 完整物件正確寫入。
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
// 點角色編輯器 tab。
await page.evaluate(() => {
  const t = Array.from(document.querySelectorAll('.tb-editor-tab')).find((x)=>x.textContent && x.textContent.includes('角色編輯器'));
  if (t) t.click();
});
await page.waitForTimeout(800);

// 讀全域區的 COMBO 獎滑桿（label + 值）。找 label 含 COMBO 相關關鍵字的 rows。
const combo = await page.evaluate(() => {
  const g = document.querySelector('#global-inspector');
  if (!g) return { ok: false };
  const rows = Array.from(g.querySelectorAll('.row'));
  const all = rows.map((r) => ({ label: r.querySelector('label')?.textContent, val: r.querySelector('input')?.value }));
  // COMBO 獎 section-title 存在？
  const titles = Array.from(g.querySelectorAll('.section-title')).map((t)=>t.textContent);
  return { ok: true, titles, labels: all.map((a)=>a.label), rangeTotal: g.querySelectorAll('input[type="range"]').length };
});
await page.screenshot({ path:'/tmp/combo-reward-10.png' });

// 調幾個 COMBO 獎滑桿（依 label 定位）+ 套用。
await page.evaluate(() => {
  const g = document.querySelector('#global-inspector');
  const rows = Array.from(g.querySelectorAll('.row'));
  const setByLabel = (kw, v) => {
    const row = rows.find((r) => (r.querySelector('label')?.textContent||'').includes(kw));
    const inp = row?.querySelector('input');
    if (inp) { inp.value = String(v); inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true})); }
  };
  setByLabel('獎勵量', 1.5);       // ticketMultiplier
  setByLabel('連段上限', 150);     // maxCount
  setByLabel('彩票噴發上限', 45);  // burstMaxTickets
  setByLabel('幾段噴滿張', 40);    // burstCountForMax
});
await page.evaluate(() => { const b = document.querySelector('#btn-apply'); if (b) b.click(); });
await page.waitForTimeout(400);
const store = await page.evaluate(() => window.localStorage.getItem('transformbrawl:comboReward'));
const p = store ? JSON.parse(store) : null;

const pass=(b)=>b?'PASS':'★FAIL';
console.log('[COMBO 獎 10 滑桿 驗證]');
console.log('  全域區 section-titles:', JSON.stringify(combo.titles));
console.log('     - 有「COMBO 獎」section:', pass(combo.titles && combo.titles.some((t)=>t&&t.includes('COMBO'))));
console.log('  COMBO 相關 label:', JSON.stringify(combo.labels.filter((l)=>/獎勵量|連段上限|計時窗|警告閃爍|報獎|彩票噴發|幾段噴滿/.test(l||''))));
console.log('     - 全域區 range 總數 16(6二段+1閒置+... 應含 10 COMBO)=至少 17:', pass(combo.rangeTotal>=17), '實際', combo.rangeTotal);
console.log('  套用後 comboReward override:', store);
console.log('     - ticketMultiplier 1.5:', pass(p && Math.abs(p.ticketMultiplier-1.5)<0.001));
console.log('     - maxCount 150:', pass(p && p.maxCount===150));
console.log('     - burstMaxTickets 45:', pass(p && p.burstMaxTickets===45));
console.log('     - burstCountForMax 40:', pass(p && p.burstCountForMax===40));
console.log('     - 10 欄都在:', pass(p && ['ticketMultiplier','maxCount','baseTimeout','timeoutDecay','minTimeout','warningTime','rewardDurationSec','burstMinTickets','burstMaxTickets','burstCountForMax'].every((k)=>typeof p[k]==='number')));
console.log('  截圖: /tmp/combo-reward-10.png');
await browser.close(); server.close();
console.log('DONE');
