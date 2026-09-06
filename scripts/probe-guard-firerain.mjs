// 六輪#1 診斷: 守護波(Event Guard60)期間 FireRainSystem 有沒有啟動降火雨?
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
page.on('console',(m)=>{ const t=m.text(); if(/火雨|FireRain|guard|守護|ERR/i.test(t)) console.log('  [page]',t); });
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3500);
await page.keyboard.press('KeyC'); await page.waitForTimeout(800);
const r = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const sys=(gs.systems||[]);
  const wave=sys.find((x)=>x&&x.name==='WaveSystem');
  const fire=sys.find((x)=>x&&x.name==='FireRainSystem');
  if(!wave||!fire) return { err:'no wave/fire system', names: sys.map((x)=>x&&x.name) };
  // 強制跳到守護波節點(index 3)。用 enterNode(私有) via any。
  const w = wave;
  // 找 enterNode / advanceNode
  const hasEnter = typeof w.enterNode==='function';
  if(hasEnter) w.enterNode(3);
  else { for(let i=0;i<3;i++) w.advanceNode && w.advanceNode(); }
  return { hasEnter, jumped:true };
});
// 用真實遊戲迴圈跑 8 秒(讓 tween/announce 正常演)。
await page.waitForTimeout(500);
let maxStrikes = 0; const samples = [];
for(let i=0;i<16;i++){
  const s = await page.evaluate(()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const fire=(gs.systems||[]).find((x)=>x&&x.name==='FireRainSystem');
    return { strikes:(fire.strikes||[]).length };
  });
  samples.push(s.strikes); if(s.strikes>maxStrikes) maxStrikes=s.strikes;
  await page.waitForTimeout(500);
}
console.log('  strikes 取樣(每0.5s):', JSON.stringify(samples), 'max=', maxStrikes);
// 視覺: 守護波+火雨同框截圖(等 strikes 達峰值多顆同框).
let best = -1;
for(let i=0;i<40;i++){
  const n = await page.evaluate(()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const fire=(gs.systems||[]).find((x)=>x&&x.name==='FireRainSystem');
    return (fire.strikes||[]).length;
  });
  if(n>best){ best=n; await page.screenshot({ path:'/tmp/guard-firerain.png' }); }
  if(best>=2) { // 抓到多顆同框就多等半批再補一張確保火球+圈同時
    await page.screenshot({ path:'/tmp/guard-firerain.png' });
  }
  await page.waitForTimeout(150);
}
console.log('  截圖 /tmp/guard-firerain.png (守護波+火雨峰值 strikes=', best, ')');
const r2 = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const sys=(gs.systems||[]);
  const wave=sys.find((x)=>x&&x.name==='WaveSystem');
  const fire=sys.find((x)=>x&&x.name==='FireRainSystem');
  const preset = wave.getActiveFireRainPreset ? wave.getActiveFireRainPreset() : 'nofn';
  return {
    nodeIdx: wave.getNodeIndex&&wave.getNodeIndex(),
    guardEvent: !!wave.guardEvent,
    activeFirePreset: preset? (preset.name||'preset-resolved') : preset,
    fireActive: fire.active,
    announcing: fire.announcing,
    strikes: (fire.strikes||[]).length,
    fireRainActive: wave.fireRainActive,
    hasAnnounceFn: typeof gs.__effects?.fireRainAnnounce,
  };
});
console.log('[守護波火雨診斷 — 真實迴圈8s後]');
console.log(JSON.stringify(r2, null, 1));
// 深入: pickFireRainPoint 回傳? effects.fireWarningRing 存在? spawnCooldown?
const deep = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const sys=(gs.systems||[]);
  const fire=sys.find((x)=>x&&x.name==='FireRainSystem');
  const ctx = sys.find((x)=>x&&x.ctx)?.ctx;
  const out = {
    preset: fire.preset ? { intervalSec:fire.preset.intervalSec, radiusPx:fire.preset.radiusPx, warningSec:fire.preset.warningSec, warnSec:fire.preset.warnSec, edgeMarginPx:fire.preset.edgeMarginPx, maxConcurrent:fire.preset.maxConcurrent, burstCount:fire.preset.burstCount, damage:fire.preset.damage } : null,
    spawnCooldown: fire.spawnCooldown,
    hasFireWarningRing: typeof ctx?.effects?.fireWarningRing,
    hasFireballFall: typeof ctx?.effects?.fireballFall,
    hasFireStrikeFlash: typeof ctx?.effects?.fireStrikeFlash,
  };
  return out;
});
console.log('[深入]'); console.log(JSON.stringify(deep, null, 1));
console.log('  診斷:', r2.strikes>0 ? 'PASS 有火雨降落' : (r2.fireActive ? 'FAIL fire.active=true 但 strikes=0' : 'FAIL fire 沒啟動'));
await browser.close(); server.close();
console.log('DONE');
