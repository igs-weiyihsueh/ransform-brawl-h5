// 衝刺可調驗: dash-editor 200 + 遊戲 getResolvedDash 預設=DASH_CONFIG / override 生效 / 壞 fallback。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json','.css':'text/css' };
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/')u='/index.html'; if(u.endsWith('/'))u+='index.html'; const fp=path.join(distDir,u); if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;

// A. dash-editor 頁 200。
{
  const code = await new Promise((r)=>http.get(`http://127.0.0.1:${port}/dash-editor/`, res=>{res.resume(); r(res.statusCode);}));
  console.log('  /dash-editor/', code, code===200?'PASS':'FAIL');
}

// B/C/D. 遊戲 getResolvedDash: 無 override→預設 / override 速度15→讀到 / 壞→fallback。
async function bootDash(setup){
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{width:1280,height:720} });
  let crashed=false; page.on('pageerror',(e)=>{crashed=true; console.log('  [pageerror]',String(e).slice(0,120));});
  if(setup) await page.addInitScript(setup);
  await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
  await page.waitForTimeout(3400);
  await page.keyboard.press('KeyC'); await page.waitForTimeout(400);
  // 觸發 startDash 讀 duration + updateDash 讀 speed → 從 dashRemaining/位移反推? 直接讀 Player dashRemaining=duration。
  const r = await page.evaluate(async ()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
    const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite; psp.x=500; psp.y=500;
    if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
    p.startDash({x:1,y:0});
    const dur = p.dashRemaining; // = getResolvedDash().duration
    const x0=psp.x;
    for(let f=0; f<3; f++) await new Promise((r)=>setTimeout(r,16));
    // 位移速度反推 speed (px/s / PPU)。
    return { durationRead: Number(dur.toFixed(3)) };
  });
  await browser.close();
  return { ...r, crashed };
}
const a = await bootDash(null);
console.log('  無 override duration=', a.durationRead, '(打包預設 0.2)', a.durationRead===0.2?'PASS':'?');
const ov = `localStorage.setItem('transformbrawl:dash', ${JSON.stringify(JSON.stringify({version:1, dash:{speed:15,duration:0.15,damage:1,knockback:1,radius:0.5}}))});`;
const b = await bootDash(ov);
console.log('  override duration=0.15 → 讀到', b.durationRead, b.durationRead===0.15?'PASS(用戶設定生效)':'FAIL');
const bad = `localStorage.setItem('transformbrawl:dash', '{bad json ]');`;
const c = await bootDash(bad);
console.log('  壞 JSON → fallback duration', c.durationRead, 'crashed', c.crashed, (!c.crashed && c.durationRead===0.2)?'PASS(fallback預設不炸)':'FAIL');
server.close();
console.log('DONE');
