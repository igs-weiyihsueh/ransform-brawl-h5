// 待機玩家隔離 bug 診斷：待機時 ①頭上 UI 顯不顯 ②怪會不會鎖定/攻擊它。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise((r)=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const b=await chromium.launch(); const pg=await b.newPage();
pg.on('pageerror',(e)=>console.log('[pageerror]',String(e).slice(0,150)));
await pg.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'}); await pg.waitForTimeout(3000);
const r = await pg.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const p = gs.ctx.players[0];
  const uisys = (gs.systems||[]).find((s)=>s && s.name==='UISystem');
  const isWaiting = p.isWaiting?.();
  const oh = uisys?.overheads?.[0];
  const ohVisible = oh?.container?.visible;
  // 生一隻怪在待機玩家旁，跑幾幀，看它會不會朝玩家移動/攻擊。
  const spawner = gs.ctx.spawner;
  const pp = p.getPosition();
  spawner.spawn?.('Enemy_Rush', pp.x + 200, pp.y);
  return { isWaiting, ohVisible };
});
// 跑 1.5s 看怪有沒有靠近待機玩家
await pg.waitForTimeout(1500);
const after = await pg.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const p = gs.ctx.players[0];
  const spawner = gs.ctx.spawner;
  const enemies = spawner.enemies ?? [];
  const pp = p.getPosition();
  const e = enemies[0];
  if (!e) return { noEnemy: true };
  const ep = e.getHitCenter();
  const dist = Math.round(Math.hypot(ep.x - pp.x, ep.y - pp.y));
  const hp = typeof p.getHp === 'function' ? p.getHp() : (p.hp ?? '?');
  return { dist, hp, playerWaiting: p.isWaiting?.() };
});
console.log('[待機玩家隔離 修後驗證]');
console.log('  待機時 overhead visible:', r.ohVisible, r.ohVisible===false?'PASS(隱藏)':'★FAIL(仍顯)');
console.log('  待機時怪離玩家距離(生成時200px):', after.dist, after.dist>=190?'PASS(怪沒追近=不鎖定待機)':'★怪追近了='+after.dist);
console.log('  待機玩家 HP:', after.hp, '(沒被打應維持滿血)');
await b.close(); server.close(); console.log('DONE');
