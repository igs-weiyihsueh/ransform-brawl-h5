// ③投幣變身表演 4 VFX 接入驗：浮起光/變身閃/降臨衝擊/震退波，在 4 時機點截圖供看圖。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const vfx404 = [];
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/')u='/index.html'; const fp=path.join(distDir,u); if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){ if(/fx_(rise_glow|transform_flash|descend_impact|shockwave_ring)/.test(u)) vfx404.push(u); res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:720} });
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3200);

// 放幾隻怪在落點附近（震退波+落地衝擊看得到怪被推）。
await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  for(const dx of [-70,70,110]) ctx.spawner.spawn('Enemy_Rush', 640+dx, 360);
});

// 投幣觸發表演。逐幀掃描狀態，在 4 時機截圖。
await page.keyboard.press('KeyC');
let shotRise=false, shotFlash=false, shotLand=false;
for(let f=0; f<140; f++){
  await page.waitForTimeout(16);
  const s = await page.evaluate(()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
    const p=ctx.players[0];
    return { floating: p.isTransformFloating?.()??false, transformed: ctx.transform.isTransformed(0), entering: p.isEntering?.()??false };
  });
  // 浮起中前段（未變身）→ 浮起光。
  if(s.floating && !s.transformed && !shotRise){ await page.screenshot({path:'/tmp/vfx-1-rise.png'}); shotRise=true; }
  // 變身瞬間（剛 transformed 仍 floating/剛結束）→ 變身閃。
  if(s.transformed && !shotFlash){ await page.screenshot({path:'/tmp/vfx-2-flash.png'}); shotFlash=true; }
  // 降臨落地（floating 結束、entering 結束）→ 落地衝擊+震退波。
  if(!s.floating && s.transformed && !s.entering && shotFlash && !shotLand){
    await page.waitForTimeout(30); // 落地當幀後一點點，波已生成
    await page.screenshot({path:'/tmp/vfx-3-land.png'}); shotLand=true; break;
  }
}
console.log('[③ 4 VFX 接入驗]');
console.log('  截圖: rise=',shotRise,' flash=',shotFlash,' land=',shotLand);
console.log('  VFX 資源 404:', vfx404.length? JSON.stringify([...new Set(vfx404)]) : '無');
console.log('  /tmp/vfx-1-rise.png /tmp/vfx-2-flash.png /tmp/vfx-3-land.png');
console.log('  總結:', shotRise&&shotFlash&&shotLand&&vfx404.length===0 ? '4 時機截圖齊+無 404（看圖確認外觀）' : '★缺時機或有 404');
await browser.close(); server.close();
console.log('DONE');
