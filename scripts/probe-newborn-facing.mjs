// 第三大輪#1 診斷: 新生怪 facing vs sprite.flipX(背對回歸)。量化 t=0/0.1/移動中。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(800);
// 抓 spawner，生一隻怪在玩家「左邊」(怪→玩家在右, dx>0, facing 應=1, 期望 flipX=true)。
const spawned = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const spawner=(gs.systems||[]).find((x)=>x&&x.name==='EnemySpawner');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  window.__gs=gs; window.__ctx=ctx; window.__spawner=spawner;
  const p=ctx.players[0]; const pp=p.getPosition();
  const before=ctx.getEnemies().length;
  // 生一隻在玩家左邊 260px → 怪要朝右(dx>0, facing=1)追玩家。type 用第一個敵人類型。
  const type='Enemy_Rush';
  let ok=false;
  try { spawner.spawn(type, pp.x-260, pp.y); ok=true; } catch(err){ window.__spawnErr=String(err); }
  const after=ctx.getEnemies().length;
  return { spawnerName: spawner?.name, tried:type, ok, before, after, playerX: pp.x, err: window.__spawnErr };
});
console.log('[spawn]', JSON.stringify(spawned));
function sample(label){
  return page.evaluate((lbl)=>{
    const ctx=window.__ctx; const es=ctx.getEnemies();
    const e=es[es.length-1]; if(!e) return {lbl, none:true};
    // 讀 private via any：facing + anim.sprite.flipX + enemyFacing。
    const anim=e.anim; const sp=anim?.sprite;
    const pp=ctx.players[0].getPosition(); const ec=e.getHitCenter();
    const dx=pp.x-ec.x;
    return { lbl, facing:e.facing, flipX:sp?.flipX, enemyFacing:anim?.enemyFacing, dxToPlayer:Math.round(dx), state:e.state };
  }, label);
}
console.log('[t=0]', JSON.stringify(await sample('t=0')));
await page.waitForTimeout(100);
console.log('[t=0.1]', JSON.stringify(await sample('t=0.1')));
await page.waitForTimeout(500);
console.log('[移動中0.6s]', JSON.stringify(await sample('move')));
await page.waitForTimeout(800);
console.log('[移動中1.4s]', JSON.stringify(await sample('move2')));
// 判定: facing>0(朝右玩家) 時 flipX 應=true(enemyFlipForAnim(f>0)=true)。若 flipX=false=背對 bug。
await browser.close(); server.close();
console.log('DONE');
