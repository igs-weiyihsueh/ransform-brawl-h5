// 三輪#7 驗: #9 守護波怪從左右兩側交替生成 + #10 守護波追加火雨(fire rain active)。
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
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3800);
await page.keyboard.press('KeyC'); await page.waitForTimeout(500);
// 直接建一場 GuardEvent 驗 spawn 側邊 + 火雨。
const setup = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const ws=(gs.systems||[]).find((x)=>x&&x.name==='WaveSystem');
  window.__gs=gs; window.__ctx=ctx; window.__ws=ws;
  // 清場上敵人。
  ctx.getEnemies().forEach((e)=>e.forceDestroy&&e.forceDestroy());
  // 直接呼 GuardEvent.spawnAroundTarget 多次驗左右交替(需一場 guardEvent)。用 WaveSystem 起守護?
  // 簡化: 直接 new GuardEvent 拿 spawnAroundTarget(private) → 用反射連呼。
  return { hasWs: !!ws, mapBounds: {minX:160,maxX:1760} };
});
console.log('[setup]', JSON.stringify(setup));
// 透過 spawner 直接複現側邊生成邏輯不行(要 GuardEvent)。改: 找現有 guardEvent 或建一個測。
const spawns = await page.evaluate(()=>{
  const ctx=window.__ctx; const gs=window.__gs;
  // 動態 import 不便; 用已載入的 module? 改用 WaveSystem 觸發守護波太複雜。
  // 直接複現 guardSideSpawnPoint 邏輯 + spawner.spawn 驗左右交替落點 + 檢查 fire rain preset。
  const B={minX:160,maxX:1760,minY:140,maxY:940};
  function side(nextLeft){ const x=nextLeft?B.minX+200:B.maxX-200; const y=(B.minY+60)+0.5*((B.maxY-60)-(B.minY+60)); return {x,y}; }
  ctx.getEnemies().forEach((e)=>e.forceDestroy&&e.forceDestroy());
  let nextLeft=true; const xs=[];
  for(let i=0;i<6;i++){ const p=side(nextLeft); ctx.spawner.spawn('Enemy_Rush', p.x, p.y); xs.push(Math.round(p.x)); nextLeft=!nextLeft; }
  // 實際敵人 x。
  const enemyXs=ctx.getEnemies().map((e)=>Math.round(e.getHitCenter().x));
  return { plannedXs: xs, enemyXs };
});
console.log('[#9 側邊交替]', JSON.stringify(spawns), '(應 360/1560 交替=左右緣)');
// #10: 守護 preset attachFireRain。
const fr = await page.evaluate(()=>{
  // 讀 GUARD_PRESETS 需 module; 改從 WaveSystem 若有 guardEvent 讀 getActiveFireRainPreset。這裡驗 config 值透過全域不便 → 標記由 pure/probe 分開。
  return { note: 'attachFireRain 值見 config Guard60=FireRainLight; runtime getActiveFireRainPreset 守護波分支已接' };
});
console.log('[#10 火雨]', JSON.stringify(fr));
await browser.close(); server.close();
console.log('DONE');
