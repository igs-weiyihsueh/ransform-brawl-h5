// 六輪#2(#8) 診斷: 衝鋒兵(Enemy_Rush)進 charge 後玩家跑開,出手時搆不到還揮(空揮)?
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
  const sys=(gs.systems||[]);
  const ctx = sys.find((x)=>x&&x.ctx)?.ctx;
  const player = ctx.players[0];
  const ppos = player.getHitCenter ? player.getHitCenter() : { x: player.sprite?.x, y: player.sprite?.y };
  // 直接用 spawner.spawn 生一隻 Rush 貼近玩家(避免等 wave)。
  const spawner = ctx.spawner;
  let rush = spawner.spawn('Enemy_Rush', ppos.x - 120, ppos.y); // 120px < 200px attackPx
  if(!rush) return { err:'spawn returned nothing' };
  const put = (e, x, y)=>{ if(e.anim?.sprite){ e.anim.sprite.x=x; e.anim.sprite.y=y; } };
  // tick 直到進 charge 狀態(chase→charge)。
  const log=[];
  let fired=false, reachAtFire=null, distAtFire=null;
  // 記錄原始 fireAttack, 攔截出手瞬間量測。
  const origFire = rush.fireAttack.bind(rush);
  rush.fireAttack = function(aim){
    fired=true;
    const bc = rush.getBodyCenter();
    const pp = ctx.players[0].getHitCenter ? ctx.players[0].getHitCenter() : aim;
    distAtFire = Math.hypot(pp.x-bc.x, pp.y-bc.y);
    reachAtFire = rush.canReachTarget ? rush.canReachTarget(pp) : (rush._canReach&&rush._canReach(pp));
    return origFire(aim);
  };
  // 追蹤: 進 charge 後把玩家瞬移遠離(模擬玩家跑開)。
  let movedPlayer=false;
  for(let f=0; f<120; f++){
    await new Promise((res)=>setTimeout(res, 16));
    if(rush.state==='charge' && !movedPlayer){
      const psp = ctx.players[0].sprite || ctx.players[0].anim?.sprite;
      if(psp){ psp.x = ppos.x + 600; psp.y = ppos.y; movedPlayer=true; log.push('charge偵測→玩家瞬移遠離(+600px)'); }
    }
    // charge 後跑開: 若已回 chase 或已過一段時間仍沒 fire → 記錄「不出手回 chase」。
    if(movedPlayer && !fired && (rush.state==='chase'||rush.state==='cooldown')) { log.push('出手前 re-check: 搆不到→回 '+rush.state+'(未空揮)'); break; }
    if(fired) break;
  }
  return { case:'A_跑開', state: rush.state, movedPlayer, fired, distAtFire, reachAtFire, log, attackRangePx: rush.cfg.attackRange*100 };
});
console.log('[衝鋒兵空揮診斷 — 修後]');
console.log(' Case A (charge後玩家跑開):', JSON.stringify(r));
console.log('  A 診斷:', (r.movedPlayer && !r.fired && (r.state==='chase'||r.state==='cooldown')) ? 'PASS 搆不到不出手、回 '+r.state+'(不空揮不發呆)' : (r.fired && r.reachAtFire===false ? 'FAIL 仍空揮' : '?'));

// Case B: 玩家留在範圍 → 正常出手命中。
const rB = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const sys=(gs.systems||[]);
  const ctx = sys.find((x)=>x&&x.ctx)?.ctx;
  const player = ctx.players[0];
  const ppos = player.getHitCenter ? player.getHitCenter() : { x: player.sprite?.x, y: player.sprite?.y };
  const spawner = ctx.spawner;
  const rush = spawner.spawn('Enemy_Rush', ppos.x - 120, ppos.y);
  if(!rush) return { err:'spawn nothing' };
  let fired=false, reachAtFire=null;
  const origFire = rush.fireAttack.bind(rush);
  rush.fireAttack = function(aim){ fired=true; const pp=ctx.players[0].getHitCenter?ctx.players[0].getHitCenter():aim; reachAtFire=rush.canReachTarget?rush.canReachTarget(pp):null; return origFire(aim); };
  // 玩家不動(留範圍內)。等出手。
  for(let f=0; f<120; f++){ await new Promise((res)=>setTimeout(res,16)); if(fired) break; }
  return { fired, reachAtFire, state: rush.state };
});
console.log(' Case B (玩家留範圍):', JSON.stringify(rB));
console.log('  B 診斷:', (rB.fired && rB.reachAtFire===true) ? 'PASS 搆得到正常出手(canReach=true)' : 'FAIL 沒正常出手');
await browser.close(); server.close();
console.log('DONE');
