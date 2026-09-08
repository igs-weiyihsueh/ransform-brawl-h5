// #2 精確 repro：英雄+單人+credit警告倒數中「持續按住方向鍵」+投幣解除→walk 動畫是否播。
// 逐幀記錄 currentState/animKey/isPlaying/x，抓解除幀邊界前後。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',e=>console.log('  [pageerror]',String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});await page.waitForTimeout(3200);
// 變身進場（英雄狀態）。
await page.keyboard.press('KeyC');
for(let f=0;f<160;f++){await page.waitForTimeout(16);const t=await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];return !p.isWaiting?.()&&!p.isEntering?.()&&!p.isTransformFloating?.();});if(t)break;}
await page.waitForTimeout(150);

const snap=()=>page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];const sp=p.anim?.sprite;return {ooc:ctx.credit.isOutOfCredit(0),transformed:ctx.transform.isTransformed(0),cs:p.anim?.currentState,ak:sp?.anims?.currentAnim?.key,playing:sp?.anims?.isPlaying,dmg:p.damagedRemaining,x:Math.round(sp?.x??0)};});

// ★持續按住 ArrowRight（held，不放）。
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(200);
console.log('走路中:', await snap());
// 進 credit 警告倒數（outOfCredit=true，仍英雄、仍按住右）。用 consumeOnHit 打到 0。
await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;for(let i=0;i<200;i++)ctx.credit.consumeOnHit?.(0);});
await page.waitForTimeout(150);
console.log('警告倒數中(仍按右):', await snap());
// ★投幣解除用「真實 KeyC」（同幀 InputSystem→CreditSystem→PlayerControl 順序，貼近實機），仍按著右。
await page.keyboard.press('KeyC');
for(let i=0;i<6;i++){await page.waitForTimeout(50);console.log(`解除後 +${(i+1)*50}ms:`, await snap());}
const s1=await snap();await page.waitForTimeout(150);const s2=await snap();
await page.keyboard.up('ArrowRight');
const moved=s2.x!==s1.x;
const walk=s2.cs==='move'&&s2.ak&&/move/i.test(s2.ak)&&s2.playing===true;
console.log('\n[#2 精確 repro 判定] moved:',moved,'walkAnim:',walk, (moved&&walk)?'PASS':'★FAIL(滑行/動畫卡)');
await browser.close();server.close();console.log('DONE');
