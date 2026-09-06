// 七輪#11 驗: 衝刺時 surround 失效 + 穿過敵人(不被真空/菁英擋直直衝)。
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
await page.waitForTimeout(3300);
await page.keyboard.press('KeyC'); await page.waitForTimeout(400);
const r = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite; psp.x=500; psp.y=500;
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  // 在玩家右方放菁英(immovable, 像牆), 讓玩家往右衝穿過牠。
  const elite = ctx.spawner.spawn('Enemy_Elite', 700, 500);
  const eStartX = elite.anim.sprite.x;
  // surround adapter isSurroundActive 衝刺前後。
  const adapter = ctx.spawner.playerAsSurroundTarget ? ctx.spawner.playerAsSurroundTarget(p) : null;
  const activeBefore = adapter ? adapter.isSurroundActive() : null;
  // 開始往右衝。
  p.startDash({ x: 1, y: 0 });
  const activeDuring = adapter ? adapter.isSurroundActive() : null;
  const x0 = psp.x;
  // 跑衝刺(真實迴圈驅動 updateDash + spawner)。
  let passedElite=false, minGap=9999;
  for(let f=0; f<40 && p.isDashing(); f++){
    await new Promise((r)=>setTimeout(r,16));
    const gap = Math.abs(psp.x - elite.anim.sprite.x);
    if(gap<minGap) minGap=Math.round(gap);
    if(psp.x > elite.anim.sprite.x + 20) passedElite=true; // 玩家 x 越過菁英右側 = 穿過
  }
  const x1 = psp.x;
  return { activeBefore, activeDuring, eliteMoved: Math.round(elite.anim.sprite.x - eStartX),
    playerDx: Math.round(x1-x0), passedElite, minGapDuringDash: minGap, eliteX:Math.round(elite.anim.sprite.x), playerX:Math.round(x1) };
});
console.log('[七輪#11 衝刺穿越驗]'); console.log(JSON.stringify(r, null, 1));
console.log('  衝刺前 isSurroundActive:', r.activeBefore, ' 衝刺中:', r.activeDuring, (r.activeBefore===true && r.activeDuring===false)?'PASS(衝刺中 surround 失效)':'FAIL');
console.log('  玩家往右位移', r.playerDx, 'px, 越過菁英?', r.passedElite, r.passedElite?'PASS(穿過菁英直直衝)':'FAIL(被菁英擋住沒穿過)');
console.log('  菁英被玩家真空推動?', r.eliteMoved, 'px', Math.abs(r.eliteMoved)<=3?'PASS(衝刺中不推怪)':'(菁英immovable本不太動)');
await browser.close(); server.close();
console.log('DONE');
