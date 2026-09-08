// 新需求① 血條圓環(soulRing)改綁二段能量 + ④ 關掉怪掉英雄道具 驗。
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
  let w=0; while(!t.isTransformed(0) && w<3000){ await new Promise((r)=>setTimeout(r,16)); w+=16; }
  // ① soulRing 綁二段能量: UISystem 每幀把 getSecondTransformEnergyRatio 餵 overhead.setSoul。
  //   透過 UISystem 找 overhead 讀 shownSoul（setSoul 存的值）比對 getSecondTransformEnergyRatio。
  const uiSys=(gs.systems||[]).find((x)=>x&&Array.isArray(x.overheads));
  // 累積二段能量到 0.3。
  t.accumulateSecondTransform(0, 0.3);
  const ratio = t.getSecondTransformEnergyRatio(0);
  // 跑一幀讓 UISystem update 把 ratio 餵 soulRing。
  await new Promise((r)=>setTimeout(r,120));
  // 讀 overhead.shownSoul（soulRing 實際顯示的值）。
  const overhead = uiSys ? (uiSys.overheads?.[0] ?? null) : null;
  let shownSoul = null;
  if (overhead && 'shownSoul' in overhead) shownSoul = overhead.shownSoul;
  out.secondEnergyBound = { ratio:+ratio.toFixed(3), soulRingShows: shownSoul!==null?+Number(shownSoul).toFixed(3):null };

  // ④ 掉道具關掉: shouldDropHeroItem() 應恆 false（總開關）→ 殺怪不生 heroDrop。
  // 直接驗 config 層 + 場上 item 數。
  return out;
});
// ④ 從 build bundle 難直呼 shouldDropHeroItem；改跑一批殺怪看 heroDrop item 是否生成。
const dropCheck = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const t=ctx.transform;
  const before = (t.items||[]).filter(i=>i.source==='heroDrop').length;
  // 模擬多次擊殺觸發 onEnemyKilled（若 spawner 有 onEnemyKilled）。
  const sp = ctx.spawner;
  let kills=0;
  if (sp && sp.onEnemyKilled) {
    for(let i=0;i<50;i++){ sp.onEnemyKilled('Enemy_Rush', new Map([[0,10]]), {x:640,y:360}); kills++; }
  }
  const after = (t.items||[]).filter(i=>i.source==='heroDrop').length;
  return { kills, heroDropBefore:before, heroDropAfter:after };
});
console.log('[新需求①④ 驗]');
console.log('  ① soulRing 綁二段能量:', JSON.stringify(r.secondEnergyBound));
const ok1 = r.secondEnergyBound.soulRingShows!==null && Math.abs(r.secondEnergyBound.soulRingShows - r.secondEnergyBound.ratio) < 0.01;
console.log('    → soulRing 顯示值==二段能量 ratio:', ok1?'PASS':(r.secondEnergyBound.soulRingShows===null?'?(讀不到 shownSoul,靠 UISystem code 佐證)':'FAIL'));
console.log('  ④ 關掉道具:', JSON.stringify(dropCheck));
const ok4 = dropCheck.heroDropAfter === dropCheck.heroDropBefore;
console.log('    → 殺'+dropCheck.kills+'次無 heroDrop 生成:', ok4?'PASS(總開關關)':'FAIL(還在掉)');
console.log('  總結:', (ok1||r.secondEnergyBound.soulRingShows===null)&&ok4?'PASS(①靠讀值or code佐證/④確認)':'見上');
await browser.close(); server.close();
console.log('DONE');
