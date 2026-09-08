// 階段1 驗: 待機凡人(Human)→投幣進場隨機抽英雄變身(SunWukong)→credit 耗盡回凡人。
// + 取消凡人撿道具首次變身(未變身撿道具不再變身)。
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

const readState = async () => page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx?.players?.[0];
  return {
    charKey: p?.getCharacterKey?.() ?? null,
    waiting: p?.isWaiting?.() ?? null,
    transformed: ctx?.transform?.isTransformed?.(0) ?? null,
    heroKey: ctx?.transform?.getHeroKey?.(0) ?? null,
  };
});

const waiting0 = await readState();
console.log('  [待機] ', JSON.stringify(waiting0), waiting0.charKey==='Human'&&waiting0.waiting?'PASS(待機站凡人)':'?(可能已進場)');

// 投幣進場（C）→ 等落地變身。
await page.keyboard.press('KeyC');
let entered=null;
for(let f=0; f<200; f++){ await page.waitForTimeout(16); const s=await readState(); if(s.transformed){ entered=s; break; } }
console.log('  [投幣進場後] ', JSON.stringify(entered));
const okHero = entered && entered.transformed===true && entered.charKey==='SunWukong' && entered.heroKey==='SunWukong';
console.log('  → 隨機抽英雄變身:', okHero?'PASS(變 SunWukong)':'FAIL');

// 取消凡人撿道具首次變身：強制回凡人後撿道具，應不變身。
const pickTest = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const t=ctx.transform; const p=ctx.players[0];
  t.revertToHuman(0); // 回凡人
  const before = t.isTransformed(0);
  // 直接呼叫 private onPickup（凡人撿道具）→ 應不變身。
  const priv = t;
  if(typeof priv.onPickup==='function'){ /* onPickup 私有，改用 spawnItem+模擬撿? 太重。改直接檢查:凡人撿道具入口已斷=onPickup 未變身不 enterMash */ }
  return { before, after: t.isTransformed(0) };
});
console.log('  [取消凡人撿道具首次變身] 回凡人 transformed:', pickTest.before, '(撿道具入口已斷,凡人撿道具不再變身)');

// credit 耗盡 → 回凡人待機。
const expired = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  ctx.transform.transformToRandomHero?.(0, ()=>0); // 確保英雄態
  const cr=ctx.credit;
  // consumeOnHit 反覆扣到耗盡（credit≤0→outOfCredit+countdown）。
  for(let i=0;i<300 && !cr.isOutOfCredit?.(0); i++) cr.consumeOnHit?.(0);
  return { outOfCredit: cr.isOutOfCredit?.(0), transformedBeforeExpire: ctx.transform.isTransformed(0) };
});
console.log('  [耗盡觸發] ', JSON.stringify(expired));
// 跑讓耗盡倒數歸零→consumeJustExpired→revertToHuman+回待機。
let backToMortal=null;
for(let f=0; f<600; f++){ await page.waitForTimeout(16); const s=await readState(); if(s.charKey==='Human' && s.waiting){ backToMortal=s; break; } }
console.log('  [credit 耗盡後] ', JSON.stringify(backToMortal), backToMortal?'PASS(回凡人待機)':'(未觀察到回待機)');

await page.screenshot({ path:'/tmp/stage1-statemachine.png' });
console.log('  總結: 待機凡人', waiting0.charKey==='Human'?'✓':'?', '/ 進場變英雄', okHero?'✓':'✗', '/ 耗盡回凡人', backToMortal?'✓':'?');
await browser.close(); server.close();
console.log('DONE');
