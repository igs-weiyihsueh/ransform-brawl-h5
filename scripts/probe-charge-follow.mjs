// 六輪#11 驗: 怪蓄力被推開時, 蓄力特效(chargeFx/aoeRingFx)跟著移動不留原地。
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
  // Elite: attackVfx='aoe' → 有 chargeFx + aoeRingFx。放攻擊距離內讓牠進 charge。
  const e = ctx.spawner.spawn('Enemy_Elite', c.x-120, c.y);
  // 等進 charge。
  let waited=0;
  while(e.state!=='charge' && waited<3000){ await new Promise((r)=>setTimeout(r,16)); waited+=16; }
  if(e.state!=='charge') return { err:'never entered charge', state:e.state };
  // 記錄蓄力特效初始位置。
  const fx0 = e.chargeFx ? {x:Math.round(e.chargeFx.x), y:Math.round(e.chargeFx.y)} : null;
  const ring0 = e.aoeRingFx ? {x:Math.round(e.aoeRingFx.x), y:Math.round(e.aoeRingFx.y)} : null;
  const ex0 = Math.round(e.anim.sprite.x);
  // 模擬被推開: 把怪往右瞬移 200px(像被 pushOut/separation 擠開)。
  e.anim.sprite.x += 200;
  // 撐住 charge 狀態(不讓 timer 到 0 出手)方便截圖看盤跟隨。
  e.timer = 999;
  // 跑幾幀讓 syncChargeFx 更新(仍在 charge)。
  for(let f=0; f<12 && e.state==='charge'; f++) await new Promise((r)=>setTimeout(r,16));
  const fx1 = e.chargeFx ? {x:Math.round(e.chargeFx.x), y:Math.round(e.chargeFx.y)} : null;
  const ring1 = e.aoeRingFx ? {x:Math.round(e.aoeRingFx.x), y:Math.round(e.aoeRingFx.y)} : null;
  const ex1 = Math.round(e.anim.sprite.x);
  return { state:e.state, ex0, ex1, moved: ex1-ex0, fx0, fx1, ring0, ring1,
    chargeFollowed: fx0&&fx1 ? (fx1.x - fx0.x) : null,
    ringFollowed: ring0&&ring1 ? (ring1.x - ring0.x) : null };
});
console.log('[#11 蓄力特效跟隨驗]'); console.log(JSON.stringify(r, null, 1));
if(!r.err){
  console.log('  怪 x 位移:', r.moved, 'px');
  console.log('  chargeFx x 跟隨:', r.chargeFollowed, 'px', Math.abs((r.chargeFollowed??0)-r.moved)<5 ? 'PASS(跟上怪)' : 'FAIL(沒跟上)');
  if(r.ring0) console.log('  aoeRingFx x 跟隨:', r.ringFollowed, 'px', Math.abs((r.ringFollowed??0)-r.moved)<5 ? 'PASS(跟上怪)' : 'FAIL(沒跟上)');
}
await page.screenshot({ path:'/tmp/charge-follow.png' });
console.log('  截圖 /tmp/charge-follow.png');
// 額外乾淨截圖: 把玩家挪走、只留蓄力中的 Elite + 其腳底盤, 確認盤在怪腳下。
await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite; if(psp){psp.x=300;psp.y=300;}
  const e=(ctx.spawner.enemies||[])[0]; if(e){ e.timer=999; }
});
await page.waitForTimeout(300);
await page.screenshot({ path:'/tmp/charge-follow-clean.png' });
console.log('  截圖 /tmp/charge-follow-clean.png (玩家挪走, 只留蓄力Elite+盤)');
await browser.close(); server.close();
console.log('DONE');
