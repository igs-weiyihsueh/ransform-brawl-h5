// 驗: 二段變身放大(setSecondTransformScale 1.4)後 footGlow 搜索圈對齊放大後腳底不偏。
// 修真因: footGlow offsetY(72×SPRITE_SCALE≈75.6)常數沒乘 secondTransformScale→放大後偏上~30px。
// 修: scaledFootOffsetY()=offsetY×secondTransformScale。此 probe 數值斷言 footGlow.y 跟放大後腳底 + 截圖看圖。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(500); // 進場

const r = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite; psp.x=640; psp.y=360;
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  p.setFootGlowVisible(true);
  p.syncFootGlow();
  const spriteY0 = Math.round(psp.y);
  const foot0 = p.getFootGlowCenter();   // 常態 mult=1
  const glowY0 = Math.round(p.footGlow?.y ?? NaN);
  // 二段放大 1.4
  p.setSecondTransformScale(1.4);
  p.syncFootGlow();
  const foot1 = p.getFootGlowCenter();   // 放大後
  const glowY1 = Math.round(p.footGlow?.y ?? NaN);
  // 還原
  p.setSecondTransformScale(1);
  const foot2 = p.getFootGlowCenter();
  return {
    spriteY0,
    offsetY0: Math.round(foot0.y - spriteY0),   // 應 ≈75.6
    offsetY1: Math.round(foot1.y - spriteY0),   // 應 ≈75.6×1.4≈105.8
    ratio: +((foot1.y - spriteY0)/(foot0.y - spriteY0)).toFixed(3), // 應 ≈1.4
    glowY0, glowY1, glowFollowed: glowY1 - glowY0, // footGlow 實際物件 y 有無下移
    restoreOffsetY: Math.round(foot2.y - spriteY0), // 還原應回 ≈75.6
  };
});
console.log('[二段放大 footGlow 對齊驗]'); console.log(JSON.stringify(r, null, 1));
const okRatio = Math.abs(r.ratio - 1.4) < 0.02;
const okFollow = Math.abs(r.glowFollowed - (r.offsetY1 - r.offsetY0)) < 2;
const okRestore = Math.abs(r.restoreOffsetY - r.offsetY0) < 2;
console.log('  offsetY 常態→放大:', r.offsetY0, '→', r.offsetY1, 'ratio', r.ratio, okRatio?'PASS(×1.4對齊放大腳底)':'FAIL');
console.log('  footGlow 物件 y 跟隨下移:', r.glowFollowed, 'px', okFollow?'PASS':'FAIL');
console.log('  還原 mult=1 offsetY:', r.restoreOffsetY, okRestore?'PASS(回常態)':'FAIL');
console.log('  總結:', okRatio&&okFollow&&okRestore ? 'ALL PASS ✓' : 'HAS FAIL ✗');

// 截圖看圖: 放大狀態 + footGlow, 確認盤在放大角色腳底。
await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; p.setSecondTransformScale(1.4); p.syncFootGlow();
});
await page.waitForTimeout(200);
await page.screenshot({ path:'/tmp/footglow-second-scale.png' });
console.log('  截圖 /tmp/footglow-second-scale.png (二段放大 1.4 + footGlow)');
await browser.close(); server.close();
console.log('DONE');
