// 匯入機制驗: localStorage override → 遊戲讀用戶設定 / 清掉→打包預設 / 壞JSON→fallback不炸。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/')u='/index.html'; const fp=path.join(distDir,u); if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;

async function bootRead(setupLocalStorage){
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{width:1280,height:720} });
  let crashed=false; page.on('pageerror',(e)=>{crashed=true; console.log('  [pageerror]',String(e).slice(0,120));});
  if(setupLocalStorage) await page.addInitScript(setupLocalStorage);
  await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
  await page.waitForTimeout(3500);
  await page.keyboard.press('KeyC'); await page.waitForTimeout(400);
  const r = await page.evaluate(()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
    const p=ctx.players[0];
    return { vacuumRadius: Math.round(p.getVacuumRadius()) };
  });
  await browser.close();
  return { ...r, crashed };
}

// A. 無 override → 打包預設(FOOT_GLOW.radiusPx=50)。
const a = await bootRead(null);
console.log('[A 無 override] vacuumRadius=', a.vacuumRadius, '(預設應 50)', a.vacuumRadius===50?'PASS':'?');

// B. override uiLayout(完整 layout + foot.searchRadiusPx=120) → 遊戲應讀到 120。
const fullLayout = JSON.parse(fs.readFileSync(path.join(distDir,'assets/data/uiLayout.json'),'utf8'));
fullLayout.foot.searchRadiusPx = 120;
const ovB = `localStorage.setItem('transformbrawl:uiLayout', ${JSON.stringify(JSON.stringify(fullLayout))});`;
const b = await bootRead(ovB);
console.log('[B override searchRadius=120] vacuumRadius=', b.vacuumRadius, b.vacuumRadius===120?'PASS(讀到用戶設定)':'FAIL');

// C. 壞 JSON override → fallback 不炸、回預設。
const ovC = `localStorage.setItem('transformbrawl:uiLayout', '{ not valid json ]');`;
const c = await bootRead(ovC);
console.log('[C 壞JSON override] vacuumRadius=', c.vacuumRadius, 'crashed=', c.crashed, (!c.crashed && c.vacuumRadius===50)?'PASS(fallback預設不炸)':'FAIL');

server.close();
console.log('DONE');
