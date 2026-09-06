// #3#4 驗: 圓形範圍敵人 → charge2(集氣旋轉)+aoe預告圈(蓄力)+aoe爆發(出手)。
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
console.log('ctx?', ready, '| 貼圖:', await page.evaluate(()=>{const g=window.__PHASER_GAME__;return['vfx-enemy-charge2','vfx-enemy-aoe-ring','vfx-enemy-aoe-burst'].map(k=>k+'='+g.textures.exists(k)).join(', ');}));
// 生近戰(circle shape)怪貼玩家附近。
await page.evaluate(()=>{
  const ctx=window.__ctx; const p=ctx.players[0]; const pos=p.getHitCenter();
  for(let i=0;i<3;i++) ctx.spawner.spawn('Enemy_Rush', pos.x+100+i*15, pos.y+(i-1)*25);
  ctx.spawner.spawn('Enemy_Elite', pos.x+130, pos.y+40);
});
const seen={charge2:false,ring:false,burst:false}; let rotSeen=false, lastAngle=null;
for(let i=0;i<70;i++){
  await page.waitForTimeout(50);
  const cur = await page.evaluate(()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const out={c2:false,ring:false,burst:false,c2angle:null};
    gs.children.list.forEach((o)=>{ if(o.texture){ const k=o.texture.key;
      if(k==='vfx-enemy-charge2'){ out.c2=true; out.c2angle=o.angle; }
      if(k==='vfx-enemy-aoe-ring') out.ring=true;
      if(k==='vfx-enemy-aoe-burst') out.burst=true; } });
    return out;
  });
  if(cur.c2){ seen.charge2=true; if(lastAngle!==null && cur.c2angle!==lastAngle) rotSeen=true; lastAngle=cur.c2angle; }
  if(cur.ring) seen.ring=true;
  if(cur.burst) seen.burst=true;
}
console.log('[#3#4 驗] 集氣charge2=', seen.charge2, ' charge2旋轉(角度有變)=', rotSeen, ' | AOE預告圈=', seen.ring, ' AOE爆發=', seen.burst);
console.log('  結果:', seen.charge2&&rotSeen&&seen.ring&&seen.burst ? 'PASS 集氣旋轉+AOE預告+爆發全觸發' : '部分(見上)');
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-aoe.png') });
await browser.close(); server.close();
console.log('DONE');
