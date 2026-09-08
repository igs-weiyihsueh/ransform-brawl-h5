// 用戶#3 投幣變身進場表演驗：浮起→發光變身(浮起中)→降臨→落地震退周圍敵人。
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

// 先放幾隻怪在場中央落點附近（供驗落地震退）。
await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  // 落點約 (640,360)；放 3 隻在範圍內。
  window.__probeEnemies=[];
  for(const dx of [-80,60,120]){ const e=ctx.spawner.spawn('Enemy_Rush', 640+dx, 360); window.__probeEnemies.push(e); }
});
// 記錄怪初始位置。
const before = await page.evaluate(()=> (window.__probeEnemies||[]).map(e=>({x:Math.round(e.anim.sprite.x),y:Math.round(e.anim.sprite.y)})));

// 投幣（C）→ 觀察浮起(sprite.y 上移)+變身時機。
await page.keyboard.press('KeyC');
let floatSeen=false, transformedDuringFloat=false, landed=false;
let baseY=null, minY=null;
for(let f=0; f<120; f++){
  await page.waitForTimeout(16);
  const s = await page.evaluate(()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
    const p=ctx.players[0]; const sp=p.anim.sprite;
    return {
      floating: p.isTransformFloating?.() ?? false,
      entering: p.isEntering?.() ?? false,
      transformed: ctx.transform.isTransformed(0),
      y: Math.round(sp.y),
    };
  });
  if(s.floating){ floatSeen=true; if(baseY===null)baseY=s.y; minY=(minY===null)?s.y:Math.min(minY,s.y); if(s.transformed)transformedDuringFloat=true; }
  if(!s.floating && s.transformed && !s.entering){ landed=true; break; }
}
// 落地後震退：怪位置應被推開。
await page.waitForTimeout(200);
const after = await page.evaluate(()=> (window.__probeEnemies||[]).map(e=>({x:Math.round(e.anim.sprite.x),y:Math.round(e.anim.sprite.y)})));
const moved = before.map((b,i)=> Math.round(Math.hypot(after[i].x-b.x, after[i].y-b.y)));

console.log('[用戶#3 投幣變身進場表演驗]');
console.log('  ① 浮起: floatSeen=', floatSeen, 'baseY=', baseY, 'minY(最高)=', minY, floatSeen&&minY<baseY?'PASS(往上浮)':'FAIL');
console.log('  ② 浮起中發光變身: transformedDuringFloat=', transformedDuringFloat, transformedDuringFloat?'PASS(浮起時變身)':'FAIL');
console.log('  ③ 降臨落地: landed=', landed, landed?'PASS':'FAIL');
console.log('  ④ 落地震退周圍敵人位移(px):', JSON.stringify(moved), moved.every(m=>m>10)?'PASS(都被震開)':'FAIL(有沒動的)');
console.log('  總結:', floatSeen&&minY<baseY&&transformedDuringFloat&&landed&&moved.every(m=>m>10)?'ALL PASS ✓':'HAS FAIL ✗');
await browser.close(); server.close();
console.log('DONE');
