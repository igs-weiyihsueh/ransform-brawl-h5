// 十六輪①修驗: 連打變身吸怪(applyMashAttract)期間, 蓄力中的怪站定不被吸 + chargeFx 貼合不留原地。
// 真因: applyMashAttract guard 漏 state==='charge'→蓄力怪被吸移動+沒 syncChargeFx→法陣盤分離。
// 修: applyMashAttract 加 if(state==='charge') return。此 probe 驗蓄力怪被吸時位置恆定 + chargeFx offset 貼合。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(500); // 進場

const r = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite; psp.x=640; psp.y=360;
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  // 放一隻非菁英怪在召喚陣吸怪範圍內(玩家腳下附近)且讓牠進 charge。
  const foot = p.getGroundFootCenter ? p.getGroundFootCenter() : {x:psp.x,y:psp.y+75};
  const e = ctx.spawner.spawn('Enemy_Rush', foot.x + 90, foot.y); // 吸怪範圍內
  // 強制進 charge（既有 probe 手法：等或直接設）。等其自然進 charge 或強制。
  let waited=0;
  while(e.state!=='charge' && waited<2500){ await new Promise((r)=>setTimeout(r,16)); waited+=16; }
  let forced=false;
  if(e.state!=='charge'){ e.state='charge'; if(e.syncChargeFxAfterMove) e.syncChargeFxAfterMove(); forced=true; }
  // ★撐住 charge 狀態不讓 timer 到 0 出手（同 probe-charge-follow），才驗得到吸怪期間的位移/分離。
  const holdCharge = ()=>{ if(e.state!=='charge'){ e.state='charge'; } e.timer=999; if(e.syncChargeFx){} };
  e.timer = 999;
  // 蓄力怪初始位置 + chargeFx offset。
  const ex0 = Math.round(e.anim.sprite.x), ey0 = Math.round(e.anim.sprite.y);
  const fx0 = e.chargeFx ? { x:Math.round(e.chargeFx.x), y:Math.round(e.chargeFx.y) } : null;
  const fxOff0 = fx0 ? { dx: fx0.x - ex0, dy: fx0.y - ey0 } : null;
  // 進連打變身: 連續 registerMashHit 灌滿 mash（吸怪期間）。
  const pid = p.playerId ?? 0;
  for(let i=0;i<40;i++){ ctx.transform.registerMashHit?.(pid); holdCharge(); await new Promise((r)=>setTimeout(r,16)); }
  // 吸怪跑幾幀（TransformSystem 每幀對範圍內怪 applyMashAttract；蓄力怪應被 charge-return 擋、不動）。
  for(let f=0; f<20; f++){ holdCharge(); await new Promise((r)=>setTimeout(r,16)); }
  // ★直接驗證守衛(不依賴 mash-active gating)：對蓄力怪直接連呼 applyMashAttract 往明顯偏移中心吸，
  //   有修=charge-return→0 位移；無修=被吸移動。決定性守衛驗（負對照會 FAIL）。
  const pullCenter = { x: e.anim.sprite.x - 300, y: e.anim.sprite.y };
  const dx0 = e.anim.sprite.x;
  for(let f=0; f<30; f++){ if(e.state!=='charge') e.state='charge'; e.applyMashAttract?.(pullCenter, 0.016); }
  const directPull = Math.round(Math.abs(e.anim.sprite.x - dx0));
  const ex1 = Math.round(e.anim.sprite.x), ey1 = Math.round(e.anim.sprite.y);
  const fx1 = e.chargeFx ? { x:Math.round(e.chargeFx.x), y:Math.round(e.chargeFx.y) } : null;
  const fxOff1 = fx1 ? { dx: fx1.x - ex1, dy: fx1.y - ey1 } : null;
  return {
    forced, state:e.state,
    enemyPos0:{x:ex0,y:ey0}, enemyPos1:{x:ex1,y:ey1},
    enemyMoved: Math.round(Math.hypot(ex1-ex0, ey1-ey0)),
    fxOff0, fxOff1,
    fxSeparation: fxOff0&&fxOff1 ? Math.round(Math.hypot(fxOff1.dx-fxOff0.dx, fxOff1.dy-fxOff0.dy)) : null,
    directPull,
  };
});
console.log('[十六輪① 連打吸怪蓄力怪站定+chargeFx貼合驗]'); console.log(JSON.stringify(r, null, 1));
if(r.state==='charge'){
  const okStill = r.enemyMoved <= 2; // 蓄力怪被吸時應站定(charge-return)
  const okAttach = r.fxSeparation !== null && r.fxSeparation <= 2; // chargeFx offset 貼合不變(不分離)
  console.log('  蓄力怪位移:', r.enemyMoved, 'px', okStill?'PASS(站定不被吸)':'FAIL(被吸移動)');
  console.log('  chargeFx 分離量:', r.fxSeparation, 'px', okAttach?'PASS(貼合不留原地)':'FAIL(分離)');
  const okDirect = r.directPull <= 1; // 守衛直驗: 蓄力怪直接被吸也 0 位移(charge-return)
  console.log('  ★守衛直驗 directPull:', r.directPull, 'px', okDirect?'PASS(charge-return 擋吸)':'FAIL(被吸移動→守衛沒生效)');
  console.log('  總結:', okStill&&okAttach&&okDirect ? 'ALL PASS ✓' : 'HAS FAIL ✗');
} else {
  console.log('  怪未進/未維持 charge, state=', r.state, '(驗證不成立, 需調整)');
}
await page.screenshot({ path:'/tmp/mash-charge-still.png' });
console.log('  截圖 /tmp/mash-charge-still.png');
await browser.close(); server.close();
console.log('DONE');
