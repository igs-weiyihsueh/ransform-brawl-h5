// 六輪#1真解 驗: 守護 Event node.attachFireRain 三態 → getActiveFireRainPreset。
// (a)省略→preset預設FireRain (b)'none'→null (c)'FireRainHeavy'→heavy。用 route 改 levels.json 注入。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/')u='/index.html'; const fp=path.join(distDir,u); if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;

async function runCase(attach, shot){ // attach: undefined | 'none' | 'FireRainHeavy'; shot: png path or undefined
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{width:1280,height:720} });
  await page.route('**/levels.json', async (route)=>{
    const res = await route.fetch(); const json = await res.json();
    const nodes = json.levels[0].nodes; const ev = nodes.find((n)=>n.nodeType==='Event');
    if(attach===undefined){ delete ev.attachFireRain; } else { ev.attachFireRain = attach; }
    await route.fulfill({ contentType:'application/json', body: JSON.stringify(json) });
  });
  await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
  await page.waitForTimeout(3200);
  await page.keyboard.press('KeyC'); await page.waitForTimeout(500);
  const r = await page.evaluate(()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const wave=(gs.systems||[]).find((x)=>x&&x.name==='WaveSystem');
    if(typeof wave.enterNode==='function') wave.enterNode(3);
    for(let f=0;f<5;f++) wave.update && wave.update(0.1);
    const preset = wave.getActiveFireRainPreset ? wave.getActiveFireRainPreset() : 'nofn';
    return { guardEvent: !!wave.guardEvent, preset: preset? { interval:preset.intervalSec, burst:preset.burstCount, maxC:preset.maxConcurrent } : null };
  });
  // 用真實迴圈跑, 抓火雨峰值截圖(only for shot cases)。
  if(shot){
    let best=-1;
    for(let i=0;i<45;i++){
      const n = await page.evaluate(()=>{ const gs=window.__PHASER_GAME__.scene.getScene('GameScene'); const f=(gs.systems||[]).find((x)=>x&&x.name==='FireRainSystem'); return (f.strikes||[]).length; });
      if(n>best){ best=n; await page.screenshot({ path:shot }); }
      await page.waitForTimeout(130);
    }
    console.log('  截圖', shot, 'peak strikes=', best);
  }
  await browser.close();
  return r;
}
const a = await runCase(undefined, '/tmp/gfr-default.png');
const b = await runCase('none');
const c = await runCase('FireRainHeavy', '/tmp/gfr-heavy.png');
server.close();
console.log('[三態驗]');
console.log(' (a)省略→preset預設FireRain:', JSON.stringify(a.preset), a.preset && a.preset.interval===1.5 && a.preset.burst===1 ? 'PASS(FireRain標準)' : 'FAIL');
console.log(" (b)'none'→無火雨:", JSON.stringify(b.preset), b.preset===null ? 'PASS(null)' : 'FAIL');
console.log(" (c)'FireRainHeavy'→猛烈:", JSON.stringify(c.preset), c.preset && c.preset.interval===1.0 && c.preset.burst===2 ? 'PASS(Heavy)' : 'FAIL');
console.log('DONE');
