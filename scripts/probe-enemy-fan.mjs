// 七輪 扇形接線驗: 衝鋒兵出手播 enemyFan(非 slash)、對齊面向、scale 依範圍。
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
  const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite; psp.x=960; psp.y=500;
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  const fx = ctx.effects;
  let fanCalls=0, slashCalls=0, lastFan=null;
  const of=fx.enemyFan?.bind(fx), os=fx.enemySlash?.bind(fx);
  fx.enemyFan = function(x,y,ang,scale){ fanCalls++; lastFan={x:Math.round(x),y:Math.round(y),angDeg:Math.round(ang*180/Math.PI),scale:Number((scale||0).toFixed(2))}; return of&&of(x,y,ang,scale); };
  fx.enemySlash = function(...a){ slashCalls++; return os&&os(...a); };
  // 生 Rush 貼玩家左側(在攻擊範圍內, 面向右), 讓牠出手。
  const e = ctx.spawner.spawn('Enemy_Rush', 960-120, 500);
  // 跑到出手(chase→charge→attack fireAttack)。
  for(let f=0; f<200 && fanCalls===0; f++) await new Promise((r)=>setTimeout(r,16));
  // 出手瞬間標記(供外部立刻截圖)。
  window.__FAN_FIRED__ = fanCalls>0;
  return { rushAttackVfx: e.cfg.attackVfx, fanCalls, slashCalls, lastFan };
});
console.log('[七輪 扇形接線驗]'); console.log(JSON.stringify(r, null, 1));
console.log('  衝鋒兵 attackVfx =', r.rushAttackVfx, r.rushAttackVfx==='fan'?'(fan)':'');
console.log('  出手播 enemyFan(非 slash)?', (r.fanCalls>0 && r.slashCalls===0) ? 'PASS(fan='+r.fanCalls+' slash='+r.slashCalls+')' : 'FAIL(fan='+r.fanCalls+' slash='+r.slashCalls+')');
if(r.lastFan) console.log('  扇形 angleDeg=', r.lastFan.angDeg, 'scale=', r.lastFan.scale);
// 截圖: 直接在固定點播一個放大的扇形(隔離、保證可見), 立刻截圖(0.2s 內)。
const fanInfo = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite; if(psp){psp.x=300;psp.y=300;}
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  const texExists = gs.textures.exists('vfx-enemy-fan');
  // 攔截 add.image 抓 fan sprite。
  let spr=null; const orig=gs.add.image.bind(gs.add);
  gs.add.image=function(...a){ const s=orig(...a); if(a[2]==='vfx-enemy-fan') spr=s; return s; };
  ctx.effects.enemyFan && ctx.effects.enemyFan(640, 360, 0, 3.0);
  gs.add.image=orig;
  return { texExists, spr: spr? { x:Math.round(spr.x), y:Math.round(spr.y), dw:Math.round(spr.displayWidth), dh:Math.round(spr.displayHeight), depth:spr.depth, origin:[spr.originX,spr.originY], visible:spr.visible, alpha:spr.alpha } : null };
});
console.log('  fan tex 載入?', fanInfo.texExists, ' fan sprite:', JSON.stringify(fanInfo.spr));
await page.waitForTimeout(90);
await page.screenshot({ path:'/tmp/enemy-fan.png' });
console.log('  截圖 /tmp/enemy-fan.png (直接播放大扇形朝右)');
await browser.close(); server.close();
console.log('DONE');
