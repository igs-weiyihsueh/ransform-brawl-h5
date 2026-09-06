// 三輪#4 診斷: 牽引線終點 vs 搜索圈(真空圈)邊緣。量測 tether 線終點是否停在圈外緣還是穿到中心。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(800);
const info = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0];
  const PPU=100;
  const center = p.getVacuumCenter? p.getVacuumCenter(): p.getPosition();
  const rRaw = p.getVacuumRadius? p.getVacuumRadius(): null; // 應=50(px)
  const anchor = ctx.getWaitingAnchor(p.playerId);
  // 現行程式: radius = getVacuumRadius()*PPU (診斷這是不是 bug)
  const radiusUsed = rRaw*PPU;
  // tetherEndPoint 邏輯複現
  function tetherEnd(a,c,r){ const dx=a.x-c.x,dy=a.y-c.y,d=Math.hypot(dx,dy); if(d<=r||d===0)return{x:c.x,y:c.y}; return{x:c.x+(dx/d)*r,y:c.y+(dy/d)*r}; }
  const endNow = tetherEnd(anchor, center, radiusUsed); // 現行(bug)
  const endFixed = tetherEnd(anchor, center, rRaw);      // 修後(不*PPU)
  const distAnchorCenter = Math.hypot(anchor.x-center.x, anchor.y-center.y);
  return {
    searchRadiusPx: rRaw, PPU, radiusUsedNow: radiusUsed,
    anchor, center: {x:Math.round(center.x),y:Math.round(center.y)}, distAnchorCenter: Math.round(distAnchorCenter),
    endNow: {x:Math.round(endNow.x),y:Math.round(endNow.y)},
    endFixed: {x:Math.round(endFixed.x),y:Math.round(endFixed.y)},
    endNowIsCenter: Math.abs(endNow.x-center.x)<1 && Math.abs(endNow.y-center.y)<1,
    endFixedDistFromCenter: Math.round(Math.hypot(endFixed.x-center.x, endFixed.y-center.y)),
  };
});
console.log('[診斷]', JSON.stringify(info, null, 0));
console.log('  搜索圈半徑(px):', info.searchRadiusPx, '| 現行用的 radius:', info.radiusUsedNow, '(=半徑×PPU, bug?)');
console.log('  現行終點是否=角色中心(穿過整個圈):', info.endNowIsCenter);
console.log('  修後終點離中心距離:', info.endFixedDistFromCenter, 'px (應≈搜索圈半徑'+info.searchRadiusPx+'=停在圈外緣)');
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-tether.png') });
await browser.close(); server.close();
console.log('DONE');
