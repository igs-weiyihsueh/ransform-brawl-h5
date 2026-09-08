// 武器指定變身道具驗：道具圖=武器、撿了變對應英雄（指定，非隨機）+ 場上生成 flag 關著。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const w404=[];
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){if(u.includes('/weapons/'))w404.push(u);res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',e=>console.log('  [pageerror]',String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});await page.waitForTimeout(3200);

// 進場（先變成某英雄，測「英雄撿武器→變成另一指定英雄」+「凡人撿也變」）。
await page.keyboard.press('KeyC');
for(let f=0;f<160;f++){await page.waitForTimeout(16);const t=await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];return !p.isWaiting?.()&&!p.isEntering?.()&&!p.isTransformFloating?.();});if(t)break;}
await page.waitForTimeout(150);

const HEROES=['SunWukong','devil1','elf1','elf2','human2','legacy1'];
// 1) 武器貼圖有載入。
const texLoaded = await page.evaluate((heroes)=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const r={};for(const h of heroes)r[h]=gs.textures.exists('weapon-'+h);return r;},HEROES);

// 2) 逐英雄：在玩家位置生成 weapon 道具→撿→應變成該指定英雄。
const results={};
for(const hero of HEROES){
  const got = await page.evaluate((hero)=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;
    const tr=ctx.transform; const p=ctx.players[0];
    const pos=p.getPosition();
    // 在玩家腳邊生成 weapon 指定變身道具。
    tr.spawnItem?.('weapon', undefined, {x:pos.x, y:pos.y}, undefined, hero);
    // 找剛生成的 item，確認它的 heroKey/source。
    const items=tr.items||[];
    const it=items[items.length-1];
    const before={source:it?.source, heroKey:it?.heroKey, curHero:ctx.transform.getHeroKey?.(0) ?? null};
    return before;
  }, hero);
  // 撿取：tick 幾幀讓 onPickup 觸發（道具在玩家身上，範圍內）。
  await page.waitForTimeout(120);
  const after = await page.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const ctx=(gs.systems||[]).find(x=>x&&x.ctx)?.ctx;const p=ctx.players[0];return {charKey:p.getCharacterKey?.(), transformed:ctx.transform.isTransformed(0)};});
  results[hero]={itemSource:got.source, itemHeroKey:got.heroKey, becameChar:after.charKey, transformed:after.transformed, ok: after.charKey===hero && after.transformed};
}

console.log('[武器指定變身道具驗]');
console.log('  武器貼圖載入:', JSON.stringify(texLoaded));
console.log('  weapons 404:', w404.length?JSON.stringify([...new Set(w404)]):'無');
let allOk=Object.values(texLoaded).every(Boolean) && w404.length===0;
for(const h of HEROES){const r=results[h];console.log(`  撿 ${h} 武器 → 變成 ${r.becameChar}(transformed=${r.transformed}) ${r.ok?'PASS':'★FAIL'} [item source=${r.itemSource} heroKey=${r.itemHeroKey}]`);if(!r.ok)allOk=false;}
console.log('  總結:', allOk?'ALL PASS ✓(道具圖=武器、撿了變對應指定英雄、無404)':'★HAS FAIL');
await browser.close();server.close();console.log('DONE');
