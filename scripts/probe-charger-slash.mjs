// 三輪#2 診斷: 各敵人出手走 slash 還 aoeBurst 分支 + shapeType。監聽 fx 呼叫。
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
  const sysList=gs.systems||[];
  const ctx=sysList.find((x)=>x&&x.ctx)?.ctx;
  const es=ctx?.spawner;
  window.__names=sysList.map((x)=>x&&(x.name||x.constructor?.name));
  window.__ctx=ctx; window.__es=es;
  const fx=es?.hitFeelFx;
  window.__log=[];
  if(fx) ['enemySlash','enemyAoeBurst','enemyAoeRing','enemyCharge'].forEach((m)=>{
    if(typeof fx[m]==='function'){ const orig=fx[m].bind(fx); fx[m]=(...a)=>{ window.__log.push(m); return orig(...a); }; }
  });
  // 直接生三種怪貼玩家旁邊(進攻擊距離立刻蓄力→出手)。
  const p=ctx.players[0]; const pp=p.getPosition();
  const spawn=(type,ox)=>{ try{ es.spawn(type, pp.x+ox, pp.y); return true;}catch(e){ return String(e);} };
  const r1=spawn('Enemy_Rush', 80);
  const r2=spawn('Enemy_Elite', -80);
  const r3=spawn('Enemy_Ranged', 200);
  // 讀各怪 shapeType。
  const es2=ctx.getEnemies();
  const shapes=es2.map((e)=>({ char:e.cfg?.characterKey, shapeType:e.cfg?.attack?.shapeType, kind:e.cfg?.attackKind }));
  return { spawnRush:r1, spawnElite:r2, spawnRanged:r3, count:es2.length, shapes };
});
console.log('[setup]', JSON.stringify(setup));
const names = await page.evaluate(()=>({ names: window.__names, hasEs: !!window.__es, hasFx: !!(window.__es&&window.__es.hitFeelFx) }));
console.log('[systems]', JSON.stringify(names));
// 等蓄力+出手(chargeTime 0.5~2s)。
await page.waitForTimeout(3200);
const log = await page.evaluate(()=>({ log: window.__log }));
console.log('[fx 呼叫序列]', JSON.stringify(log));
console.log('  slash 次數:', log.log.filter((x)=>x==='enemySlash').length, '| aoeBurst 次數:', log.log.filter((x)=>x==='enemyAoeBurst').length);
await browser.close(); server.close();
console.log('DONE');
