// overhead override 診斷: 塞改過 overhead 位置的 uiLayout override → 遊戲 overhead 有沒有跟著變?
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/')u='/index.html'; const fp=path.join(distDir,u); if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
// 讀打包 uiLayout, 改 overhead.badge.cx +80 + foot.searchRadiusPx=120(對照) + panel platform 位移, 塞 override。
const full = JSON.parse(fs.readFileSync(path.join(distDir,'assets/data/uiLayout.json'),'utf8'));
const origBadgeCx = full.overhead.badge.cx;
full.overhead.badge.cx = origBadgeCx + 80;      // overhead 位置改
full.overhead.credit.x = full.overhead.credit.x + 60;
full.foot.searchRadiusPx = 120;                  // 對照(搜索圈已知會變)

const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:720} });
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,150)));
await page.addInitScript(`localStorage.setItem('transformbrawl:uiLayout', ${JSON.stringify(JSON.stringify(full))});`);
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3400);
await page.keyboard.press('KeyC'); await page.waitForTimeout(600);
const r = await page.evaluate((expectBadgeCx)=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const uisys=(gs.systems||[]).find((x)=>x&&x.name==='UISystem');
  const p=ctx.players[0];
  // 搜索圈半徑(對照, 已接 override)
  const vacR = p.getVacuumRadius?p.getVacuumRadius():null;
  // overhead: UISystem.overheads[0] 的 badge 圓心 local? 讀 PlayerOverheadUI 內部不易, 改讀 layout 是否被讀。
  // 直接看 UISystem 拿到的 layout.overhead.badge.cx(遊戲載入的 layout)vs OVERHEAD_LAYOUT 靜態。
  const layoutBadgeCx = uisys && uisys.layout && uisys.layout.overhead ? uisys.layout.overhead.badge.cx : null;
  // PlayerOverheadUI 實際用的 badge 位置(找 container 內 ring/pnum 的 local x ≈ cx)。
  const oh = uisys && uisys.overheads ? uisys.overheads[0] : null;
  let ohBadgeX = null;
  if(oh && oh.container && oh.container.list){
    // 找 graphics(pnum 畫在 cx,cy)不易讀 local; 改看 groupBadge 第一個 image(ringImg)x。
    const ringImg = oh.container.list.find((o)=>o.type==='Image');
    ohBadgeX = ringImg ? Math.round(ringImg.x) : null;
  }
  return { expectBadgeCx, layoutBadgeCx, ohBadgeX, vacR };
}, origBadgeCx+80);
console.log('[overhead override 診斷]'); console.log(JSON.stringify(r, null, 1));
console.log('  對照 搜索圈半徑(override 120)?', r.vacR===120?'PASS 有接 override':'FAIL='+r.vacR);
console.log('  UISystem.layout.overhead.badge.cx =', r.layoutBadgeCx, '(override 期望', r.expectBadgeCx, ')', r.layoutBadgeCx===r.expectBadgeCx?'layout 有讀到 override':'layout 沒讀到');
console.log('  PlayerOverheadUI 實際 badge ringImg.x =', r.ohBadgeX, '(若 ≠ override cx = overhead 位置漏接 override, 用 OVERHEAD_LAYOUT 靜態)');
await page.screenshot({ path:'/tmp/overhead-override.png' }); console.log('screenshot');
await browser.close(); server.close();
console.log('DONE');
