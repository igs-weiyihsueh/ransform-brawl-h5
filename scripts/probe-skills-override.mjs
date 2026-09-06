// skills JSON 化 遊戲端 no-crash: 塞完整合法 skills override → 遊戲啟動(getCombatProfile 走 override)不炸、場景正常。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/')u='/index.html'; const fp=path.join(distDir,u); if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;

async function boot(setup){
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{width:1280,height:720} });
  let crashed=false; page.on('pageerror',(e)=>{crashed=true; console.log('  [pageerror]',String(e).slice(0,150));});
  if(setup) await page.addInitScript(setup);
  await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
  await page.waitForTimeout(3400);
  await page.keyboard.press('KeyC'); await page.waitForTimeout(600);
  const ok = await page.evaluate(()=>{
    const gs=window.__PHASER_GAME__?.scene?.getScene('GameScene');
    const ctx=(gs?.systems||[]).find((x)=>x&&x.ctx)?.ctx;
    return !!(ctx && ctx.players && ctx.players.length>0);
  });
  await browser.close();
  return { ok, crashed };
}

// A. 合法 skills override → 不炸、場景正常。
const ovOk = `localStorage.setItem('transformbrawl:skills', ${JSON.stringify(JSON.stringify({ version:1, characters:{
  Human:{ mode:'HumanSimple', energyCap:9, damageMultiplier:2.5, skills:{
    normalAttack:{shapeType:'circle',radius:1,offsetX:0.5,offsetY:0,damage:5,hitDelay:0,knockback:1},
    skill1:{shapeType:'circle',radius:1,offsetX:0.5,offsetY:0,damage:5,hitDelay:0,knockback:1},
    skill2:{shapeType:'circle',radius:1,offsetX:0.5,offsetY:0,damage:5,hitDelay:0,knockback:1},
    ultimate:{shapeType:'circle',radius:1,offsetX:0.5,offsetY:0,damage:5,hitDelay:0,knockback:1},
  }} }}))});`;
const a = await boot(ovOk);
console.log('[A 合法 skills override] 場景正常=', a.ok, 'crashed=', a.crashed, (a.ok && !a.crashed)?'PASS(getCombatProfile 走 override 不炸)':'FAIL');

// B. 壞 skills override → fallback 不炸。
const ovBad = `localStorage.setItem('transformbrawl:skills', '{bad json ]');`;
const b = await boot(ovBad);
console.log('[B 壞 skills override] 場景正常=', b.ok, 'crashed=', b.crashed, (b.ok && !b.crashed)?'PASS(fallback CHARACTER_COMBAT 不炸)':'FAIL');

server.close();
console.log('DONE');
