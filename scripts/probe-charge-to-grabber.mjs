// #2 診斷：怪蓄力中轉 grabber → chargeFx 有沒有被清（殘留原地）。
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
for (let i=0;i<8;i++){ await pg.keyboard.press('KeyC'); await pg.waitForTimeout(400);
  const w=await pg.evaluate(()=>window.__PHASER_GAME__.scene.getScene('GameScene').ctx.players[0].isWaiting?.()); if(w===false)break; }
// 生怪貼近玩家(進攻擊範圍會蓄力)，等它進 charge 態(chargeFx 建立)，然後 setGrabber(true)看 chargeFx 是否殘留。
const r = await pg.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const p=gs.ctx.players[0]; const sp=gs.ctx.spawner; const pc=p.getHitCenter();
  sp.spawn('Enemy_Rush', pc.x+120, pc.y); // 貼近→會進攻擊蓄力
  const e=sp.enemies[sp.enemies.length-1];
  // 等它進 charge（輪詢 state==='charge' 且 chargeFx 建立）。
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  let charged=false;
  for(let i=0;i<40;i++){ await sleep(80); if(e.state==='charge' && e.chargeFx){ charged=true; break; } }
  if(!charged) return { charged:false };
  const fxBefore = !!e.chargeFx;
  const fxPosBefore = e.chargeFx ? {x:Math.round(e.chargeFx.x),y:Math.round(e.chargeFx.y)} : null;
  // 轉 grabber。
  e.setGrabber(true);
  await sleep(120);
  const fxAfter = !!e.chargeFx; // 若仍非 null = 沒清 = 殘留
  const fxPosAfter = e.chargeFx ? {x:Math.round(e.chargeFx.x),y:Math.round(e.chargeFx.y)} : null;
  const enemyPos = e.getHitCenter();
  return { charged:true, fxBefore, fxAfter, fxPosBefore, fxPosAfter, enemyPos:{x:Math.round(enemyPos.x),y:Math.round(enemyPos.y)} };
});
console.log('[#2 蓄力轉抓人特效殘留 診斷]');
if(!r.charged) console.log('  ⚠️ 沒捕捉到 charge 態(可能沒進攻擊蓄力)');
else {
  console.log('  蓄力中 chargeFx 存在?', r.fxBefore, '位置', JSON.stringify(r.fxPosBefore));
  console.log('  轉 grabber 後 chargeFx 還在?', r.fxAfter, r.fxAfter ? '★殘留(沒清=bug)' : '已清(ok)', '位置', JSON.stringify(r.fxPosAfter));
  console.log('  怪當前位置', JSON.stringify(r.enemyPos), '(若 chargeFx 留原地 vs 怪移走 = 殘留)');
}
await b.close(); server.close(); console.log('DONE');
