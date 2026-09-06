// 六輪 玩家受擊擊退 驗: 敵人打玩家→玩家被推開(遠離來源); 護盾/iFrame 不被推。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(500);
const r = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite; psp.x=960; psp.y=540;
  const results={};
  // 通用: 敵人在玩家左側, knockback=3(Rush), 打玩家, 跑幾幀看玩家 x 有沒往右(遠離)。
  async function hitTest(setup){
    psp.x=960; psp.y=540;
    if(p.iFrameRemaining!==undefined) p.iFrameRemaining=0;
    if(p.knockbackRemaining!==undefined) p.knockbackRemaining=0;
    setup && setup();
    const fromPos={x: 860, y:540}; // 來源在玩家左(x860 < 玩家960) → 應往右(+x)推
    const ok = p.takeHit(1, 'Enemy_Rush', 3, fromPos);
    // 直接讀擊退速度向量(不靠整合位移, 避免真實迴圈其他位移污染)。
    const vx = p.knockbackPerSec ? Math.round(p.knockbackPerSec.x) : null;
    const vy = p.knockbackPerSec ? Math.round(p.knockbackPerSec.y) : null;
    const rem = p.knockbackRemaining ?? null;
    return { returned: ok, vx, vy, rem: Number((rem||0).toFixed(2)) };
  }
  results.normal = await hitTest(()=>{ p.setShielded&&p.setShielded(false); });
  results.shielded = await hitTest(()=>{ p.setShielded&&p.setShielded(true); });
  // iFrame: 先設 iFrame 再打。
  results.iframe = await hitTest(()=>{ p.setShielded&&p.setShielded(false); if(p.iFrameRemaining!==undefined) p.iFrameRemaining=0.5; });
  p.setShielded&&p.setShielded(false);
  return results;
});
console.log('[玩家受擊擊退驗]'); console.log(JSON.stringify(r, null, 1));
console.log('  一般受擊被推開(vx>0 往右遠離左方來源, rem>0):', (r.normal.returned && r.normal.vx>0 && r.normal.rem>0) ? 'PASS(vx='+r.normal.vx+' rem='+r.normal.rem+')' : 'FAIL('+JSON.stringify(r.normal)+')');
console.log('  護盾免疫擊退(takeHit=false, 無擊退作用 rem=0):', (r.shielded.returned===false && r.shielded.rem===0) ? 'PASS' : 'FAIL('+JSON.stringify(r.shielded)+')');
console.log('  iFrame免疫擊退(takeHit=false, 無擊退作用 rem=0):', (r.iframe.returned===false && r.iframe.rem===0) ? 'PASS' : 'FAIL('+JSON.stringify(r.iframe)+')');
await browser.close(); server.close();
console.log('DONE');
