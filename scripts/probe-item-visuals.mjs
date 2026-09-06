// #7 驗: 牽引線(玩家→面板)+道具owner邊框+指引箭頭。截圖給視覺。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(1500); // 進場(離開待機牽引線才畫)
const ready = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  window.__ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  window.__ts=(gs.systems||[]).find((x)=>x&&x.name==='TransformSystem');
  return !!window.__ctx && !!window.__ts;
});
// 生一個道具在玩家附近偏遠(>1.5 unit, 箭頭才顯), 讓 owner=P1。
await page.evaluate(()=>{
  const ts=window.__ts; const p=window.__ctx.players[0]; const pos=p.getHitCenter();
  // 直接呼 spawnItem 幾次(owner round-robin, 單人全 P1)。
  ts.spawnItem();
});
await page.waitForTimeout(300);
const info = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  // tether/guide graphics 存在?(depth -3 / 25)
  let tether=false, guide=false;
  gs.children.list.forEach((o)=>{ if(o.type==='Graphics'&&o.depth===-3) tether=true; if(o.type==='Graphics'&&o.depth===25) guide=true; });
  // 道具 owner?
  const ts=window.__ts;
  const items=ts.items||[];
  const owners=items.map((it)=>it.getOwner?it.getOwner():undefined);
  return { tetherGfx: tether, guideGfx: guide, itemCount: items.length, owners };
});
console.log('[#7 驗]', JSON.stringify(info));
console.log('  牽引線 graphics(depth-3):', info.tetherGfx?'PASS':'FAIL', '| 指引箭頭 graphics(depth25):', info.guideGfx?'PASS':'FAIL', '| 道具有owner:', info.owners.every((o)=>o!==undefined)?'PASS':'FAIL');
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-item3.png') });
await browser.close(); server.close();
console.log('DONE');
