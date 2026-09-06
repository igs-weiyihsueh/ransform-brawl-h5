// 七輪#9回歸診斷: 首次進場初始道具 有沒有生成指引箭頭? 沒生成/被擋/淡太快?
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
await page.waitForTimeout(3000);
// 首次進場: 投幣 C(P1 從待機拋物線進場→落地 giveInitialItem)。
const r = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const ts=(gs.systems||[]).find((x)=>x&&x.name==='TransformSystem');
  const p=ctx.players[0];
  // 攔 drawArrow 記錄每次箭頭。
  const arrowLog=[];
  const orig = ts.drawArrow ? ts.drawArrow.bind(ts) : null;
  if(orig){ ts.drawArrow=function(g,cx,cy,angle,size,color,alpha){ arrowLog.push({cx:Math.round(cx),cy:Math.round(cy),alpha:Number((alpha||0).toFixed(2))}); return orig(g,cx,cy,angle,size,color,alpha); }; }
  return { hasDrawArrow: !!orig, waitingBefore: p.isWaiting?p.isWaiting():null, _stash: (window.__arrowLog__=arrowLog, true) };
});
// 投幣進場。
await page.keyboard.press('KeyC');
// 等進場落地+箭頭顯示中(約 t2s, alpha 1)截圖給 subagent。
await page.waitForTimeout(2000);
await page.screenshot({ path:'/tmp/first-entrance-arrow.png' });
console.log('  截圖 /tmp/first-entrance-arrow.png (箭頭顯示中 ~t2s)');
// 也記此刻箭頭 vs 道具位置。
const geo = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const ts=(gs.systems||[]).find((x)=>x&&x.name==='TransformSystem');
  const p=ctx.players[0];
  const it=(ts.items||[])[0];
  const ip=it?it.getPosition():null;
  const pp=p.getPosition();
  const log=window.__arrowLog__||[];
  const la=log.length?log[log.length-1]:null;
  return { player:{x:Math.round(pp.x),y:Math.round(pp.y)}, item:ip?{x:Math.round(ip.x),y:Math.round(ip.y)}:null,
    lastArrow:la, guideDepth: ts.guideGfx?ts.guideGfx.depth:null, itemDepth: it&&it.container?it.container.depth:null };
});
console.log('  幾何:', JSON.stringify(geo));
await browser.close(); server.close();
console.log('DONE');
