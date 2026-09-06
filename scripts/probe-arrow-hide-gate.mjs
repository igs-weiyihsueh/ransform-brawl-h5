// #9 查證：箭頭「近距離就消失」真因。捕捉初始道具在場時 owner→item 距離 vs hideDistanceUnits(1.5) gate。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise((r)=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const browser=await chromium.launch(); const page=await browser.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',(e)=>console.log('  [pageerror]',String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});

let snaps = [];
for (let i = 0; i < 80; i += 1) {
  await page.waitForTimeout(120);
  const s = await page.evaluate(() => {
    const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
    const ctx = gs.ctx; if (!ctx || !ctx.players?.[0]) return null;
    const PPU = 100;
    const p = ctx.players[0];
    const ts = (gs.systems||[]).find((x)=>x && x.name==='TransformSystem');
    const items = ts?.items ?? [];
    if (items.length === 0) return { n: 0 };
    const op = p.getPosition();
    return { n: items.length, items: items.map((it)=>{
      const ip = it.getPosition();
      const du = Math.hypot(ip.x-op.x, ip.y-op.y)/PPU;
      return { id: it.id, source: it.source ?? '?', distPx: Math.round(du*PPU), du: +du.toFixed(3), hidden: du < 1.5 };
    }) };
  });
  if (s && s.n > 0) snaps.push(s.items);
  if (snaps.length >= 15) break;
}
console.log('[#9 箭頭近距離 gate 查證] hide 門檻 150px(1.5u)。初始道具在場捕捉', snaps.length, '幀：');
const seen = new Set();
for (const frame of snaps) for (const it of frame) {
  const key = it.id + it.source;
  if (seen.has(key)) continue; seen.add(key);
  console.log(`  item#${it.id} source=${it.source} 首見 dist=${it.distPx}px(${it.du}u) → ${it.hidden ? '★<150 被 gate 隱藏' : '≥150 顯示'}`);
}
if (snaps.length >= 2) {
  const first = snaps[0][0], last = snaps[snaps.length-1][0];
  if (first && last && first.id === last.id) {
    console.log(`  初始道具#${first.id} 距離變化: ${first.distPx}px → ${last.distPx}px（${last.hidden ? '玩家靠近→掉到<150 被隱藏' : '仍≥150'}）`);
  }
}
await browser.close(); server.close();
console.log('DONE');
