// 擊退定案驗: 怪擊退=招式 knockback, 所有怪統一(不因 hitStun 而異), knockback 大推遠。
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
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3300);
await page.keyboard.press('KeyC'); await page.waitForTimeout(400);
const r = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  const from={x:400,y:500}; // 攻擊來源(怪往右被推)
  function pushSpeed(type, kb){
    const e = ctx.spawner.spawn(type, 600, 500);
    e.takeHit(1, kb, from); // damage1, knockback=kb
    const v = e.knockbackPerSec ? Math.round(Math.hypot(e.knockbackPerSec.x, e.knockbackPerSec.y)) : 0;
    e.forceDestroy && e.forceDestroy();
    return { hitStun: e.cfg.hitStun, speed: v };
  }
  return {
    rush_kb3: pushSpeed('Enemy_Rush', 3),
    ranged_kb3: pushSpeed('Enemy_Ranged', 3),   // 同 kb3, hitStun 也 0.8 → 應與 rush 同
    rush_kb6: pushSpeed('Enemy_Rush', 6),        // kb 大 → 推更快/遠
    elite_kb6: pushSpeed('Enemy_Elite', 6),      // immovable → 不退(speed 0)
  };
});
console.log('[擊退定案驗]'); console.log(JSON.stringify(r, null, 1));
console.log('  同 knockback(3) Rush vs Ranged 統一?', r.rush_kb3.speed===r.ranged_kb3.speed ? 'PASS(統一='+r.rush_kb3.speed+')' : 'FAIL(rush='+r.rush_kb3.speed+' ranged='+r.ranged_kb3.speed+')');
console.log('  knockback 大(6)推更遠?', r.rush_kb6.speed > r.rush_kb3.speed ? 'PASS(kb6='+r.rush_kb6.speed+' > kb3='+r.rush_kb3.speed+')' : 'FAIL');
console.log('  菁英 immovable 不退?', r.elite_kb6.speed===0 ? 'PASS(0)' : '(elite speed='+r.elite_kb6.speed+')');
await browser.close(); server.close();
console.log('DONE');
