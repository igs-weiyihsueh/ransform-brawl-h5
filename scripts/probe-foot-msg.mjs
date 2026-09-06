// 三輪#5#8 驗: 搜索圈讀 foot 半徑 + event/fireRain 訊息讀 layout 位置 + 舊 JSON fallback 不炸。
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
const r = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  window.__gs=gs; window.__ctx=ctx;
  // 搜索圈半徑(讀 foot)。
  const vr = ctx.players[0].getVacuumRadius();
  // layout.foot 值。
  const raw = gs.cache.json.get('ui-layout');
  return { vacuumRadius: vr, layoutFoot: raw?.foot, layoutScreen: raw?.screen? Object.keys(raw.screen): null };
});
console.log('[搜索圈]', JSON.stringify(r), '(vacuumRadius 應=layout.foot.searchRadiusPx=50)');
// event/fireRain 訊息: 播出來、讀 layout 位置。
const msg = await page.evaluate(()=>{
  const gs=window.__gs; const ctx=window.__ctx;
  const before = gs.children.list.filter((o)=>o.type==='Text').length;
  ctx.effects.timedEventText(2);       // 事件訊息
  ctx.effects.fireRainAnnounce(()=>{}); // 火雨訊息
  const texts = gs.children.list.filter((o)=>o.type==='Text').map((o)=>({txt:o.text, y:Math.round(o.y), origin:o.originX}));
  return { newTexts: texts.filter((t)=>t.txt==='限時事件'||t.txt==='天降火雨！') };
});
console.log('[event/fireRain 訊息]', JSON.stringify(msg.newTexts), '(限時事件 y≈370=324+46/ 天降火雨 y≈526=480+46)');
// 驗 foot 真的讀 layout(非巧合): 改 cache foot=90 再 new 一個 Player 讀。
const dyn = await page.evaluate(()=>{
  const gs=window.__gs;
  const raw = gs.cache.json.get('ui-layout');
  // 改 radius=90 + offsetX=13。
  const mod = JSON.parse(JSON.stringify(raw)); mod.foot={searchRadiusPx:90,offsetX:13,offsetY:60};
  gs.cache.json.remove('ui-layout'); gs.cache.json.add('ui-layout', mod);
  // new Player 讀新值(用 window 上的 Player class? 沒有 → 用 ctx.player 的 class)。
  const P = window.__ctx.players[0].constructor;
  const p2 = new P(gs, 500, 500, 'Human', 1, 'human');
  const r = { r: p2.getVacuumRadius(), c: p2.getVacuumCenter() };
  // 舊 JSON fallback: 清 foot。
  const noFoot = JSON.parse(JSON.stringify(raw)); delete noFoot.foot; delete noFoot.screen;
  gs.cache.json.remove('ui-layout'); gs.cache.json.add('ui-layout', noFoot);
  const p3 = new P(gs, 500, 500, 'Human', 2, 'human');
  const fb = { r: p3.getVacuumRadius() };
  return { modRadius: r.r, modCenterOffX: Math.round(r.c.x-500), fallbackRadius: fb.r };
});
console.log('[foot 動態]', JSON.stringify(dyn), '(改90→r=90 offX13; 清foot→fallback50不炸)');
console.log('  讀 layout foot 生效:', dyn.modRadius===90&&dyn.modCenterOffX===13?'PASS':'FAIL', '| 舊JSON fallback:', dyn.fallbackRadius===50?'PASS':'FAIL');
await browser.close(); server.close();
console.log('DONE');
