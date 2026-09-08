// bug#2 診斷：credit 耗盡→按著移動→恢復後 walk 動畫有無播（滑行 = 位置動但 anim 沒 move）。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:720} });
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3200);

// 變身進場（讓角色在場上）。
await page.keyboard.press('KeyC');
for(let f=0;f<160;f++){await page.waitForTimeout(16);const t=await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];return !p.isWaiting?.()&&!p.isEntering?.()&&!p.isTransformFloating?.();});if(t)break;}
await page.waitForTimeout(200);

const readAnim = ()=>page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; const sp=p.anim?.sprite;
  return {
    outOfCredit: ctx.credit.isOutOfCredit(0),
    canAct: ctx.credit.canAct?.(0) ?? null,
    currentState: p.anim?.currentState ?? null,
    animKey: sp?.anims?.currentAnim?.key ?? null,
    animPlaying: sp?.anims?.isPlaying ?? null,
    damagedRemaining: p.damagedRemaining ?? null,
    attacking: p.attacking ?? null,
    waiting: p.isWaiting?.() ?? null,
    x: Math.round(sp?.x ?? 0),
  };
});

// 先讓角色走一下（currentState=move）。
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(300);
const walking = await readAnim();
// ★模擬：被打（設 damaged）+ credit 耗盡到「待機」全循環（用戶說警告/待機狀態）。
await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];
  p.takeHit?.(10, 'probe'); // 設 damagedRemaining=0.25
  for(let i=0;i<200;i++) ctx.credit.consumeOnHit?.(0); // credit 歸 0 進耗盡
});
await page.waitForTimeout(200);
const duringOut = await readAnim(); // 仍按著右
// ★等倒數歸零→回待機（全循環）。加速：直接把 countdown 逼近 0 讓 justExpired。
await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const s=ctx.credit.stateOf?.(0); if(s){s.countdown=0.01;}});
await page.waitForTimeout(200); // 讓 CreditSystem tick 到 justExpired→PlayerControl 回待機
const atWaiting = await readAnim(); // 應 waiting=true
// 待機中仍按著右 → 投幣恢復（re-coin 進場）。
await page.keyboard.press('KeyC');
// 等進場完成（浮起→變身→降臨落地）。
for(let f=0;f<200;f++){await page.waitForTimeout(16);const t=await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];return !p.isWaiting?.()&&!p.isEntering?.()&&!p.isTransformFloating?.();});if(t)break;}
await page.waitForTimeout(120);
// 進場落地後仍按著右 → 量走路動畫。
const afterRecover = await readAnim();
const x1 = afterRecover.x;
await page.waitForTimeout(200);
const afterRecover2 = await readAnim();
await page.keyboard.up('ArrowRight');

console.log('[bug#2 credit 恢復後 walk 動畫診斷]');
console.log('  走路中:', walking);
console.log('  耗盡中(仍按右):', duringOut);
console.log('  恢復後:', afterRecover);
console.log('  恢復後+0.2s:', afterRecover2);
const moved = afterRecover2.x !== x1;
const walkAnim = afterRecover2.currentState==='move' && afterRecover2.animKey && /move/i.test(afterRecover2.animKey) && afterRecover2.animPlaying===true;
console.log('  → 恢復後位置有動:', moved, ' walk 動畫在播:', walkAnim);
console.log('  總結:', (moved&&walkAnim)?'PASS(移動+走路動畫都正常)':'★FAIL(滑行 or 動畫卡)');
await browser.close(); server.close();
console.log('DONE');
