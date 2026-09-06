// 三輪#11 驗: 火雨 預警圈→火球從天墜落(y 高→落點)→落地爆炸+傷害同步。
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
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3800);
await page.keyboard.press('KeyC'); await page.waitForTimeout(500);
// 直接驅動 EffectSystem.fireballFall + fireStrikeFlash 驗序列(不等波次事件)。
const seq = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  window.__gs=gs; window.__ctx=ctx;
  const fx=ctx.effects;
  window.__landed=false;
  const x=640, y=400;
  // 火球墜落 1000ms 對齊, onLand 記錄。
  const spr = fx.fireballFall(x, y, 1000, ()=>{ window.__landed=true; fx.fireStrikeFlash(x,y,80); });
  window.__ball = spr;
  return { hasBall: !!spr, ballStartY: spr? Math.round(spr.y): null, landPointY: y };
});
console.log('[起始]', JSON.stringify(seq), '(火球起點 y 應遠小於落點 400 = 在上方)');
// 取樣墜落 y 遞減。
async function ballY(){ return page.evaluate(()=>{ const b=window.__ball; return { y: b&&b.active? Math.round(b.y): 'gone', landed: window.__landed }; }); }
await page.waitForTimeout(200); console.log('[t=200ms]', JSON.stringify(await ballY()));
await page.waitForTimeout(400); console.log('[t=600ms]', JSON.stringify(await ballY()));
await page.waitForTimeout(500); console.log('[t=1100ms 落地後]', JSON.stringify(await ballY()));
// 落地那刻爆炸有沒有(image at landing point, depth 高)。
const impact = await page.evaluate(()=>{
  const gs=window.__gs; const list=gs.children.list;
  const near=list.filter((o)=>o.type==='Image'&&Math.abs(o.x-640)<30&&Math.abs(o.y-400)<30);
  return { landed: window.__landed, imagesAtLandPoint: near.length };
});
console.log('[落地爆炸]', JSON.stringify(impact));
await browser.close(); server.close();
console.log('DONE');
