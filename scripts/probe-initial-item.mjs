// 五輪#1 驗: 玩家進場落地後 → 落點旁有該玩家有主初始變身道具(owner=玩家, 標色框)。
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
// 記進場前道具數。
const before = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const ts=(gs.systems||[]).find((x)=>x&&x.name==='TransformSystem');
  window.__gs=gs; window.__ctx=ctx; window.__ts=ts;
  ts.items.forEach((it)=>it.destroy&&it.destroy()); ts.items=[]; ts.ownerQueues=new Map();
  return { itemsBefore: ts.items.length, waiting: ctx.players[0].isWaiting? ctx.players[0].isWaiting(): null };
});
console.log('[進場前]', JSON.stringify(before));
await page.keyboard.press('KeyC'); // 投幣進場
await page.waitForTimeout(1500); // 等進場拋物線落地(ENTRANCE.durationSec)
const after = await page.evaluate(()=>{
  const ts=window.__ts; const ctx=window.__ctx;
  const p=ctx.players[0]; const pp=p.getPosition();
  const items=ts.items.map((it)=>({owner:it.getOwner?it.getOwner():undefined, pos:it.getPosition?it.getPosition():null, hasBorder:!!it.ownerBorder}));
  return { itemsAfter: ts.items.length, playerPos:{x:Math.round(pp.x),y:Math.round(pp.y)}, items: items.map((i)=>({owner:i.owner, x:Math.round(i.pos.x), y:Math.round(i.pos.y), hasBorder:i.hasBorder})) };
});
console.log('[進場後]', JSON.stringify(after));
const init = after.items.find((i)=>i.owner===0);
console.log('  P1 初始道具(owner=0):', init?'有':'無', init?('位置 dx='+(init.x-after.playerPos.x)+' dy='+(init.y-after.playerPos.y)+' 有主框='+init.hasBorder):'', init&&init.hasBorder&&Math.abs(init.x-after.playerPos.x)<150&&Math.abs(init.y-after.playerPos.y)<200?'PASS':'FAIL');
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-inititem.png') });
await browser.close(); server.close();
console.log('DONE');
