// 七輪#7 診斷: 怪在角色下方互相推擠、不攻擊? 量化下方怪的位置/狀態/canReach。
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
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3300);
await page.keyboard.press('KeyC'); await page.waitForTimeout(400);
const r = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx.players[0]; const psp=p.sprite||p.anim?.sprite; psp.x=960; psp.y=500;
  if(ctx.spawner.clearAllEnemies) ctx.spawner.clearAllEnemies();
  const c=p.getHitCenter(); const vc=p.getVacuumCenter?p.getVacuumCenter():c; const vr=p.getVacuumRadius?p.getVacuumRadius():50;
  // 生一圈怪, 特別多在下方(y>玩家)。
  const sp=ctx.spawner;
  for(let i=0;i<8;i++){ const a=Math.PI*0.25 + i/8*Math.PI; sp.spawn('Enemy_Rush', c.x+Math.cos(a)*180, c.y+Math.sin(a)*180+120); } // 下半圈+偏下
  for(let i=0;i<4;i++){ sp.spawn('Enemy_Rush', c.x-60+i*40, c.y+220); } // 正下方一排
  await new Promise((r)=>setTimeout(r,10000)); // 讓 AI 跑久一點, 看外圈怪逼近能攻擊(七輪#7)
  const es=(ctx.spawner.enemies||[]);
  const rows = es.map((e)=>{
    const ex=e.anim.sprite.x, ey=e.anim.sprite.y;
    const below = ey > c.y; // 在玩家下方
    const distVac = Math.round(Math.hypot(ex-vc.x, ey-vc.y));
    const bc = e.getBodyCenter?e.getBodyCenter():{x:ex,y:ey};
    const distBodyToPlayer = Math.round(Math.hypot(bc.x-c.x, bc.y-c.y));
    return { key:e.cfg.characterKey, state:e.state, below, ey:Math.round(ey), distVac, distBody: distBodyToPlayer, attackRangePx: Math.round(e.cfg.attackRange*100),
      hasSlot: !!e.slotPos, atSlot: e.isAtSlot?e.isAtSlot(16):null, slotDist: e.slotPos?Math.round(Math.hypot(e.slotPos.x-c.x, e.slotPos.y-c.y)):null };
  });
  const below = rows.filter((x)=>x.below);
  const stateCount = {}; for(const r of rows){ stateCount[r.state]=(stateCount[r.state]||0)+1; }
  const belowStates = {}; for(const r of below){ belowStates[r.state]=(belowStates[r.state]||0)+1; }
  return { playerY:Math.round(c.y), vacCenter:{x:Math.round(vc.x),y:Math.round(vc.y)}, vacR:Math.round(vr),
    total: rows.length, stateCount, belowCount: below.length, belowStates,
    belowSample: below.sort((a,b)=>b.ey-a.ey).slice(0,6) };
});
console.log('[七輪#7 下方怪推擠不攻擊診斷]'); console.log(JSON.stringify(r, null, 2));
await page.screenshot({ path:'/tmp/crowd-below.png' });
console.log('  截圖 /tmp/crowd-below.png');
await browser.close(); server.close();
console.log('DONE');
