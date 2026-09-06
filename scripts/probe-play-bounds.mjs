// 第四輪#1 診斷: 角色/怪能到的最大 y vs 下方面板上緣。量化可移動下界。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(600);
// 常數 + 玩家往下走到底看 clamp。
const info = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  window.__gs=gs; window.__ctx=ctx;
  const GAME_HEIGHT=1080;
  const PANEL_TOP_Y = GAME_HEIGHT - 16 - 120; // 944
  // 玩家往下狂走。
  const p=ctx.players[0];
  return { PANEL_TOP_Y, playerStartY: Math.round(p.getPosition().y) };
});
// 模擬按下(S/下) 2 秒讓玩家撞下界。
await page.keyboard.down('ArrowDown'); await page.keyboard.down('KeyS');
await page.waitForTimeout(2000);
await page.keyboard.up('ArrowDown'); await page.keyboard.up('KeyS');
const after = await page.evaluate(()=>{
  const ctx=window.__ctx; const p=ctx.players[0];
  const c=p.getPosition();
  const foot = p.getVacuumCenter? p.getVacuumCenter(): c;
  // 敵人: 生一隻逼它往下(設位置到底部)。
  ctx.getEnemies().forEach((e)=>e.forceDestroy&&e.forceDestroy());
  ctx.spawner.spawn('Enemy_Rush', c.x, 1050); // 生在面板區內, 看 clamp 把它拉回哪
  const e=ctx.getEnemies()[0];
  if(e && e.clampToMapBounds) e.clampToMapBounds();
  const ec = e? e.getHitCenter(): null;
  const er = e? e.getHitRadius(): null;
  return {
    playerCenterY: Math.round(c.y), playerFootY: Math.round(foot.y),
    enemyCenterY: ec? Math.round(ec.y): null, enemyRadius: er? Math.round(er): null,
    enemyBottomY: ec&&er? Math.round(ec.y+er): null,
  };
});
console.log('[量化]', JSON.stringify({PANEL_TOP_Y:944, ...after}));
console.log('  面板上緣 y=944');
console.log('  玩家中心最大 y:', after.playerCenterY, '腳底 y:', after.playerFootY, '→', after.playerFootY>944?'★腳底進面板':'腳底在面板上');
console.log('  怪中心 y:', after.enemyCenterY, '底邊 y:', after.enemyBottomY, '→', after.enemyBottomY>944?'★怪底邊進面板':'怪在面板上');
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-bounds.png') });
await browser.close(); server.close();
console.log('DONE');
