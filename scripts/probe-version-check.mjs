// 版本自動更新檢查驗：舊版 app 載入 → 遠端 version.json 換新 version → focus 觸發 checkOnce → 出現「有新版本」bar。
// 決定性：negative(同版不出 bar) + positive(換版出 bar) + 點更新觸發 reload。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname=path.dirname(fileURLToPath(import.meta.url));const distDir=path.join(__dirname,'..','dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};

// 可動態改的 version.json（模擬部署新版）。
let servedVersion = null; // null=用 dist 原檔
const server=http.createServer((q,s)=>{
  let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';
  if(u==='/version.json' && servedVersion){
    s.setHeader('Content-Type','application/json');s.end(JSON.stringify({version:servedVersion,commit:'newnew',builtAt:new Date().toISOString()}));return;
  }
  const fp=path.join(distDir,u);
  if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){s.statusCode=404;s.end('404');return;}
  s.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(s);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;

const currentVersion = JSON.parse(fs.readFileSync(path.join(distDir,'version.json'),'utf8')).version;
console.log('[版本更新檢查驗] 當前 build version =', currentVersion);

const b=await chromium.launch();const page=await b.newPage({viewport:{width:1280,height:720}});
let reloadRequested=false;
page.on('console',m=>{const t=m.text();if(/新版本|version/i.test(t))console.log('  [console]',t.slice(0,80));});
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});await page.waitForTimeout(2500);

// negative control：version.json 還是同版 → 不該有 bar。先觸發一次 focus check。
await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(400);
const barSameVer = await page.evaluate(()=>[...document.querySelectorAll('button')].some(el=>el.textContent==='立即更新'));
console.log('  [negative] 同版本→出現更新 bar?', barSameVer, barSameVer?'★FAIL(不該出)':'PASS(同版不誤報)');

// positive：模擬部署新版（換 version.json）→ 觸發 focus check → 該出 bar。
servedVersion = currentVersion + '-NEWDEPLOY';
await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
await page.waitForTimeout(700);
const barNewVer = await page.evaluate(()=>[...document.querySelectorAll('button')].some(el=>el.textContent==='立即更新'));
console.log('  [positive] 部署新版→出現更新 bar?', barNewVer, barNewVer?'PASS(偵測到新版、提示用戶)':'★FAIL(沒偵測到)');

// 點「立即更新」→ 觸發 reload。
if(barNewVer){
  page.on('framenavigated',()=>{reloadRequested=true;});
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent==='立即更新')?.click());
  await page.waitForTimeout(800);
  console.log('  [reload] 點立即更新→頁面 reload?', reloadRequested, reloadRequested?'PASS':'★FAIL');
}

const pass = !barSameVer && barNewVer && reloadRequested;
console.log('  總結:', pass?'ALL PASS ✓(同版不誤報 / 新版偵測提示 / 點更新 reload)':'★HAS FAIL');
await b.close();server.close();console.log('DONE');
