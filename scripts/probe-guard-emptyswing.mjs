// 七輪#3 診斷: 守護波怪靠近雕像後不管打不打得到就空揮?
// 量化: 怪出手時 meleeCircle 有沒有碰到雕像 hit circle(碰=真打, 沒碰=空揮)。
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
  const wave=(gs.systems||[]).find((x)=>x&&x.name==='WaveSystem');
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  // 進守護波(建雕像+setGuardTarget)。
  if(typeof wave.enterNode==='function') wave.enterNode(3);
  for(let f=0;f<6;f++) wave.update && wave.update(0.1);
  const gt = ctx.spawner.guardTarget;
  if(!gt) return { err:'no guardTarget' };
  const sc = gt.getHitCenter(); const sr = gt.getHitRadius();
  // 攔截近戰攻擊(handleEnemyAttack 私有→改攔 Enemy.onAttack via spawn 後掛)。
  // 直接生一隻 Rush 攻擊雕像, 攔 fireAttack 的 onAttack meleeCircle 量測。
  // 把怪釘在雕像正下方 150px(statue 在上方): 攻擊 offset 是水平 facing→ meleeCircle 往側邊, 不朝上→搆不到上方雕像。
  const e = ctx.spawner.spawn('Enemy_Rush', sc.x, sc.y + 150);
  const psp = e.anim.sprite;
  // 攔 onAttack 記錄 meleeCircle vs 雕像 hit circle 是否相交。
  let fired=0, hitStatue=0, lastGap=null;
  const origOn = e.onAttack;
  e.onAttack = function(ev){
    if(ev.meleeCircle){
      fired++;
      const mc=ev.meleeCircle;
      const d = Math.hypot(mc.center.x-sc.x, mc.center.y-sc.y);
      const reaches = d <= (mc.radius + sr);
      if(reaches) hitStatue++;
      lastGap = { meleeCenterDist: Math.round(d), meleeRadius: Math.round(mc.radius), statueR: Math.round(sr), sum: Math.round(mc.radius+sr), reaches };
    }
    return origOn && origOn.call(e, ev);
  };
  // 每幀把怪釘回雕像正下方 150px, 看牠出手 meleeCircle 有沒有搆到上方雕像。
  for(let f=0; f<300 && fired<3; f++){ psp.x = sc.x; psp.y = sc.y + 150; await new Promise((r)=>setTimeout(r,16)); }
  const pinnedResult = { fired, hitStatue };
  // 側邊(雕像左側 100px): 水平 offset 對齊→ 應能真打(canReach=true 且命中)。
  fired=0; hitStatue=0;
  for(let f=0; f<300 && hitStatue<1; f++){ psp.x = sc.x - 100; psp.y = sc.y; await new Promise((r)=>setTimeout(r,16)); }
  return { statueR: Math.round(sr), attackRangePx: Math.round(e.cfg.attackRange*100),
    pinnedBelow: pinnedResult, sideLeft: { fired, hitStatue }, lastGap };
});
console.log('[七輪#3 守護波空揮診斷]'); console.log(JSON.stringify(r, null, 1));
if(!r.err){
  console.log('  釘雕像正下方(搆不到):出手', r.pinnedBelow.fired, '真打', r.pinnedBelow.hitStatue, '→', r.pinnedBelow.fired===0?'PASS(搆不到不揮=不空揮)':'FAIL(還空揮)');
  console.log('  釘雕像左側(搆得到):出手', r.sideLeft.fired, '真打', r.sideLeft.hitStatue, '→', r.sideLeft.hitStatue>0?'PASS(側邊能正常打到)':'FAIL(側邊也打不到)');
}
await browser.close(); server.close();
console.log('DONE');
