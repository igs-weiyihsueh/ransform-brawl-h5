// 階段3 驗: 二段能量 擊中累積 / 被打倒扣 / ★能量0不扣。需 flag ON(localStorage override enabled)。
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
// ★flag ON：先塞 localStorage override enabled=true，再載入（getResolvedSecondTransform 啟動讀一次）。
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'domcontentloaded'});
await page.evaluate(()=>{ localStorage.setItem('transformbrawl:secondTransform', JSON.stringify({version:1, enabled:true})); });
await page.reload({waitUntil:'networkidle'});
await page.waitForTimeout(3200);
await page.keyboard.press('KeyC'); await page.waitForTimeout(500);

const r = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const t=ctx.transform; const p=ctx.players[0];
  const out={};
  // 等進場→一段變英雄（二段前提 isSecondTransformAvailable=transformed）。
  let w=0; while(!t.isTransformed(0) && w<3000){ await new Promise((r)=>setTimeout(r,16)); w+=16; }
  out.enabled_and_hero = { transformed: t.isTransformed(0), ratio0: t.getSecondTransformEnergyRatio(0) };

  // ① 擊中累積：呼叫 accumulateSecondTransform(命中量)×N → ratio 增加。
  t.accumulateSecondTransform(0, 0.1);
  const afterHit1 = t.getSecondTransformEnergyRatio(0);
  t.accumulateSecondTransform(0, 0.1);
  const afterHit2 = t.getSecondTransformEnergyRatio(0);
  out.accumulate = { afterHit1: +afterHit1.toFixed(3), afterHit2: +afterHit2.toFixed(3) };

  // ② 被打倒扣：loseSecondTransformEnergy → ratio 減少。
  t.loseSecondTransformEnergy(0, 0.05);
  const afterLoss = t.getSecondTransformEnergyRatio(0);
  out.loss = { afterLoss: +afterLoss.toFixed(3) };

  // ③ ★能量 0 不扣：先扣光到 0，再扣一次 → 仍 0（不負）。
  t.loseSecondTransformEnergy(0, 99); // 扣光→0
  const atZero = t.getSecondTransformEnergyRatio(0);
  t.loseSecondTransformEnergy(0, 0.1); // 0 再扣
  const stillZero = t.getSecondTransformEnergyRatio(0);
  out.zeroFloor = { atZero:+atZero.toFixed(3), stillZero:+stillZero.toFixed(3) };
  return out;
});
console.log('[階段3 二段能量改制驗]'); console.log(JSON.stringify(r, null, 1));
const okEnabled = r.enabled_and_hero.transformed && r.enabled_and_hero.ratio0===0;
const okAcc = r.accumulate.afterHit1>0 && r.accumulate.afterHit2>r.accumulate.afterHit1;
const okLoss = r.loss.afterLoss < r.accumulate.afterHit2;
const okZero = r.zeroFloor.atZero===0 && r.zeroFloor.stillZero===0;
console.log('  flag ON + 一段英雄 ratio0=0:', okEnabled?'PASS':'FAIL');
console.log('  ① 擊中累積(ratio 增):', r.accumulate.afterHit1,'→',r.accumulate.afterHit2, okAcc?'PASS':'FAIL');
console.log('  ② 被打倒扣(ratio 減):', r.loss.afterLoss, okLoss?'PASS':'FAIL');
console.log('  ③ ★能量0不扣:', r.zeroFloor.atZero,'→再扣→',r.zeroFloor.stillZero, okZero?'PASS(clamp 0 不負)':'FAIL');
console.log('  總結:', okEnabled&&okAcc&&okLoss&&okZero?'ALL PASS ✓':'HAS FAIL ✗');
await browser.close(); server.close();
console.log('DONE');
