// 地雷實體驗：onMineTrap→定點鋪雷+預警圈→延遲爆→範圍內玩家+怪 applyStun 麻痺(不分敵我/不扣血)。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname=path.dirname(fileURLToPath(import.meta.url));const distDir=path.join(__dirname,'..','dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const v404=[];
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){if(/fx_mine_/.test(u))v404.push(u);s.statusCode=404;s.end('404');return;}s.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(s);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const b=await chromium.launch();const page=await b.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',e=>console.log('[err]',String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});await page.waitForTimeout(3200);
// 變身進場（玩家在場）。
await page.keyboard.press('KeyC');
for(let f=0;f<160;f++){await page.waitForTimeout(16);const t=await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];return !p.isWaiting?.()&&!p.isEntering?.()&&!p.isTransformFloating?.();});if(t)break;}
await page.waitForTimeout(150);
// 玩家挪到 (640,360)，生一隻怪也在附近，地雷點設在玩家腳下。
const setup = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; p.setPosition?.(640,360);
  if(ctx.spawner.clearAllEnemies)ctx.spawner.clearAllEnemies();
  ctx.spawner.spawn('Enemy_Rush',660,360); // 怪在地雷範圍內
  const mineSys=(gs.systems||[]).find(x=>x&&x.name==='MineTrapSystem');
  const pfoot=p.getFootPosition?.()??p.getPosition();
  // 觸發 onMineTrap：delaySec 短(0.4)方便驗、範圍大(200)、麻痺 1.5s。
  mineSys.deployMines({nodeType:'MineTrap', points:[{x:pfoot.x,y:pfoot.y}], delaySec:0.4, paralyzeSec:1.5, radiusPx:200});
  const e=ctx.getEnemies()[0];
  return {mineSysFound:!!mineSys, pStunnedNow:p.isStunned(), eStunnedNow:e?.isStunned?.()??null, credit:ctx.credit.getCredit(0), energy:ctx.getSecondTransformEnergyRatio?.(0)??0};
});
// 預警期間（爆前）：還沒麻痺。
await page.waitForTimeout(200);
const preBlast = await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];const e=ctx.getEnemies()[0];return {pStunned:p.isStunned(), eStunned:e?.isStunned?.()??null};});
// 爆炸後（>0.4s）：玩家+怪都麻痺。
await page.waitForTimeout(500);
const postBlast = await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];const e=ctx.getEnemies()[0];return {pStunned:p.isStunned(), eStunned:e?.isStunned?.()??null, credit:ctx.credit.getCredit(0), energy:ctx.getSecondTransformEnergyRatio?.(0)??0};});
await page.screenshot({path:'/tmp/mine-blast.png'});
// 麻痺過後恢復。
await page.waitForTimeout(1600);
const recovered = await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];const e=ctx.getEnemies()[0];return {pStunned:p.isStunned(), eStunned:e?.isStunned?.()??null};});

console.log('[地雷實體驗]');
console.log('  MineTrapSystem 存在:', setup.mineSysFound);
console.log('  fx_mine 404:', v404.length?JSON.stringify([...new Set(v404)]):'無');
console.log('  鋪雷當下未爆:', {p:setup.pStunnedNow,e:setup.eStunnedNow}, (!setup.pStunnedNow&&!setup.eStunnedNow)?'PASS':'★FAIL');
console.log('  預警期間(0.2s,爆前)未麻痺:', preBlast, (!preBlast.pStunned&&!preBlast.eStunned)?'PASS(延遲爆)':'★FAIL');
console.log('  爆炸後 玩家+怪都麻痺:', {p:postBlast.pStunned,e:postBlast.eStunned}, (postBlast.pStunned&&postBlast.eStunned)?'PASS(不分敵我)':'★FAIL');
console.log('  ★不扣血: credit', setup.credit,'→',postBlast.credit, ' energy', setup.energy,'→',postBlast.energy, (setup.credit===postBlast.credit&&setup.energy===postBlast.energy)?'PASS(不扣血/不動能量)':'★FAIL');
console.log('  麻痺過後恢復:', recovered, (!recovered.pStunned&&!recovered.eStunned)?'PASS':'★FAIL');
const pass = setup.mineSysFound&&v404.length===0&&!setup.pStunnedNow&&!preBlast.pStunned&&postBlast.pStunned&&postBlast.eStunned&&setup.credit===postBlast.credit&&setup.energy===postBlast.energy&&!recovered.pStunned&&!recovered.eStunned;
console.log('  總結:', pass?'ALL PASS ✓':'★HAS FAIL');
await b.close();server.close();console.log('DONE');
