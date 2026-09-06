// #1 grabber 修後驗證：grabber 能穩定貼到 touchDist 抓住（不被 resolvePenetration 推出、不左右晃）。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise((r)=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const b=await chromium.launch(); const pg=await b.newPage();
pg.on('pageerror',(e)=>console.log('[pageerror]',String(e).slice(0,150)));
await pg.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'}); await pg.waitForTimeout(2500);
// 投幣進場脫離 waiting（grabber 只對非待機玩家）。
for (let i=0;i<8;i++){ await pg.keyboard.press('KeyC'); await pg.waitForTimeout(400);
  const w=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');return gs.ctx.players[0].isWaiting?.();}); if(w===false)break; }
// 生一隻怪、強制設 grabber、放 GrabSystem grabber 狀態，跑幀看它貼近抓住。
const setup = await pg.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const p=gs.ctx.players[0]; const sp=gs.ctx.spawner;
  const pc=p.getHitCenter();
  sp.spawn('Enemy_Rush', pc.x+250, pc.y); // 生在右側 250px
  const e=sp.enemies[sp.enemies.length-1];
  const grab=(gs.systems||[]).find(s=>s&&s.name==='GrabSystem');
  // 直接注入 grabber 狀態（模擬 idle 滿觸發）。
  e.setGrabber(true);
  const st=grab.stateOf ? grab.stateOf(p.playerId) : null;
  if (st) { st.grabber=e; }
  return { touchDist: e.getHitRadius()+p.getHitRadius(), vacPush: e.getHitRadius()+(p.getVacuumRadius?.()??50) };
});
console.log('[#1 grabber 修後] touchDist(觸碰)=', Math.round(setup.touchDist), ' vs 舊推出基準=', Math.round(setup.vacPush));
// 跑 2.5s，記錄 grabber 到玩家距離 + 是否 grabbed。
let minDist=Infinity, grabbed=false, samples=[];
for (let i=0;i<25;i++){
  await pg.waitForTimeout(100);
  const r=await pg.evaluate(()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const p=gs.ctx.players[0]; const grab=(gs.systems||[]).find(s=>s&&s.name==='GrabSystem');
    const st=grab.stateOf?grab.stateOf(p.playerId):null;
    const e=st?.grabber; const pc=p.getHitCenter();
    if(!e) return { grabbed: st?.grabbed ?? false, dist: null };
    const ec=e.getHitCenter();
    return { grabbed: st?.grabbed ?? false, dist: Math.round(Math.hypot(ec.x-pc.x,ec.y-pc.y)) };
  });
  if(r.dist!==null){ minDist=Math.min(minDist,r.dist); samples.push(r.dist); }
  if(r.grabbed){ grabbed=true; break; }
}
console.log('  grabber 最近到玩家距離:', minDist, '(touchDist', Math.round(setup.touchDist),')');
console.log('  抓住(grabbed)?', grabbed ? 'PASS(穩定貼近抓住,不左右晃)' : '★FAIL(沒抓到)');
console.log('  距離樣本尾段:', JSON.stringify(samples.slice(-6)), '(應單調逼近到 touchDist 附近、非在 40~50 擺盪)');
await b.close(); server.close(); console.log('DONE');
