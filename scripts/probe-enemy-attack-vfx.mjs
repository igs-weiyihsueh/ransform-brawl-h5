// #7 驗: 敵人攻擊特效 — 生近戰怪貼玩家, 觀察 vfx-enemy-charge/slash/impact 有無出現 + 截圖。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(1500);
const ready = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const sys=(gs.systems||[]).find((x)=>x&&x.ctx&&x.ctx.spawner);
  window.__ctx=sys?sys.ctx:null; return !!window.__ctx;
});
console.log('ctx 可達?', ready, '| vfx 貼圖載入:',
  await page.evaluate(()=>{const g=window.__PHASER_GAME__; return ['vfx-enemy-slash','vfx-enemy-impact','vfx-enemy-charge'].map((k)=>k+'='+g.textures.exists(k)).join(', ');}));
// 生 3 隻近戰怪貼在玩家附近(攻擊距離內→蓄力→出手→命中)。
await page.evaluate(()=>{
  const ctx=window.__ctx; const p=ctx.players[0]; const pos=p.getHitCenter();
  for(let i=0;i<3;i++) ctx.spawner.spawn('Enemy_Rush', pos.x+110+i*20, pos.y+ (i-1)*30);
});
// 取樣 3.5s, 記錄有無看到各特效 texture 在場。
const seen={charge:false,slash:false,impact:false};
let shot=false;
for(let i=0;i<70;i++){
  await page.waitForTimeout(50);
  const cur = await page.evaluate(()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const keys=[];
    gs.children.list.forEach((o)=>{ if(o.texture&&o.texture.key&&/^vfx-enemy-/.test(o.texture.key)) keys.push(o.texture.key); });
    return keys;
  });
  if(cur.includes('vfx-enemy-charge')) seen.charge=true;
  if(cur.includes('vfx-enemy-slash')){ seen.slash=true; if(!shot){ await page.screenshot({path:path.join(__dirname,'..','probe-shot-vfx.png')}); shot=true; } }
  if(cur.includes('vfx-enemy-impact')) seen.impact=true;
}
if(!shot) await page.screenshot({path:path.join(__dirname,'..','probe-shot-vfx.png')});
console.log('[#7 驗] 蓄力預警 charge=', seen.charge, ' 揮擊斬光 slash=', seen.slash, ' 命中爆閃 impact=', seen.impact);
console.log('  結果:', seen.charge&&seen.slash&&seen.impact ? 'PASS 三特效都觸發' : (seen.charge||seen.slash||seen.impact?'部分觸發(見上)':'FAIL 沒觸發'));
await browser.close(); server.close();
console.log('DONE');
