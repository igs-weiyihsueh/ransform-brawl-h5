import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise((r)=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const b=await chromium.launch(); const pg=await b.newPage();
pg.on('pageerror',(e)=>console.log('[pageerror]',String(e).slice(0,150)));
await pg.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'}); await pg.waitForTimeout(2800);
// 生 5 隻怪全疊在同一點。
await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const sp=gs.ctx.spawner;const cx=960,cy=540;for(let i=0;i<5;i++)sp.spawn('Enemy_Rush',cx+i*3,cy);});
// 跑 1s 讓 de-overlap 收斂。
await pg.waitForTimeout(1000);
const r=await pg.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');const sp=gs.ctx.spawner;
  const es=(sp.enemies||[]).filter(e=>!e.isDead());
  let minPair=Infinity;
  for(let i=0;i<es.length;i++)for(let j=i+1;j<es.length;j++){const a=es[i].getHitCenter(),b=es[j].getHitCenter();const d=Math.hypot(a.x-b.x,a.y-b.y);const need=es[i].getHitRadius()+es[j].getHitRadius();minPair=Math.min(minPair,d/need);}
  // 界內檢查
  const outOfBounds=es.some(e=>{const c=e.getHitCenter();return c.x<0||c.x>1920||c.y<0||c.y>1080;});
  return {count:es.length, minPairRatio:+minPair.toFixed(2), outOfBounds};
});
console.log('[#4 敵-敵 de-overlap 驗證] 5 隻疊同點');
console.log('  最近一對 dist/所需 =', r.minPairRatio, r.minPairRatio>=0.95?'PASS(不重疊,>=body 和)':'★仍重疊');
console.log('  有出界?', r.outOfBounds?'★FAIL出界':'PASS界內');
// 抖動檢查：再跑 0.5s 看位置穩定（不 jitter）。
const p1=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');return gs.ctx.spawner.enemies.filter(e=>!e.isDead()).map(e=>{const c=e.getHitCenter();return {x:Math.round(c.x),y:Math.round(c.y)};});});
await pg.waitForTimeout(300);
const p2=await pg.evaluate(()=>{const gs=window.__PHASER_GAME__.scene.getScene('GameScene');return gs.ctx.spawner.enemies.filter(e=>!e.isDead()).map(e=>{const c=e.getHitCenter();return {x:Math.round(c.x),y:Math.round(c.y)};});});
let maxMove=0;for(let i=0;i<Math.min(p1.length,p2.length);i++)maxMove=Math.max(maxMove,Math.hypot(p1[i].x-p2[i].x,p1[i].y-p2[i].y));
console.log('  0.3s 內最大移動', Math.round(maxMove),'px', maxMove<40?'PASS(穩定不抖)':'(有移動,可能追玩家非抖)');
await b.close(); server.close(); console.log('DONE');
