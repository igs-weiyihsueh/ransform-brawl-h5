// 二段變身能量條(取代 4 格技能槽)驗證 + 魂力環還原：
//  ①預設：energy 區是「一條橫向能量條」(非 4 格)、魂力環未變身不顯。
//  ②一段悟空變身 → 魂力環還原(紫弧顯示，恢復原用途，沒被二段佔用)。
//  ③UI 驅動二段能量(模擬 flag 開)：橫條填充(charging 橘)、active(亮金)。
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

// 投幣進場 → 落地。
await page.keyboard.press('KeyC');
await page.waitForTimeout(1600);

// 一段悟空變身（TransformSystem 私有 transform）→ 讓真實迴圈跑 → 魂力環還原。
await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const ts = (gs.systems||[]).find((s)=>s && s.name==='TransformSystem');
  ts.transform(gs.ctx.players[0]);
});
await page.waitForTimeout(300);
const s1 = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const uisys = (gs.systems||[]).find((s)=>s && s.name==='UISystem');
  const oh = uisys.overheads[0];
  const seb = oh.secondEnergyBar;
  return {
    soulRingVisible: oh.soulRing ? oh.soulRing.visible : null,
    hasSecondEnergyBar: !!seb,
    barWidth: seb ? seb.width : null, // 橫條寬(config 82)
  };
});
await page.screenshot({ path:'/tmp/second-bar-restored.png' });

// UI 驅動二段能量 charging（monkey-patch，迴圈續跑實際 render）。
await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const uisys = (gs.systems||[]).find((s)=>s && s.name==='UISystem');
  const oh = uisys.overheads[0];
  const orig = oh.setSecondEnergy.bind(oh);
  window.__origSE = orig;
  oh.setSecondEnergy = () => orig(true, false, 0.6); // charging 60%
});
await page.waitForTimeout(300);
await page.screenshot({ path:'/tmp/second-bar-charging.png' });

await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const uisys = (gs.systems||[]).find((s)=>s && s.name==='UISystem');
  const oh = uisys.overheads[0];
  oh.setSecondEnergy = () => window.__origSE(true, true, 0.9); // active 90%
});
await page.waitForTimeout(300);
await page.screenshot({ path:'/tmp/second-bar-active.png' });

const pass=(b)=>b?'PASS':'★FAIL';
console.log('[二段能量條(取代4格)+魂力環還原 驗證]');
console.log('  ① 一段變身後:', JSON.stringify(s1));
console.log('     - 有 SecondEnergyBar 橫條(取代4格):', pass(s1.hasSecondEnergyBar===true), '/ 條寬=82:', pass(s1.barWidth===82));
console.log('     - 魂力環還原(變身後顯示):', pass(s1.soulRingVisible===true));
console.log('  截圖: /tmp/second-bar-restored.png(魂力環紫+能量條空) /tmp/second-bar-charging.png(橘條60%) /tmp/second-bar-active.png(亮金90%)');
await browser.close(); server.close();
console.log('DONE');
