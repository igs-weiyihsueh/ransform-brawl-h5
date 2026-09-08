// 二段變身數值調整 UI 驗證：編輯器頂列「數值▾」展開 4 滑桿(累積/消退/放大/攻擊範圍)，
// 讀現值顯示、調→寫完整 override(含 enabled 不覆蓋開關)、提示重開。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(path.resolve(__dirname,'..'),'dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json','.css':'text/css'};
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/'||u==='')u='/index.html';let fp=path.join(distDir,u);if(fs.existsSync(fp)&&fs.statSync(fp).isDirectory())fp=path.join(fp,'index.html');if(!fp.startsWith(distDir)||!fs.existsSync(fp)){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise((r)=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',(e)=>console.log('  [pageerror]',String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});await page.waitForTimeout(2500);

const KEY='transformbrawl:secondTransform';
const readStore=()=>page.evaluate((k)=>window.localStorage.getItem(k),KEY);

// 開 overlay。
await page.click('.tb-editor-entry-btn');
await page.waitForTimeout(500);
// 先開二段變身開關（測連同數值寫不覆蓋 enabled）。
await page.click('.tb-editor-second');
await page.waitForTimeout(200);
const storeAfterOn = await readStore();

// 點「數值▾」展開滑桿。
await page.click('.tb-editor-second-values-btn');
await page.waitForTimeout(300);
const panelInfo = await page.evaluate(() => {
  const panel = document.querySelector('.tb-editor-second-values');
  const rows = Array.from(document.querySelectorAll('.tb-editor-second-row'));
  const sliders = rows.map((r) => ({
    label: r.querySelector('.tb-editor-second-label')?.textContent,
    val: r.querySelector('.tb-editor-second-range')?.value,
    min: r.querySelector('.tb-editor-second-range')?.min,
    max: r.querySelector('.tb-editor-second-range')?.max,
    readout: r.querySelector('.tb-editor-second-readout')?.textContent,
  }));
  return { visible: panel ? getComputedStyle(panel).display !== 'none' : false, count: rows.length, sliders };
});
await page.screenshot({ path:'/tmp/second-values-panel.png' });

// 調第 3 個滑桿(放大倍率 scaleMult)到 1.8 → change 事件寫 override。
await page.evaluate(() => {
  const ranges = document.querySelectorAll('.tb-editor-second-range');
  const r = ranges[2]; // scaleMult
  r.value = '1.8';
  r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(300);
const storeAfterSlider = await readStore();
const status = await page.$eval('.tb-editor-status', (e)=>e.textContent).catch(()=>null);
await page.screenshot({ path:'/tmp/second-values-changed.png' });

const parsed = storeAfterSlider ? JSON.parse(storeAfterSlider) : null;
const pass=(b)=>b?'PASS':'★FAIL';
console.log('[二段變身數值調整 UI 驗證]');
console.log('  開關 ON 後 override:', storeAfterOn);
console.log('  數值面板:', JSON.stringify(panelInfo));
console.log('     - 展開+4 滑桿:', pass(panelInfo.visible && panelInfo.count===4));
console.log('     - 4 label(累積/消退/放大/範圍):', pass(panelInfo.sliders.map(s=>s.label).join(',').match(/累積.*消退.*放大.*範圍/s)?true:false));
console.log('     - 範圍設定(scaleMult min1.1 max2):', pass(panelInfo.sliders[2]?.min==='1.1' && panelInfo.sliders[2]?.max==='2'));
console.log('  調 scaleMult→1.8 後 override:', storeAfterSlider);
console.log('     - override 寫入 scaleMult 1.8:', pass(parsed && Math.abs(parsed.scaleMult-1.8)<0.001));
console.log('     - enabled 保留 true(沒被覆蓋):', pass(parsed && parsed.enabled===true));
console.log('     - 4 數值欄都在:', pass(parsed && ['energyPerKill','decayPerSec','scaleMult','attackRangeMult'].every(k=>typeof parsed[k]==='number')));
console.log('     - 提示重開:', pass(!!status && status.includes('重開')));
console.log('  截圖: /tmp/second-values-panel.png(4 滑桿) /tmp/second-values-changed.png(調後)');
await browser.close();server.close();console.log('DONE');
