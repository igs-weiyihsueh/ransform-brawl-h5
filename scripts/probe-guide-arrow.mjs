// 六輪#9 驗: 指引箭頭在搜索圈邊緣附近(非離圈遠)、指向道具、清楚可見。
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
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3200);
await page.keyboard.press('KeyC'); await page.waitForTimeout(500);
const r = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const ts=(gs.systems||[]).find((x)=>x&&x.name==='TransformSystem');
  const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite; psp.x=640; psp.y=400;
  // 生一個有主道具(owner=P1)在遠處(讓箭頭顯示、不 hide)。
  ts.spawnItem && ts.spawnItem('initial', p.playerId, { x: 640+400, y: 400 });
  await new Promise((r)=>setTimeout(r,300));
  const vc = p.getVacuumCenter(); const vr = p.getVacuumRadius();
  // 攔截 drawArrow, 記錄本幀箭頭錨點。
  let anchor=null;
  const orig = ts.drawArrow ? ts.drawArrow.bind(ts) : null;
  if(orig){ ts.drawArrow = function(g,cx,cy,angle,size,color,alpha){ anchor={x:Math.round(cx),y:Math.round(cy),angle:Number(angle.toFixed(2)),size:Math.round(size)}; return orig(g,cx,cy,angle,size,color,alpha); }; }
  // 跑幾幀觸發 drawGuideArrows。
  for(let f=0;f<5;f++) await new Promise((r)=>setTimeout(r,16));
  if(orig) ts.drawArrow = orig;
  const distFromVac = anchor ? Math.round(Math.hypot(anchor.x-vc.x, anchor.y-vc.y)) : null;
  return { vacuumCenter:{x:Math.round(vc.x),y:Math.round(vc.y)}, vacuumRadius:Math.round(vr), anchor, distFromVac };
});
console.log('[#9 指引箭頭驗]'); console.log(JSON.stringify(r, null, 1));
if(r.anchor){
  const edge = r.vacuumRadius; const near = Math.abs(r.distFromVac - edge) <= 20; // 錨點距圈心 ≈ 圈半徑(貼邊)
  console.log('  箭頭錨點距搜索圈中心:', r.distFromVac, 'px vs 圈半徑', r.vacuumRadius, 'px →', near ? 'PASS(貼近圈邊, 差≤20px)' : 'FAIL(離圈遠, 差'+(r.distFromVac-edge)+'px)');
} else console.log('  FAIL: 沒攔到箭頭(可能被 hide/未顯)');
await page.screenshot({ path:'/tmp/guide-arrow.png' });
console.log('  截圖 /tmp/guide-arrow.png');
await browser.close(); server.close();
console.log('DONE');
