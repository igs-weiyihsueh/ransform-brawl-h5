// 四輪#3#4 驗: 菁英 aoeBurst depth 壓貼地(-3<角色10)不蓋角色 + subagent 看圖。
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
// 直接呼 enemyAoeBurst 在固定開闊點 + 畫參考(角色會在哪) 驗 depth/形狀; 再實測菁英出手。
await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  window.__gs=gs; window.__ctx=ctx;
});
// 監聽 aoeBurst depth: 直接呼一次拿 depth(它內部 add image)。用 children 觀察。
const direct = await page.evaluate(()=>{
  const gs=window.__gs; const ctx=window.__ctx;
  const before=gs.children.list.length;
  ctx.effects.enemyAoeBurst(900, 300, 120);
  const bursts=gs.children.list.filter((o)=>o.type==='Image'&&o.texture&&o.texture.key==='vfx-enemy-aoe-burst');
  return { count: bursts.length, depth: bursts[0]?.depth, dw: bursts[0]?Math.round(bursts[0].displayWidth):null, dh: bursts[0]?Math.round(bursts[0].displayHeight):null };
});
console.log('[aoeBurst 直呼]', JSON.stringify(direct), '(depth 應 -3 < 角色 PLAY_DEPTH=10; dw:dh≈2:1 貼地)');
// 實測: 生菁英貼玩家旁, 等它蓄力(0.5s)+出手, 截爆發瞬間。
await page.evaluate(()=>{ const ctx=window.__ctx; ctx.getEnemies().forEach((e)=>e.forceDestroy&&e.forceDestroy()); const pp=ctx.players[0].getPosition(); ctx.spawner.spawn('Enemy_Elite', pp.x+80, pp.y); });
// 菁英 chargeTime 0.5s → ~0.6s 出手爆發。輪詢抓到 aoeBurst 出現的瞬間截圖。
let shot=false;
for(let i=0;i<20;i++){
  await page.waitForTimeout(80);
  const has = await page.evaluate(()=>{
    const gs=window.__gs; return gs.children.list.some((o)=>o.type==='Image'&&o.texture&&o.texture.key==='vfx-enemy-aoe-burst'&&o.alpha>0.5);
  });
  if(has){ await page.screenshot({ path: path.join(__dirname,'..','probe-shot-aoeburst.png') }); shot=true; break; }
}
console.log('[菁英出手爆發截圖]', shot?'captured':'missed(可能太快)');
await browser.close(); server.close();
console.log('DONE');
