// 六輪#10 診斷: 怪被擠出地圖邊界外? 量化 x/y 超出 ENEMY_PLAY_BOUNDS/MAP_BOUNDS。
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

// 場景A: 玩家貼右邊界, 一堆怪從左湧來 surround → 外圈 slot 可能算到界外(x>maxX)。
const rA = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite;
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  psp.x=1740; psp.y=540; // 貼右界(maxX 1760)
  const sp=ctx.spawner; const c=p.getHitCenter();
  for(let i=0;i<14;i++){ sp.spawn('Enemy_Rush', c.x-200-(i%4)*40, c.y-120+(i%7)*40); }
  sp.spawn('Enemy_Elite', c.x-260, c.y);
  // 監看數秒, 記錄任何一幀怪超界的最大違規。
  let worst={dx:0,dy:0,key:null,x:0,y:0};
  const MB={minX:160,maxX:1760,minY:140,maxY:940};
  for(let f=0; f<220; f++){
    await new Promise((res)=>setTimeout(res,16));
    for(const e of (ctx.spawner.enemies||[])){
      const x=e.anim.sprite.x, y=e.anim.sprite.y;
      const rr = e.getHitRadius ? e.getHitRadius() : 45;
      const ox = Math.max(0, (MB.minX+rr)-x, x-(MB.maxX-rr));
      const oy = Math.max(0, (MB.minY+rr)-y, y-(MB.maxY-rr));
      if(ox>worst.dx||oy>worst.dy){ worst={dx:Math.round(Math.max(ox,worst.dx)),dy:Math.round(Math.max(oy,worst.dy)),key:e.cfg.characterKey,x:Math.round(x),y:Math.round(y),rr:Math.round(rr)}; }
    }
  }
  return { scenario:'A_玩家貼右界+左方湧怪', worst, MAP_BOUNDS:MB };
});
console.log('[#10 診斷 場景A]', JSON.stringify(rA));
console.log('  A: 最大超界 dx='+rA.worst.dx+'px dy='+rA.worst.dy+'px', rA.worst.dx>1||rA.worst.dy>1 ? '→ 怪超出界! '+rA.worst.key+' @('+rA.worst.x+','+rA.worst.y+')' : '→ 都在界內(clamp 有效)');
await page.screenshot({ path:'/tmp/oob-A.png' });

// 場景B: 守護波雕像貼近右界, 怪被 pushOutOfObstacle 頂離雕像→朝界外(pushOutOfObstacle 在 clamp 之後、無 re-clamp)。
const rB = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const wave=(gs.systems||[]).find((x)=>x&&x.name==='WaveSystem');
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  // 進守護波節點(建雕像 + setGuardTarget)。
  if(typeof wave.enterNode==='function') wave.enterNode(3);
  for(let f=0;f<6;f++) wave.update && wave.update(0.1);
  const gt = ctx.spawner.guardTarget;
  if(!gt) return { err:'no guardTarget after enterNode' };
  // 把雕像挪到貼右界(讓「雕像外緣→界外」)。
  const sr = gt.getHitRadius();
  const statueX = 1760 - sr + 30; // 雕像中心, 使右緣(statueX+sr)超過 maxX 一點
  if(gt.container){ gt.container.x=statueX; gt.container.y=540; } else if(gt.setPosition) gt.setPosition(statueX,540);
  // 在雕像與右界之間塞怪(x 在雕像右側), 讓 pushOutOfObstacle 把牠往右(界外)頂。
  const sp=ctx.spawner; const sc=gt.getHitCenter();
  for(let i=0;i<8;i++){ sp.spawn('Enemy_Rush', sc.x+10+(i%3)*8, sc.y-60+(i%5)*30); }
  let worst={dx:0,dy:0,key:null,x:0,y:0};
  const MB={minX:160,maxX:1760,minY:140,maxY:940};
  for(let f=0; f<200; f++){
    await new Promise((res)=>setTimeout(res,16));
    for(const e of (ctx.spawner.enemies||[])){
      const x=e.anim.sprite.x, y=e.anim.sprite.y;
      const rr = e.getHitRadius ? e.getHitRadius() : 45; // 用 body 半徑算 inset(clampToMapBounds 內縮 radiusPx)
      const ox=Math.max(0,(MB.minX+rr)-x, x-(MB.maxX-rr)), oy=Math.max(0,(MB.minY+rr)-y, y-(MB.maxY-rr));
      if(ox>worst.dx||oy>worst.dy) worst={dx:Math.round(Math.max(ox,worst.dx)),dy:Math.round(Math.max(oy,worst.dy)),key:e.cfg.characterKey,x:Math.round(x),y:Math.round(y),rr:Math.round(rr)};
    }
  }
  return { scenario:'B_守護雕像貼右界+怪夾其右', statueX:Math.round(statueX), statueR:Math.round(sr), statueNow:Math.round((gt.getHitCenter&&gt.getHitCenter().x)||-1), spawnerHasGuard: !!ctx.spawner.guardTarget, enemyCount:(ctx.spawner.enemies||[]).length, sampleXs:(ctx.spawner.enemies||[]).slice(0,5).map((e)=>Math.round(e.anim.sprite.x)), worst };
});
console.log('[#10 診斷 場景B]', JSON.stringify(rB));
if(!rB.err) console.log('  B: 最大超界 dx='+rB.worst.dx+'px dy='+rB.worst.dy+'px', rB.worst.dx>1||rB.worst.dy>1 ? '→ 怪超出界! '+rB.worst.key+' @('+rB.worst.x+','+rB.worst.y+') (pushOutOfObstacle 在 clamp 後無 re-clamp)' : '→ 都在界內');
await page.screenshot({ path:'/tmp/oob-B.png' });

// 場景C: 直接注入 mock guardTarget 貼右界 + 手動驅動 spawner.update, 隔離 WaveSystem 衝突。
// 驗證「pushOutOfObstacle 在 clampToMapBounds 之後、無 re-clamp」是否把怪頂出界。
const rC = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const sp=ctx.spawner;
  if(sp.clearAllEnemies) sp.clearAllEnemies();
  // mock 雕像貼右界(半徑大一點放大效果)。
  const SR=120, SX=1700, SY=540;
  const mock = { getHitCenter:()=>({x:SX,y:SY}), getHitRadius:()=>SR, getPosition:()=>({x:SX,y:SY}), takeDamage:()=>{}, isDefeated:()=>false };
  sp.setGuardTarget(mock);
  // 在雕像右側(界外方向)塞怪。
  for(let i=0;i<6;i++) sp.spawn('Enemy_Rush', SX+20+(i%3)*6, SY-40+(i%4)*25);
  const MB={minX:160,maxX:1760,minY:140,maxY:940};
  let worst={dx:0,x:0,rr:0};
  // 手動只驅動 spawner.update(不跑 WaveSystem, 避免它清怪/換節點)。
  for(let f=0; f<120; f++){
    sp.update(0.05);
    for(const e of (sp.enemies||[])){
      const x=e.anim.sprite.x, rr=e.getHitRadius?e.getHitRadius():45;
      const ox=Math.max(0, x-(MB.maxX-rr));
      if(ox>worst.dx) worst={dx:Math.round(ox),x:Math.round(x),rr:Math.round(rr)};
    }
  }
  sp.setGuardTarget(null);
  const finalXs=(sp.enemies||[]).map((e)=>Math.round(e.anim.sprite.x));
  sp.clearAllEnemies&&sp.clearAllEnemies();
  return { statue:{x:SX,r:SR}, maxXInset:MB.maxX, worst, finalXs, enemyCount: finalXs.length };
});
console.log('[#10 診斷 場景C 隔離 spawner + mock 雕像貼界]', JSON.stringify(rC));
console.log('  C: 最大右超界(過 maxX-rr) dx='+rC.worst.dx+'px @x='+rC.worst.x+'(rr'+rC.worst.rr+')', rC.worst.dx>2 ? '→ 怪被 pushOutOfObstacle 頂出界(clamp 後無 re-clamp)= 真因!' : '→ 界內');
await browser.close(); server.close();
console.log('DONE');
