// 六輪 surround 整合驗: 敵人整齊環繞成同心圓、內圈滿外圈、菁英外圈。
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
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3200);
await page.keyboard.press('KeyC'); await page.waitForTimeout(500);
// 生一群敵人環繞玩家。
await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0];
  // 把玩家挪到畫面中央(避免貼邊界導致環被夾)。
  const psp = p.sprite || p.anim?.sprite; if(psp){ psp.x=960; psp.y=540; }
  // 清掉場上既有(wave)敵人, 只留我們控制的。
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  const c = p.getHitCenter?p.getHitCenter():{x:960,y:540};
  const sp=ctx.spawner;
  const R=280;
  for(let i=0;i<8;i++){ const a=i/8*Math.PI*2; sp.spawn('Enemy_Rush', c.x+Math.cos(a)*R, c.y+Math.sin(a)*R); }
  sp.spawn('Enemy_Elite', c.x-320, c.y); // 菁英一隻(應排外圈)
});
await page.waitForTimeout(7000); // 讓 coordinateSurround 把牠們排進同心圓 + 走到位
const r = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; const c = p.getVacuumCenter?p.getVacuumCenter():p.getHitCenter();
  const es=(ctx.spawner.enemies||[]);
  const rows = es.map((e)=>{
    const sx=e.anim.sprite.x, sy=e.anim.sprite.y;
    const ang = Math.round(Math.atan2(sy-c.y, sx-c.x)*180/Math.PI);
    return { key:e.cfg.characterKey, dist: Math.round(Math.hypot(sx-c.x, sy-c.y)), ang, minLayer: e.getSurroundMinLayer?e.getSurroundMinLayer():'?', atSlot: e.isAtSlot?e.isAtSlot(16):'?' };
  }).sort((a,b)=>a.dist-b.dist);
  return { center:{x:Math.round(c.x),y:Math.round(c.y)}, vacuumR: Math.round(p.getVacuumRadius?p.getVacuumRadius():0), count: es.length, rows };
});
console.log('[surround 整合驗]');
console.log(' center', JSON.stringify(r.center), 'vacuumR', r.vacuumR, 'count', r.count);
console.log(' 敵人(依距圈心排序): key / dist / minLayer / atSlot');
for(const row of r.rows) console.log('  ', row.key.padEnd(13), 'dist='+String(row.dist).padStart(4), 'ang='+String(row.ang).padStart(4), 'minLayer='+row.minLayer, 'atSlot='+row.atSlot);
const angs = r.rows.filter((x)=>x.dist<400).map((x)=>x.ang).sort((a,b)=>a-b);
console.log(' 角度分布(dist<400,環上敵人):', JSON.stringify(angs));
const atSlotCount = r.rows.filter((x)=>x.atSlot===true).length;
console.log(' 到位(atSlot)數:', atSlotCount, '/', r.count);
// 分析同心圓: dist 應分群(內圈~小值、外圈~大值), 菁英應在較外。
const rush = r.rows.filter((x)=>x.key==='Enemy_Rush').map((x)=>x.dist);
const elite = r.rows.filter((x)=>x.key==='Enemy_Elite').map((x)=>x.dist);
console.log(' Rush dist:', JSON.stringify(rush));
console.log(' Elite dist:', JSON.stringify(elite));
console.log(' 菁英在外圈?', elite.length&&rush.length ? (Math.min(...elite) >= Math.max(...rush.filter((d,i)=>i<3)) ? '傾向是(菁英dist>=內圈Rush)' : '菁英dist='+elite+' vs Rush內圈'+rush.slice(0,3)) : 'n/a');
await page.screenshot({ path:'/tmp/surround.png' });
console.log(' 截圖 /tmp/surround.png');
// 額外: 清掉遠處還在趕路/wave新生的, 只留環上的, 再截一張乾淨的。
await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; const c=p.getVacuumCenter?p.getVacuumCenter():p.getHitCenter();
  for(const e of (ctx.spawner.enemies||[])){ const d=Math.hypot(e.anim.sprite.x-c.x, e.anim.sprite.y-c.y); if(d>320 && e.forceDestroy) e.forceDestroy(); }
});
await page.waitForTimeout(2500);
await page.screenshot({ path:'/tmp/surround-clean.png' });
console.log(' 截圖 /tmp/surround-clean.png (清遠處strays後)');
await browser.close(); server.close();
console.log('DONE');
