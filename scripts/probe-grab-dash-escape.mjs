import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise((r)=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const b=await chromium.launch(); const pg=await b.newPage();
pg.on('pageerror',(e)=>console.log('[pageerror]',String(e).slice(0,150)));
await pg.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'}); await pg.waitForTimeout(2800);
await pg.keyboard.press('KeyC'); await pg.waitForTimeout(1500);
const r = await pg.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=gs.ctx; const p=ctx.players[0]; const sp=ctx.spawner;
  const grabSys=gs.systems.find(s=>s?.name==='GrabSystem');
  const out={ found:!!grabSys };
  const pc=p.getHitCenter();
  // 生 grabber 貼玩家、設成 grabber、種進 GrabSystem state 讓它 chase→touch
  const g=sp.spawn('Enemy_Rush', pc.x+30, pc.y);
  g.setGrabber(true);
  const st=grabSys.states.get(p.playerId) || grabSys.stateOf(p.playerId);
  st.grabber=g; st.grabbed=false; st.idle=0;
  // 手動推進 GrabSystem 幾幀讓 grabber 觸碰→grabbed
  for(let i=0;i<30;i++){ grabSys.update(1/60); }
  out.grabbedAfterChase = p.isGrabbed();
  out.animGrabbed = p.anim?.sprite?.anims?.currentAnim?.key ?? '(?)';
  const posGrabbed = p.getHitCenter(); out.posGrabbed={x:Math.round(posGrabbed.x),y:Math.round(posGrabbed.y)};
  // 掙脫：startDash（模擬被抓時觸發衝刺；朝右）
  p.startDash({x:1,y:0});
  out.dashingStarted = p.isDashing();
  // 推進：GrabSystem 應在下一幀偵測 dashEdge→escape；同時 updateDash 位移
  for(let i=0;i<20;i++){ grabSys.update(1/60); p.updateDash(1/60); }
  out.grabbedAfterDash = p.isGrabbed();
  const posAfter=p.getHitCenter(); out.posAfter={x:Math.round(posAfter.x),y:Math.round(posAfter.y)};
  out.movedRight = posAfter.x - posGrabbed.x;
  // 再推進看是否被拉回（grabber 放開後不應追回）
  for(let i=0;i<60;i++){ grabSys.update(1/60); }
  const posSettle=p.getHitCenter(); out.posSettle={x:Math.round(posSettle.x),y:Math.round(posSettle.y)};
  out.grabbedSettle=p.isGrabbed();
  return out;
});
console.log('GrabSystem found:', r.found);
console.log('#2 被抓中動畫:', r.animGrabbed, /idle/i.test(r.animGrabbed)?'PASS(idle)':'★非idle');
console.log('被抓成功:', r.grabbedAfterChase, r.grabbedAfterChase?'PASS':'(chase 未觸碰,看下)');
console.log('#1 startDash 觸發:', r.dashingStarted?'PASS(dashing)':'★沒觸發');
console.log('#1 衝刺後 grabbed 清:', r.grabbedAfterDash===false?'PASS(掙脫)':'★仍被抓', '| 往右移', r.movedRight,'px', r.movedRight>20?'PASS(衝出去)':'★沒動');
console.log('#1 沉澱後不被拉回:', r.grabbedSettle===false?'PASS(未再被抓)':'★又被抓', 'pos', JSON.stringify(r.posSettle));
await b.close(); server.close(); console.log('DONE');
