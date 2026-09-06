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
  ts.spawnItem && ts.spawnItem('initial', p.playerId, { x: 640+170, y: 400 });
  await new Promise((r)=>setTimeout(r,300));
  const vc = p.getVacuumCenter(); const vr = p.getVacuumRadius();
  const item = (ts.items&&ts.items[0]) ? ts.items[0].getPosition() : null;
  // 攔截 drawArrow, 記錄本幀箭頭 cx,cy,angle,size → 算尖端。
  let arrow=null;
  const orig = ts.drawArrow ? ts.drawArrow.bind(ts) : null;
  if(orig){ ts.drawArrow = function(g,cx,cy,angle,size,color,alpha){ arrow={cx,cy,angle,size}; return orig(g,cx,cy,angle,size,color,alpha); }; }
  for(let f=0;f<5;f++) await new Promise((r)=>setTimeout(r,16));
  if(orig) ts.drawArrow = orig;
  let tip=null, tipToItem=null, playerToItem=null;
  if(arrow){ tip={x:Math.round(arrow.cx+Math.cos(arrow.angle)*arrow.size), y:Math.round(arrow.cy+Math.sin(arrow.angle)*arrow.size)}; }
  if(tip&&item){ tipToItem=Math.round(Math.hypot(tip.x-item.x, tip.y-item.y)); }
  if(item){ const pp=p.getPosition(); playerToItem=Math.round(Math.hypot(pp.x-item.x, pp.y-item.y)); }
  return { vacuumCenter:{x:Math.round(vc.x),y:Math.round(vc.y)}, vacuumRadius:Math.round(vr),
    item: item?{x:Math.round(item.x),y:Math.round(item.y)}:null, playerToItem,
    arrow: arrow?{cx:Math.round(arrow.cx),cy:Math.round(arrow.cy),angDeg:Math.round(arrow.angle*180/Math.PI),size:Math.round(arrow.size)}:null,
    tip, tipToItem };
});
console.log('[#9 箭頭 vs 道具 診斷]'); console.log(JSON.stringify(r, null, 1));
if(r.arrow){
  console.log('  玩家→道具', r.playerToItem, 'px; 箭頭尖端→道具', r.tipToItem, 'px');
  console.log('  診斷:', r.tipToItem!=null && r.tipToItem < 40 ? 'BUG: 箭頭尖端太靠道具('+r.tipToItem+'px)→戳到/重疊道具 sprite' : '箭頭尖端離道具 '+r.tipToItem+'px');
}
await page.screenshot({ path:'/tmp/guide-arrow.png' });
console.log('  截圖 /tmp/guide-arrow.png');
await browser.close(); server.close();
console.log('DONE');
