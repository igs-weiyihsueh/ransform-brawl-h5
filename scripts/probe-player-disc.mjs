// 識別圓盤接線驗證：footGlow 是 disc Image、染玩家色、貼地尺寸、depth -10、跟腳下。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise((r)=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const browser=await chromium.launch(); const page=await browser.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',(e)=>console.log('  [pageerror]',String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'}); await page.waitForTimeout(3000);
const r = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const texLoaded = gs.textures.exists('vfx-player-disc');
  const p = gs.ctx.players[0];
  const fg = p.footGlow;
  const sp = p.anim?.sprite;
  return {
    texLoaded,
    type: fg?.type,                       // 'Image' = 圓盤
    tint: fg?.tintTopLeft?.toString(16),  // 染色
    depth: fg?.depth,
    dw: Math.round(fg?.displayWidth ?? 0),
    dh: Math.round(fg?.displayHeight ?? 0),
    visible: fg?.visible,
    alpha: fg?.alpha,
    discXY: fg ? { x: Math.round(fg.x), y: Math.round(fg.y) } : null,
    spriteXY: sp ? { x: Math.round(sp.x), y: Math.round(sp.y) } : null,
    spriteDepth: sp?.depth,
  };
});
console.log('[識別圓盤接線]');
console.log(JSON.stringify(r, null, 1));
console.log('  圓盤 Image?', r.type==='Image'?'PASS':'FAIL='+r.type, '| tex 載入?', r.texLoaded?'PASS':'FAIL');
console.log('  貼地 2:1 (dh≈dw/2)?', Math.abs(r.dh - r.dw/2) <= 2 ? 'PASS' : 'FAIL', `(${r.dw}x${r.dh})`);
console.log('  depth -10 低於角色?', r.depth===-10 && r.depth < r.spriteDepth ? 'PASS' : 'FAIL', `(disc ${r.depth} vs sprite ${r.spriteDepth})`);
console.log('  染 P1 色 0x4fc3f7?', r.tint==='4fc3f7'?'PASS':'其他='+r.tint);
// 移動角色一下看圓盤跟隨。
await page.keyboard.down('KeyD'); await page.waitForTimeout(500); await page.keyboard.up('KeyD');
await page.waitForTimeout(200);
const r2 = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const p = gs.ctx.players[0]; const fg = p.footGlow; const sp = p.anim?.sprite;
  return { discX: Math.round(fg.x), spriteX: Math.round(sp.x), dxToSprite: Math.round(fg.x - sp.x), dyToSprite: Math.round(fg.y - sp.y) };
});
console.log('  移動後圓盤跟隨: disc.x', r2.discX, 'sprite.x', r2.spriteX, '偏移 dx', r2.dxToSprite, 'dy', r2.dyToSprite, '(dx≈0 水平置中、dy>0 在腳下)');
await page.screenshot({ path: '/tmp/player-disc.png' });
await browser.close(); server.close();
console.log('DONE');
