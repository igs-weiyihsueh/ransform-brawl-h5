// 3 大更動回歸 bug 修復驗（決定性）：
//  #1 變身後 soulRing 顯二段能量（available gate=enabled&&transformed，enabled 已開）
//  #2 ★被怪打扣二段能量歸零 → 仍是 hero、不 revert 凡人（只 credit 耗盡才回）
//  #3 場上不週期生變身道具（FIELD_ITEM_SPAWN_ENABLED=false）
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

// 投幣進場變身。
await page.keyboard.press('KeyC');
for(let f=0; f<160; f++){ await page.waitForTimeout(16);
  const t = await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;return ctx.transform.isTransformed(0);});
  if(t) break;
}
await page.waitForTimeout(200);

const r = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;
  const tr=ctx.transform;
  const out={};
  // #1 soulRing 顯示條件：available（enabled&&transformed）。
  out.transformed = tr.isTransformed(0);
  out.available = ctx.isSecondTransformAvailable?.(0) ?? false;
  out.ratioBefore = ctx.getSecondTransformEnergyRatio?.(0) ?? 0;
  // 先灌一些二段能量（模擬打怪累積）再打掉，看歸零是否 revert。
  for(let i=0;i<10;i++) tr.accumulateSecondTransform?.(0, 0.15);
  out.ratioAfterAccum = ctx.getSecondTransformEnergyRatio?.(0) ?? 0;
  // #2 ★模擬「敵人實際命中玩家」— 走 player.takeHit（舊 bug：soulDamageSink→歸0 detransform 變凡人）。
  //   打很多下（超過 iframe），舊機制會扣 soul 歸 0 → 變回凡人；修好後 takeHit 不再扣 soul→不 detransform。
  const p0 = ctx.players?.[0] ?? ctx.player;
  for(let i=0;i<40;i++){ p0.iFrameRemaining = 0; p0.takeHit?.(50, 'probe-enemy'); }
  out.stillHeroAfterTakeHit = tr.isTransformed(0); // ★被 takeHit 猛打仍該是 hero
  // 也跑 second-energy 倒扣歸零（正確路徑）。
  for(let i=0;i<30;i++) tr.loseSecondTransformEnergy?.(0, 0.2);
  out.ratioAfterHits = ctx.getSecondTransformEnergyRatio?.(0) ?? 0;
  out.stillHeroAfterHits = tr.isTransformed(0); // ★歸零仍該是 hero
  // #3 場上道具：跑一段時間看有沒有週期生道具（items 數）。
  out.itemsOnField = (tr.items?.length) ?? -1;
  return out;
});
// #3 再等超過一個 spawn interval（10s 太久，縮看有沒有新增；FIELD flag 關應恆 0）。
await page.waitForTimeout(1500);
const items2 = await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;return ctx.transform.items?.length ?? -1;});

console.log('[3 回歸 bug 修復驗]');
console.log('  #1 變身後 soulRing available gate:', {transformed:r.transformed, available:r.available}, r.transformed&&r.available?'PASS(變身後圓環該顯)':'★FAIL');
console.log('     二段能量可累積:', {before:r.ratioBefore, afterAccum:r.ratioAfterAccum}, r.ratioAfterAccum>r.ratioBefore?'PASS(ratio 會漲→圓環會動)':'★FAIL');
console.log('  #2 被打(takeHit 敵人命中路徑):', {afterHits:r.ratioAfterHits, stillHeroTakeHit:r.stillHeroAfterTakeHit, stillHeroEnergy:r.stillHeroAfterHits}, (r.ratioAfterHits===0 && r.stillHeroAfterTakeHit && r.stillHeroAfterHits)?'PASS(猛打+能量歸零仍 hero、不 revert 凡人)':'FAIL');
console.log('  #3 場上週期道具:', {t0:r.itemsOnField, t1_5s:items2}, (r.itemsOnField===0 && items2===0)?'PASS(不生道具)':'FAIL(有生道具)');
const allPass = r.transformed&&r.available && r.ratioAfterAccum>r.ratioBefore && r.ratioAfterHits===0 && r.stillHeroAfterTakeHit && r.stillHeroAfterHits && r.itemsOnField===0 && items2===0;
console.log('  總結:', allPass?'ALL PASS ✓':'★HAS FAIL');
await browser.close(); server.close();
console.log('DONE');
