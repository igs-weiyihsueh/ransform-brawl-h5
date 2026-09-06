// 五輪#4 診斷: 菁英 aoeRing 圓心 vs 菁英位置(sprite中心/視覺). 量化偏移+截圖。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(500);
// 生菁英貼玩家旁, 等蓄力(aoeRing 出現)。
await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  window.__gs=gs; window.__ctx=ctx;
  ctx.getEnemies().forEach((e)=>e.forceDestroy&&e.forceDestroy());
  const pp=ctx.players[0].getPosition();
  ctx.spawner.spawn('Enemy_Elite', pp.x+120, pp.y);
});
// 菁英 chargeTime 0.5s → 蓄力期 aoeRing 出現, 抓到量測。
let data=null;
for(let i=0;i<15;i++){
  await page.waitForTimeout(80);
  data = await page.evaluate(()=>{
    const gs=window.__gs; const ctx=window.__ctx;
    const e=ctx.getEnemies()[0]; if(!e) return null;
    const ring=gs.children.list.find((o)=>o.type==='Image'&&o.texture&&o.texture.key==='vfx-enemy-aoe-ring');
    if(!ring) return {noRing:true};
    const hc=e.getHitCenter(); const sp=e.anim.sprite;
    return {
      enemyHitCenterX: Math.round(hc.x), enemyHitCenterY: Math.round(hc.y),
      spriteX: Math.round(sp.x), spriteY: Math.round(sp.y),
      spriteDisplayH: Math.round(sp.displayHeight),
      // 視覺腳底估: sprite 中心 + displayHeight/2 * (視覺 body 在下半) — 用 FOOT_GLOW.offsetYPx 概念≈75.6
      ringX: Math.round(ring.x), ringY: Math.round(ring.y),
      dx: Math.round(ring.x-hc.x), dy: Math.round(ring.y-hc.y),
    };
  });
  if(data && !data.noRing) break;
}
console.log('[量化]', JSON.stringify(data));
if(data && !data.noRing){
  console.log('  ring 圓心 vs 敵人 getHitCenter: dx='+data.dx+' dy='+data.dy, (data.dx===0&&data.dy===0)?'(圓心=hitCenter)':'(圓心偏離 hitCenter)');
  console.log('  註: 若 dx/dy≈0 但用戶仍覺偏 → hitCenter(sprite中心) vs 視覺body中心 不一致(sprite 有留白, 視覺 body 偏下)');
}
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-ringcenter.png') });
await browser.close(); server.close();
console.log('DONE');
