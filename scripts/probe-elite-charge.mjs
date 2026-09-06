// 六輪#2#3#4 驗: 菁英蓄力無腳底盤只留aoeRing(#2)、蓄力免疫被打斷+被推(#3)、aoeBurst對齊aoeRing 1:1(#4)。
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
  const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite; psp.x=960; psp.y=540;
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  const c=p.getHitCenter();
  const e = ctx.spawner.spawn('Enemy_Elite', c.x-120, c.y);
  let waited=0; while(e.state!=='charge' && waited<3000){ await new Promise((r)=>setTimeout(r,16)); waited+=16; }
  if(e.state!=='charge') return { err:'never charge', state:e.state };
  // #2: 菁英蓄力 → chargeFx(腳底盤)應為 null, aoeRingFx 應存在。
  const hasDisk = !!e.chargeFx;
  const hasRing = !!e.aoeRingFx;
  // #3a 免疫被推: 記錄位置, 呼叫 resolvePenetration(把玩家貼上去)+pushOutOfObstacle, 看 elite 有無位移。
  const x0=e.anim.sprite.x, y0=e.anim.sprite.y;
  e.resolvePenetration([{ pos:{x:x0+5,y:y0}, hitRadius:200, pushOut:()=>{} }]);
  e.pushOutOfObstacle({x:x0+5,y:y0}, 200);
  const movedByPush = Math.round(Math.hypot(e.anim.sprite.x-x0, e.anim.sprite.y-y0));
  // #3b 免疫被打斷: 受擊, 看 state 是否還 charge、chargeFx/ring 是否還在、hp 有無扣。
  const hp0=e.hp;
  e.takeHit(1, 3, {x:x0-50,y:y0});
  const stateAfterHit=e.state, ringAfterHit=!!e.aoeRingFx, hpAfterHit=e.hp;
  return { state:e.state, hasDisk, hasRing, movedByPush, x0:Math.round(x0),
    hp0, hpAfterHit, stateAfterHit, ringAfterHit };
});
console.log('[#2#3 菁英蓄力驗]'); console.log(JSON.stringify(r, null, 1));
if(!r.err){
  console.log('  #2 菁英無腳底盤只留aoeRing:', (!r.hasDisk && r.hasRing) ? 'PASS(chargeFx=null, aoeRing 有)' : 'FAIL(disk='+r.hasDisk+' ring='+r.hasRing+')');
  console.log('  #3a 蓄力免疫被推:', r.movedByPush<=1 ? 'PASS(位移'+r.movedByPush+'px)' : 'FAIL(被推 '+r.movedByPush+'px)');
  console.log('  #3b 蓄力免疫被打斷:', (r.stateAfterHit==='charge' && r.ringAfterHit && r.hpAfterHit<r.hp0) ? 'PASS(仍charge、ring在、hp照扣 '+r.hp0+'→'+r.hpAfterHit+')' : 'FAIL(state='+r.stateAfterHit+' ring='+r.ringAfterHit+' hp'+r.hp0+'→'+r.hpAfterHit+')');
}
// #4: aoeRing 擺法 vs aoeBurst 擺法 — 攔截兩者的 displaySize/圓心比對(同套=重合)。
const r4 = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const fx=ctx.effects;
  // 直接呼叫兩個特效(同圓心同半徑), 記錄各自生成 image 的 displaySize/depth/圓心。
  const R=90, CX=960, CY=540;
  const ring = fx.enemyAoeRing ? fx.enemyAoeRing(CX, CY, R) : null;
  let burstSpr=null;
  const origAdd = gs.add.image.bind(gs.add);
  gs.add.image = function(...a){ const s=origAdd(...a); burstSpr=s; return s; };
  fx.enemyAoeBurst && fx.enemyAoeBurst(CX, CY, R);
  gs.add.image = origAdd;
  const info=(s)=> s? { x:Math.round(s.x), y:Math.round(s.y), w:Math.round(s.displayWidth), h:Math.round(s.displayHeight), depth:s.depth } : null;
  return { ring:info(ring), burst:info(burstSpr), R };
});
console.log('[#4 aoeRing vs aoeBurst 擺法比對]', JSON.stringify(r4));
if(r4.ring && r4.burst){
  const sameCenter = r4.ring.x===r4.burst.x && r4.ring.y===r4.burst.y;
  const sameSize = Math.abs(r4.ring.w-r4.burst.w)<=2 && Math.abs(r4.ring.h-r4.burst.h)<=2;
  const bothRound = Math.abs(r4.burst.w-r4.burst.h)<=2; // burst 1:1 正圓(非壓扁)
  console.log('  #4 同圓心:', sameCenter?'PASS':'FAIL', ' 同尺寸(1:1):', sameSize?'PASS':'FAIL', ' burst正圓:', bothRound?'PASS':'FAIL');
}
// #2 視覺: 菁英蓄力中截圖(玩家挪走、只留菁英+aoeRing, 確認無腳底小盤)。
await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite; if(psp){psp.x=300;psp.y=300;}
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  const e=ctx.spawner.spawn('Enemy_Elite', 960, 540);
  let w=0; while(e.state!=='charge'&&w<3000){ await new Promise((r)=>setTimeout(r,16)); w+=16; }
  e.timer=999; // 撐住 charge 方便截圖
});
await page.waitForTimeout(400);
await page.screenshot({ path:'/tmp/elite-charge.png' });
console.log('  截圖 /tmp/elite-charge.png (菁英蓄力中: 只 aoeRing 無腳底盤)');
await browser.close(); server.close();
console.log('DONE');