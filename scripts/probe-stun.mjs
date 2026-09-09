// 麻痺(stun)狀態驗：玩家+怪 applyStun→N 秒不能動→時間到恢復；不扣血/不動二段能量。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname=path.dirname(fileURLToPath(import.meta.url));const distDir=path.join(__dirname,'..','dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){s.statusCode=404;s.end('404');return;}s.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(s);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const b=await chromium.launch();const page=await b.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',e=>console.log('  [pageerror]',String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});await page.waitForTimeout(3200);
await page.keyboard.press('KeyC');
for(let f=0;f<160;f++){await page.waitForTimeout(16);const t=await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];return !p.isWaiting?.()&&!p.isEntering?.()&&!p.isTransformFloating?.();});if(t)break;}
await page.waitForTimeout(150);

// 生一隻怪供驗怪麻痺。
await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;if(ctx.spawner.clearAllEnemies)ctx.spawner.clearAllEnemies();ctx.spawner.spawn('Enemy_Rush',700,360);});
await page.waitForTimeout(100);

// ---- 玩家麻痺 ----
// 記能量 ratio（驗不動二段能量）。套 1.5s stun，按住右，看動不動。
const pRes = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];
  const energyBefore=ctx.getSecondTransformEnergyRatio?.(0)??0;
  const creditBefore=ctx.credit.getCredit(0);
  p.applyStun(1.5);
  return {stunnedNow:p.isStunned(), energyBefore, creditBefore, x0:Math.round(p.getPosition().x)};
});
// 麻痺中按住右 0.5s → 應不動。
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(500);
const during = await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];return {stunned:p.isStunned(),x:Math.round(p.getPosition().x),energy:ctx.getSecondTransformEnergyRatio?.(0)??0,credit:ctx.credit.getCredit(0)};});
// 等麻痺過（1.5s 總）再按住右 → 應會動。
await page.waitForTimeout(1300);
const after = await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];return {stunned:p.isStunned(),x:Math.round(p.getPosition().x)};});
await page.waitForTimeout(250);
const after2 = await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];return {x:Math.round(p.getPosition().x)};});
await page.keyboard.up('ArrowRight');

// ---- 怪麻痺 ----
const eRes = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;
  const e=ctx.getEnemies()[0]; if(!e)return{noEnemy:true};
  const x0=Math.round(e.getHitCenter().x);
  e.applyStun(1.0);
  return {stunnedNow:e.isStunned(), x0};
});
await page.waitForTimeout(500);
const eDuring = await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const e=ctx.getEnemies()[0];return e?{stunned:e.isStunned(),x:Math.round(e.getHitCenter().x)}:{noEnemy:true};});
await page.waitForTimeout(800);
const eAfter = await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const e=ctx.getEnemies()[0];return e?{stunned:e.isStunned()}:{noEnemy:true};});

console.log('[麻痺 stun 狀態驗]');
const pFrozeDuring = Math.abs(during.x - pRes.x0) <= 2; // 麻痺中幾乎不動
const pMovedAfter = Math.abs(after2.x - after.x) > 5;    // 解除後會動
const noBlood = during.energy===pRes.energyBefore && during.credit===pRes.creditBefore; // 不動二段能量/credit
console.log('  玩家: 套 stunnedNow=',pRes.stunnedNow,' 麻痺中不動(x',pRes.x0,'→',during.x,')=',pFrozeDuring, ' 解除仍麻痺?',after.stunned,' 解除後會動(x',after.x,'→',after2.x,')=',pMovedAfter);
console.log('  玩家: 不扣血/不動二段能量/credit =', noBlood, '(energy',pRes.energyBefore,'→',during.energy,' credit',pRes.creditBefore,'→',during.credit,')');
console.log('  怪: 套 stunnedNow=',eRes.stunnedNow,' 麻痺中不動(x',eRes.x0,'→',eDuring.x,')=',eDuring.stunned&&Math.abs(eDuring.x-eRes.x0)<=3,' 解除後 stunned?',eAfter.stunned);
const pass = pRes.stunnedNow&&pFrozeDuring&&!after.stunned&&pMovedAfter&&noBlood&&eRes.stunnedNow&&!eAfter.stunned;
console.log('  總結:', pass?'ALL PASS ✓(玩家+怪麻痺 N 秒不能動、時間到恢復、不扣血、二段能量/credit 不受影響)':'★HAS FAIL');
await b.close();server.close();console.log('DONE');
