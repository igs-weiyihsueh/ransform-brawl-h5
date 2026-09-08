// ① 角色編輯器改名+移入驗證：
//  - 開 overlay → 頂列已無「二段變身/數值▾/被抓觸發▾」鈕（乾淨）。
//  - tab「角色編輯器」→ mount 後有「全域玩法設定」區（二段變身 checkbox + 5 滑桿 + 閒置秒數）。
//  - 勾開二段變身 + 動滑桿 + 套用 → localStorage secondTransform/grab override 正確寫入。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(path.resolve(__dirname, '..'), 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json','.css':'text/css' };
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/'||u==='')u='/index.html'; let fp=path.join(distDir,u); if(fs.existsSync(fp)&&fs.statSync(fp).isDirectory())fp=path.join(fp,'index.html'); if(!fp.startsWith(distDir)||!fs.existsSync(fp)){res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1400,height:800} });
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil:'networkidle' });
await page.waitForTimeout(2500);

// 開編輯器 overlay。
await page.click('.tb-editor-entry-btn');
await page.waitForTimeout(400);

// ① 頂列不應再有二段變身/數值/被抓觸發鈕。
const topbar = await page.evaluate(() => {
  const has = (sel) => !!document.querySelector(sel);
  const tabLabels = Array.from(document.querySelectorAll('.tb-editor-tab')).map((t)=>t.textContent);
  return {
    hasSecondBtn: has('.tb-editor-second'),
    hasValuesBtn: has('.tb-editor-second-values-btn'),
    hasGrabBtn: has('.tb-editor-grab-btn'),
    tabLabels,
  };
});

// ② 點「角色編輯器」tab。
const charTab = await page.evaluate(() => {
  const t = Array.from(document.querySelectorAll('.tb-editor-tab')).find((x)=>x.textContent && x.textContent.includes('角色編輯器'));
  if (t) t.click();
  return !!t;
});
await page.waitForTimeout(800); // lazy import + mount

const globalSec = await page.evaluate(() => {
  const g = document.querySelector('#global-inspector');
  if (!g) return { hasGlobal: false };
  const rows = Array.from(g.querySelectorAll('.row'));
  const labels = rows.map((r)=>r.querySelector('label')?.textContent);
  const checkbox = g.querySelector('input[type="checkbox"]');
  const ranges = g.querySelectorAll('input[type="range"]');
  const h1 = document.querySelector('.tb-editor-root h1')?.textContent;
  return { hasGlobal: true, h1, labels, hasCheckbox: !!checkbox, rangeCount: ranges.length };
});
await page.screenshot({ path:'/tmp/char-editor-global.png' });

// ③ 勾開二段變身 + 調第1滑桿(累積) + 調閒置秒數 → 套用。
await page.evaluate(() => {
  const g = document.querySelector('#global-inspector');
  const cb = g.querySelector('input[type="checkbox"]');
  if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles:true })); }
  const ranges = g.querySelectorAll('input[type="range"]');
  // ranges: [energyPerKill, decayPerSec, scaleMult, attackRangeMult, fillThreshold, idleSec]
  const r0 = ranges[0]; r0.value = '0.3'; r0.dispatchEvent(new Event('input',{bubbles:true})); r0.dispatchEvent(new Event('change',{bubbles:true}));
  const rFill = ranges[4]; rFill.value = '0.6'; rFill.dispatchEvent(new Event('input',{bubbles:true})); rFill.dispatchEvent(new Event('change',{bubbles:true}));
  const rIdle = ranges[5]; rIdle.value = '11'; rIdle.dispatchEvent(new Event('input',{bubbles:true})); rIdle.dispatchEvent(new Event('change',{bubbles:true}));
});
// 按「套用到遊戲」。
await page.evaluate(() => {
  const btn = document.querySelector('#btn-apply');
  if (btn) btn.click();
});
await page.waitForTimeout(400);
const stores = await page.evaluate(() => ({
  second: window.localStorage.getItem('transformbrawl:secondTransform'),
  grab: window.localStorage.getItem('transformbrawl:grab'),
}));

const pass=(b)=>b?'PASS':'★FAIL';
console.log('[① 角色編輯器改名+移入 驗證]');
console.log('  頂列:', JSON.stringify(topbar));
console.log('     - 頂列已無二段變身/數值/被抓觸發鈕:', pass(!topbar.hasSecondBtn && !topbar.hasValuesBtn && !topbar.hasGrabBtn));
console.log('     - tab 有「角色編輯器」:', pass(topbar.tabLabels.some((l)=>l&&l.includes('角色編輯器'))), '（原招式編輯器）');
console.log('  角色編輯器 tab 點到:', pass(charTab));
console.log('  全域設定區:', JSON.stringify(globalSec));
console.log('     - h1=角色編輯器:', pass(globalSec.h1==='角色編輯器'));
console.log('     - 有 #global-inspector + checkbox + 6 ranges(5二段+1閒置):', pass(globalSec.hasGlobal && globalSec.hasCheckbox && globalSec.rangeCount===6));
console.log('  套用後 override:');
console.log('     second =', stores.second);
console.log('     grab   =', stores.grab);
const s = stores.second ? JSON.parse(stores.second) : null;
const gr = stores.grab ? JSON.parse(stores.grab) : null;
console.log('     - secondTransform enabled:true+energyPerKill 0.3+fillThreshold 0.6:', pass(s && s.enabled===true && Math.abs(s.energyPerKill-0.3)<0.001 && Math.abs(s.fillThreshold-0.6)<0.001));
console.log('     - grab idleTriggerSec 11:', pass(gr && gr.idleTriggerSec===11));
console.log('  截圖: /tmp/char-editor-global.png（角色編輯器全域設定區）');
await browser.close(); server.close();
console.log('DONE');
