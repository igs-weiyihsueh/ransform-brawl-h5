// ★凡人不顯二段能量條驗證：
//  - 凡人（未變身，isSecondTransformAvailable=false）→ 二段能量條整條(底槽+填充)隱藏。
//  - 一段悟空變身後（flag 開時 available=true）→ 顯條。此驗證用「gate 正確性」：
//    凡人狀態下 SecondEnergyBar.bg/fill 皆 visible=false。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(path.resolve(__dirname, '..'), 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json','.css':'text/css' };
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/'||u==='')u='/index.html'; let fp=path.join(distDir,u); if(fs.existsSync(fp)&&fs.statSync(fp).isDirectory())fp=path.join(fp,'index.html'); if(!fp.startsWith(distDir)||!fs.existsSync(fp)){res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:720} });
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil:'networkidle' });
await page.waitForTimeout(2500);

// 進場落地（凡人）。
await page.keyboard.press('KeyC');
await page.waitForTimeout(1600);

// 讀凡人狀態下二段能量條的可見性（透過 UISystem.overheads[0].secondEnergyBar）。
const readBar = () => page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const uisys = (gs.systems||[]).find((s)=>s && s.name==='UISystem');
  const ctx = uisys?.ctx || (gs.systems||[]).find((s)=>s && s.ctx)?.ctx;
  const p = ctx.players[0];
  const oh = uisys.overheads?.[0];
  const seb = oh?.secondEnergyBar;
  return {
    available: ctx.isSecondTransformAvailable ? ctx.isSecondTransformAvailable(p.playerId) : null,
    bgVisible: seb?.bg ? seb.bg.visible : null,
    fillVisible: seb?.fill ? seb.fill.visible : null,
  };
});
const human = await readBar();
await page.screenshot({ path:'/tmp/second-bar-human-hidden.png' });

const pass=(b)=>b?'PASS':'★FAIL';
console.log('[★凡人不顯二段能量條 驗證]');
console.log('  凡人狀態:', JSON.stringify(human));
console.log('     - available=false（凡人/flag 關）:', pass(human.available===false));
console.log('     - 二段條整條隱藏（bg+fill visible=false）:', pass(human.bgVisible===false && human.fillVisible===false));
console.log('  截圖: /tmp/second-bar-human-hidden.png（凡人頭上無二段條）');
await browser.close(); server.close();
console.log('DONE');
