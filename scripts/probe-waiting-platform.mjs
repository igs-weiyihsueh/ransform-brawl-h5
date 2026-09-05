// #1 驗: 下方面板每欄有 platform.png、待機角色站平台中心(waitingX/Y)。
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
await page.waitForTimeout(3800); // 開場所有玩家 waiting, 應站平台上
const info = await page.evaluate(()=>{
  const g=window.__PHASER_GAME__; const gs=g.scene.getScene('GameScene');
  const platLoaded = g.textures.exists('ui-platform');
  function walk(list, acc){ list.forEach((o)=>{ if(o.texture&&o.texture.key) acc.push({k:o.texture.key,x:Math.round(o.x),y:Math.round(o.y)}); if(o.list) walk(o.list, acc); }); }
  const deep=[]; walk(gs.children.list, deep);
  const plats = deep.filter((d)=>d.k==='ui-platform');
  const player = gs.children.list.find((o)=>o.type==='Sprite'&&o.texture&&/Human|SunWukong/.test(o.texture.key||''));
  // 待機角色 x/y
  const pxy = player?{x:Math.round(player.x),y:Math.round(player.y)}:null;
  // 最近的平台跟玩家距離
  let nearest=null;
  if(pxy) plats.forEach((p)=>{ const d=Math.hypot(p.x-pxy.x,p.y-pxy.y); if(nearest===null||d<nearest.d) nearest={d:Math.round(d),px:p.x,py:p.y}; });
  return { platLoaded, platCount: plats.length, plats, playerXY: pxy, nearestPlatformToPlayer: nearest };
});
console.log('[#1 驗]', JSON.stringify(info));
console.log('  平台圖存在且畫出:', info.platLoaded && info.platCount>0 ? `PASS (${info.platCount} 個平台)` : 'FAIL');
console.log('  待機角色站平台上(離最近平台<60px):', info.nearestPlatformToPlayer && info.nearestPlatformToPlayer.d<60 ? `PASS (距 ${info.nearestPlatformToPlayer.d}px)` : `注意 (距 ${info.nearestPlatformToPlayer?info.nearestPlatformToPlayer.d:'?'}px)`);
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-platform.png') });
await browser.close(); server.close();
console.log('DONE');
