// 二段能量累積調整驗：①打中 N 隻→+N 份 ②技能命中也累 ③被打倒扣 0.1 clamp 0 仍在。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname=path.dirname(fileURLToPath(import.meta.url));const distDir=path.join(__dirname,'..','dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){s.statusCode=404;s.end('404');return;}s.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(s);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const b=await chromium.launch();const page=await b.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',e=>console.log('  [pageerror]',String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});await page.waitForTimeout(3200);
// 變身進場（英雄+二段 available）。
await page.keyboard.press('KeyC');
for(let f=0;f<160;f++){await page.waitForTimeout(16);const t=await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];return !p.isWaiting?.()&&!p.isEntering?.()&&!p.isTransformFloating?.();});if(t)break;}
await page.waitForTimeout(150);

const r = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const tr=ctx.transform;
  const out={};
  const ratio=()=>ctx.getSecondTransformEnergyRatio?.(0)??0;
  const EPH=0.03; // energyPerHit
  // 直接驗 accumulate 語意（模擬 PlayerControl 傳 EPH×hits.length）：
  out.available = ctx.isSecondTransformAvailable?.(0) ?? false;
  const r0=ratio();
  // ① 一次打中 3 隻 = 傳 EPH×3。
  tr.accumulateSecondTransform?.(0, EPH*3);
  out.after3 = +(ratio()-r0).toFixed(4); // 應≈0.09
  // 再打中 10 隻 = EPH×10=0.3。
  const r1=ratio(); tr.accumulateSecondTransform?.(0, EPH*10);
  out.after10 = +(ratio()-r1).toFixed(4); // 應≈0.3
  // ② 技能命中也累（同 API，PlayerControl 已移 !isSkill）——這裡驗 accumulate 本身不分普攻/技能（累加值即可）。
  //    (整合層「技能也呼叫」由 code 移除 !intent.isSkill 佐證，見 diff。)
  // ③ 被打倒扣 clamp 0。
  const rBefore=ratio();
  for(let i=0;i<50;i++) tr.loseSecondTransformEnergy?.(0, 0.1);
  out.afterHits = +ratio().toFixed(4); // 應 0（clamp）
  out.stillHero = tr.isTransformed(0); // 歸零仍 hero
  return out;
});
console.log('[二段能量累積調整驗]');
console.log('  available:', r.available);
console.log('  ① 打中 3 隻 → +', r.after3, r.after3>0.089&&r.after3<0.091?'PASS(≈0.09=EPH×3)':'★FAIL');
console.log('  ① 打中 10 隻 → +', r.after10, r.after10>0.29&&r.after10<0.31?'PASS(≈0.3=EPH×10)':'★FAIL');
console.log('  ③ 被打×50 倒扣 → ratio', r.afterHits, 'stillHero', r.stillHero, (r.afterHits===0&&r.stillHero)?'PASS(clamp 0 仍 hero)':'★FAIL');
console.log('  總結:', (r.after3>0.089&&r.after3<0.091&&r.after10>0.29&&r.after10<0.31&&r.afterHits===0&&r.stillHero)?'ALL PASS ✓':'★HAS FAIL');
await b.close();server.close();console.log('DONE');
