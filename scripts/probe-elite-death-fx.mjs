// 七輪#6 診斷: 菁英蓄力中被打死 → charge disk/aoeRing 殘留在場?
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
  const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite; psp.x=960; psp.y=540;
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  const e = ctx.spawner.spawn('Enemy_Elite', 960-120, 540);
  let w=0; while(e.state!=='charge'&&w<3000){ await new Promise((r)=>setTimeout(r,16)); w+=16; }
  if(e.state!=='charge') return { err:'never charge', state:e.state };
  const hadRing = !!e.aoeRingFx;
  // 記錄特效 sprite 的 active/scene 狀態(destroy 後 sprite.scene 變 null / active false)。
  const ringSpr = e.aoeRingFx;
  // 蓄力中打死(致死 damage)。
  e.takeHit(999, 3, { x: 960-160, y: 540 });
  await new Promise((r)=>setTimeout(r,300));
  const ringDestroyed = ringSpr ? (ringSpr.scene === null || ringSpr.active === false) : true;
  const stillRefRing = !!e.aoeRingFx;   // die 後 e.aoeRingFx 應被清 null(若有清)
  const stillRefDisk = !!e.chargeFx;
  return { state:e.state, dead:e.dead, hadRing, ringDestroyed, stillRefRing, stillRefDisk };
});
console.log('[七輪#6 菁英蓄力死特效殘留診斷]'); console.log(JSON.stringify(r, null, 1));
if(!r.err){
  console.log('  菁英蓄力中→進死亡?', (r.state==='death'||r.dead) ? 'yes(死了/死亡中)' : 'FAIL 沒死');
  console.log('  蓄力特效(aoeRing sprite)死後被 destroy?', r.ringDestroyed ? 'PASS(已清)' : 'BUG重現: 殘留在場(sprite 未 destroy)');
  console.log('  e.aoeRingFx/chargeFx 參考清 null?', (!r.stillRefRing && !r.stillRefDisk) ? 'PASS' : 'BUG: 參考還在(disk='+r.stillRefDisk+' ring='+r.stillRefRing+')');
}
await browser.close(); server.close();
console.log('DONE');
