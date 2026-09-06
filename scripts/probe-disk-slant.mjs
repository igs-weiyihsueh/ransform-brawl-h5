// 五輪#2#3 診斷: charge disk + aoeBurst 斜面。截圖給 subagent 看旋轉造成長軸斜。
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
await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  window.__gs=gs; window.__ctx=ctx;
  // charge disk 在左、aoeBurst 在右, 開闊處。加參考水平線。
  const fx=ctx.effects;
  fx.enemyCharge(450, 350, 3000, 160);
  fx.enemyAoeBurst(850, 350, 130);
  const g=ctx.scene.add.graphics().setDepth(9999);
  g.lineStyle(1,0x00ff00,0.7); g.beginPath(); g.moveTo(300,350); g.lineTo(1000,350); g.strokePath(); // 水平參考線
});
// 等旋轉轉到明顯斜角(charge disk 120°/s, 等 ~350ms 轉 ~42°)。
await page.waitForTimeout(400);
const st = await page.evaluate(()=>{
  const gs=window.__gs;
  const disk=gs.children.list.find((o)=>o.type==='Image'&&o.texture&&o.texture.key==='vfx-enemy-charge-disk');
  const burst=gs.children.list.find((o)=>o.type==='Image'&&o.texture&&o.texture.key==='vfx-enemy-aoe-burst');
  return { diskAngle: disk?Math.round(disk.angle):null, diskDW:disk?Math.round(disk.displayWidth):null, diskDH:disk?Math.round(disk.displayHeight):null,
           burstAngle: burst?Math.round(burst.angle):null, burstDW:burst?Math.round(burst.displayWidth):null, burstDH:burst?Math.round(burst.displayHeight):null };
});
console.log('[量化]', JSON.stringify(st), '(壓扁 2:1 + angle 旋轉 → 長軸斜)');
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-slant.png') });
await browser.close(); server.close();
console.log('DONE');
