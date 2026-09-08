// 閒置被抓秒數調整 UI 驗證：編輯器頂列「被抓觸發▾」展開 idleTriggerSec 滑桿(2~15，現 8)，
// 讀現值、調→寫 override {version:1,idleTriggerSec}、提示重開。
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

const KEY='transformbrawl:grab';
const readStore=()=>page.evaluate((k)=>window.localStorage.getItem(k),KEY);

await page.click('.tb-editor-entry-btn');
await page.waitForTimeout(500);
// 點「被抓觸發▾」展開。
await page.click('.tb-editor-grab-btn');
await page.waitForTimeout(300);
const info = await page.evaluate(() => {
  const panel = document.querySelector('.tb-editor-grab-panel');
  const r = document.querySelector('.tb-editor-grab-range');
  const ro = document.querySelector('.tb-editor-grab-readout');
  const title = document.querySelector('.tb-editor-grab-title')?.textContent;
  return {
    visible: panel ? getComputedStyle(panel).display!=='none' : false,
    title, val: r?.value, min: r?.min, max: r?.max, readout: ro?.textContent,
  };
});
await page.screenshot({ path:'/tmp/grab-idle-panel.png' });

// 調到 12 秒 → change 寫 override。
await page.evaluate(() => {
  const r = document.querySelector('.tb-editor-grab-range');
  r.value = '12';
  r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(300);
const store = await readStore();
const status = await page.$eval('.tb-editor-status',(e)=>e.textContent).catch(()=>null);
await page.screenshot({ path:'/tmp/grab-idle-changed.png' });
const parsed = store ? JSON.parse(store) : null;

const pass=(b)=>b?'PASS':'★FAIL';
console.log('[閒置被抓秒數調整 UI 驗證]');
console.log('  面板:', JSON.stringify(info));
console.log('     - 展開+標題含被抓:', pass(info.visible && /被抓/.test(info.title||'')));
console.log('     - 預設 8 秒、範圍 2~15:', pass(info.val==='8' && info.min==='2' && info.max==='15'));
console.log('     - readout「8 秒」:', pass(/8\s*秒/.test(info.readout||'')));
console.log('  調 12 後 override:', store);
console.log('     - override idleTriggerSec=12:', pass(parsed && parsed.idleTriggerSec===12 && parsed.version===1));
console.log('     - 提示重開:', pass(!!status && status.includes('重開')));
console.log('  截圖: /tmp/grab-idle-panel.png(預設8) /tmp/grab-idle-changed.png(調12)');
await browser.close();server.close();console.log('DONE');
