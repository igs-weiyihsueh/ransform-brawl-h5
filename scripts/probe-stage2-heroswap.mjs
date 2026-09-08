// 階段2 驗: 怪掉英雄道具→撿了換成道具帶的英雄(英雄態橫向換);凡人態撿不觸發。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(500); // 投幣進場（會變英雄）

const r = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const t=ctx.transform; const p=ctx.players[0];
  const out={};
  // 等進場落地變英雄。
  let w=0; while(!t.isTransformed(0) && w<3000){ await new Promise((r)=>setTimeout(r,16)); w+=16; }
  out.heroBefore = { transformed: t.isTransformed(0), heroKey: t.getHeroKey(0) };

  // ① 英雄態：直接呼叫 private onPickup 一個 heroDrop 道具(帶 HeroX)→ 應橫向換成 HeroX。
  const priv = t;
  priv.onPickup({ pickUp(){}, source:'heroDrop', heroKey:'HeroX' }, p);
  out.heroAfterPickHeroDrop = { transformed: t.isTransformed(0), heroKey: t.getHeroKey(0) };

  // ② 凡人態：退回凡人，再撿 heroDrop → 不觸發。
  t.revertToHuman(0);
  out.mortal = { transformed: t.isTransformed(0), heroKey: t.getHeroKey(0) };
  priv.onPickup({ pickUp(){}, source:'heroDrop', heroKey:'HeroY' }, p);
  out.mortalAfterPickHeroDrop = { transformed: t.isTransformed(0), heroKey: t.getHeroKey(0) };

  // ③ 掉落判定：shouldDropHeroItem 走 onEnemyKilled——直接驗 spawnItem heroDrop 能生道具(item 帶 heroKey)。
  const before = (t.items?.length ?? null);
  t.spawnItem('heroDrop', undefined, {x:640,y:360}, undefined, 'HeroZ');
  const items = t.items ?? [];
  const last = items[items.length-1];
  out.spawnedHeroDrop = { count: items.length, lastSource: last?.source, lastHeroKey: last?.heroKey };

  return out;
});
console.log('[階段2 英雄換英雄驗]'); console.log(JSON.stringify(r, null, 1));
const ok1 = r.heroBefore.transformed && r.heroAfterPickHeroDrop.heroKey==='HeroX';
const ok2 = r.mortalAfterPickHeroDrop.transformed===false && r.mortalAfterPickHeroDrop.heroKey===null;
const ok3 = r.spawnedHeroDrop.lastSource==='heroDrop' && r.spawnedHeroDrop.lastHeroKey==='HeroZ';
console.log('  ① 英雄態撿英雄道具→換成 HeroX:', ok1?'PASS':'FAIL');
console.log('  ② 凡人態撿英雄道具→不觸發:', ok2?'PASS':'FAIL');
console.log('  ③ spawnItem heroDrop 生道具帶 heroKey:', ok3?'PASS':'FAIL');
console.log('  總結:', ok1&&ok2&&ok3?'ALL PASS ✓':'HAS FAIL ✗');
await browser.close(); server.close();
console.log('DONE');
