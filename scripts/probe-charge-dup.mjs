// 三輪#3 診斷#2: 蓄力期有幾個 charge 特效 image、哪個 texture key。
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
const setup = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  window.__gs=gs; window.__ctx=ctx;
  const p=ctx.players[0]; const pp=p.getPosition();
  // 生衝鋒兵貼玩家旁(立刻蓄力)。
  try{ ctx.spawner.spawn('Enemy_Rush', pp.x+70, pp.y); }catch(e){ return {err:String(e)}; }
  const es2=ctx.getEnemies(); const e=es2[es2.length-1];
  window.__enemyY = e? Math.round(e.getHitCenter().y): null;
  // 兩個 charge texture 是否都載入?
  const tex=gs.textures;
  return { chargeLoaded: tex.exists('vfx-enemy-charge'), charge2Loaded: tex.exists('vfx-enemy-charge2') };
});
console.log('[setup]', JSON.stringify(setup));
// 蓄力期(chargeTime 0.5s)取樣：場上 charge 系 texture 的 image 數 + key。
async function snap(lbl){
  return page.evaluate((l)=>{
    const gs=window.__gs; const list=gs.children.list;
    const charged=list.filter((o)=>o.type==='Image'&&o.texture&&['vfx-enemy-charge','vfx-enemy-charge2','vfx-enemy-aoe-ring'].includes(o.texture.key));
    return { lbl:l, count:charged.length, keys:charged.map((o)=>({key:o.texture.key.replace('vfx-enemy-',''), depth:o.depth, alpha:Math.round(o.alpha*100)/100, angle:Math.round(o.angle), dw:Math.round(o.displayWidth), dh:Math.round(o.displayHeight), y:Math.round(o.y)})) };
  }, lbl);
}
// 密集取樣抓蓄力瞬間。
for(const t of [150, 300, 450, 700, 1100]){ await page.waitForTimeout(t===150?150:t-([150,300,450,700,1100][[150,300,450,700,1100].indexOf(t)-1]||0)); console.log('[t='+t+'ms]', JSON.stringify(await snap('t'+t))); }
const ey = await page.evaluate(()=>window.__enemyY); console.log('[衝鋒兵 body 中心 y]', ey, '(charge2 y 應 > 此=在腳底下方)');
// 再生一隻、蓄力中截圖(400ms 峰值)。
await page.evaluate(()=>{ const ctx=window.__ctx; const pp=ctx.players[0].getPosition(); try{ctx.spawner.spawn('Enemy_Rush', pp.x+80, pp.y);}catch(e){} });
await page.waitForTimeout(380);
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-footdisc.png') });
await browser.close(); server.close();
console.log('DONE');
