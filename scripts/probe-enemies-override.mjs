// enemies JSON 化驗: override→遊戲讀改的敵人數值 / 無→打包預設 / 壞→fallback 不炸。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/')u='/index.html'; const fp=path.join(distDir,u); if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;

async function bootReadEnemy(setup){
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{width:1280,height:720} });
  let crashed=false; page.on('pageerror',(e)=>{crashed=true; console.log('  [pageerror]',String(e).slice(0,120));});
  if(setup) await page.addInitScript(setup);
  await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
  await page.waitForTimeout(3400);
  await page.keyboard.press('KeyC'); await page.waitForTimeout(400);
  const r = await page.evaluate(async ()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
    // 生一隻 Rush 讀其 cfg。
    const e = ctx.spawner.spawn('Enemy_Rush', 900, 500);
    return { hp: e.cfg.hp, moveSpeed: e.cfg.moveSpeed, attackRange: e.cfg.attackRange };
  });
  await browser.close();
  return { ...r, crashed };
}

// A. 無 override → 打包預設(Rush hp3/moveSpeed1.5)。
const a = await bootReadEnemy(null);
console.log('[A 無 override] Rush hp=', a.hp, 'moveSpeed=', a.moveSpeed, (a.hp===3&&a.moveSpeed===1.5)?'PASS(打包預設)':'?');

// B. override enemies: Rush hp=99, moveSpeed=5 → 遊戲應讀到。
const ovEnemies = { version:1, enemies: {
  Enemy_Rush: { characterKey:'Enemy_Rush', hp:99, moveSpeed:5, detectRange:30, attackRange:2, chargeTime:0.5, attackCooldown:2, attackKind:'melee', attack:{shapeType:'circle',radius:0.45,offsetX:0.8,offsetY:0,damage:10,hitDelay:0,knockback:3}, hitStun:0.8, knockbackForce:3 }
}};
const ovB = `localStorage.setItem('transformbrawl:enemies', ${JSON.stringify(JSON.stringify(ovEnemies))});`;
const b = await bootReadEnemy(ovB);
console.log('[B override hp=99 speed=5] Rush hp=', b.hp, 'moveSpeed=', b.moveSpeed, (b.hp===99&&b.moveSpeed===5)?'PASS(讀到用戶設定)':'FAIL');

// C. 壞 JSON override → fallback 打包預設不炸。
const ovC = `localStorage.setItem('transformbrawl:enemies', '{ bad json ]');`;
const c = await bootReadEnemy(ovC);
console.log('[C 壞JSON] Rush hp=', c.hp, 'crashed=', c.crashed, (!c.crashed&&c.hp===3)?'PASS(fallback預設不炸)':'FAIL');

server.close();
console.log('DONE');
