// 七輪 spawn 位置驗: 遊戲實際生怪點都在 ENEMY_PLAY_BOUNDS 界內、離玩家合理。
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
await page.keyboard.press('KeyC');
// 讓 wave 生一批怪, 記錄生成瞬間座標(攔 spawner.spawn)。
const r = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const sp=ctx.spawner;
  const pts=[];
  const orig=sp.spawn.bind(sp);
  sp.spawn=function(type,x,y){ pts.push({x:Math.round(x),y:Math.round(y)}); return orig(type,x,y); };
  // 跑一段時間讓 WaveSystem drip 生怪。
  await new Promise((r)=>setTimeout(r,7000));
  sp.spawn=orig;
  // ENEMY_PLAY_BOUNDS 界(160~1760/140~940); 生點應在此內(其實 inset 後更緊)。
  const MB={minX:160,maxX:1760,minY:140,maxY:940};
  const oob = pts.filter((p)=>p.x<MB.minX||p.x>MB.maxX||p.y<MB.minY||p.y>MB.maxY);
  return { count:pts.length, oobCount:oob.length, oobSample:oob.slice(0,4), sample:pts.slice(0,6) };
});
console.log('[七輪 spawn 位置驗]'); console.log(JSON.stringify(r, null, 1));
console.log('  生怪數', r.count, ' 界外數', r.oobCount, r.count>0 ? (r.oobCount===0?'PASS(全在 ENEMY_PLAY_BOUNDS 界內)':'FAIL 有界外: '+JSON.stringify(r.oobSample)) : '(無生怪, 檢查 wave)');
await browser.close(); server.close();
console.log('DONE');
