// 衝刺圖示進場 gate 驗證（用戶指定）：衝刺「衝」圖示要角色登場動畫完成後才顯示。
// 驗三時機：①待機中(投幣前) 隱藏 ②進場動畫中 隱藏 ③登場完成(落地) 顯示。
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
await page.waitForTimeout(3000);

// 讀 P1 欄衝刺圖示可見狀態（BottomPanel 私有 slots[0]，JS 可讀）。
const readDash = () => page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const uisys = (gs.systems||[]).find((s)=>s && s.name==='UISystem');
  const p = gs.ctx.players[0];
  const bp = uisys?.bottomPanel;
  const slot = bp?.slots?.[0];
  return {
    waiting: p.isWaiting ? p.isWaiting() : null,
    entering: p.isEntering ? p.isEntering() : null,
    dashVisibleFlag: slot ? slot.dashVisible : null,
    dashBaseVisible: slot?.dashBase ? slot.dashBase.visible : null,
    dashLabelVisible: slot?.dashLabel ? slot.dashLabel.visible : null,
  };
});

// ① 待機中（投幣前）。
const s1 = await readDash();
await page.screenshot({ path:'/tmp/dash-gate-1-waiting.png' });

// 投幣進場（KeyC）→ 進場動畫約 0.6s。
await page.keyboard.press('KeyC');
await page.waitForTimeout(250); // ② 進場動畫中（拋物線飛行）
const s2 = await readDash();
await page.screenshot({ path:'/tmp/dash-gate-2-entering.png' });

await page.waitForTimeout(1200); // ③ 登場完成（落地後）
const s3 = await readDash();
await page.screenshot({ path:'/tmp/dash-gate-3-landed.png' });

const pass = (b) => b ? 'PASS' : '★FAIL';
console.log('[衝刺圖示進場 gate 驗證]');
console.log('  ① 待機中 :', JSON.stringify(s1), pass(s1.dashVisibleFlag === false && s1.dashBaseVisible === false), '(應隱藏)');
console.log('  ② 進場中 :', JSON.stringify(s2), pass(s2.dashVisibleFlag === false && s2.dashBaseVisible === false), '(應隱藏)');
console.log('  ③ 落地後 :', JSON.stringify(s3), pass(s3.dashVisibleFlag === true && s3.dashBaseVisible === true), '(應顯示)');
console.log('  截圖: /tmp/dash-gate-1-waiting.png /tmp/dash-gate-2-entering.png /tmp/dash-gate-3-landed.png');
await browser.close(); server.close();
console.log('DONE');
