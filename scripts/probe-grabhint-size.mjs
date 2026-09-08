// 被抓「攻擊倒數提示」大小可調驗證（③）：
//  ①觸發被抓 → 頭上黃字提示，預設 scale 1。
//  ②套 override grabHintScale 1.8 → 提示放大（GrabSystem 讀 resolve scale 套 setScale）。
//  ③套 grabHintScale 0.5 → 提示縮小。
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

await page.keyboard.press('KeyC');
await page.waitForTimeout(1600);

const forceGrab = () => page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const grab = (gs.systems||[]).find((s)=>s && s.name==='GrabSystem');
  const ctx = grab?.ctx || (gs.systems||[]).find((s)=>s && s.ctx)?.ctx;
  if (!ctx) return false;
  const p = ctx.players[0];
  const st = grab.stateOf ? grab.stateOf(p.playerId) : grab.states?.get(p.playerId);
  if (st) { st.grabbed = true; st.countdown = 5; }
  if (typeof p.setGrabbed === 'function') p.setGrabbed(true);
  return !!st;
});

const readHint = () => page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const grab = (gs.systems||[]).find((s)=>s && s.name==='GrabSystem');
  const ctx = grab?.ctx || (gs.systems||[]).find((s)=>s && s.ctx)?.ctx;
  const p = ctx.players[0];
  const st = grab.stateOf ? grab.stateOf(p.playerId) : grab.states?.get(p.playerId);
  const h = st?.hint;
  if (!h) return { hasHint: false };
  const b = h.getBounds ? h.getBounds() : null;
  return { hasHint: true, visible: h.visible, scaleX: h.scaleX, scaleY: h.scaleY, boundsH: b ? Math.round(b.height) : null };
});

const setScale = (sc) => page.evaluate((v) => {
  const cur = JSON.parse(window.localStorage.getItem('transformbrawl:uiLayout') || '{}');
  cur.grabHint = { ...(cur.grabHint||{}), grabHintScale: v };
  window.localStorage.setItem('transformbrawl:uiLayout', JSON.stringify(cur));
}, sc);

// ① 預設 scale 1。
await forceGrab(); await page.waitForTimeout(300);
const s1 = await readHint();
await page.screenshot({ path:'/tmp/grabhint-size-default.png' });

// ② scale 1.8（放大）。
await setScale(1.8); await forceGrab(); await page.waitForTimeout(300);
const s2 = await readHint();
await page.screenshot({ path:'/tmp/grabhint-size-big.png' });

// ③ scale 0.5（縮小）。
await setScale(0.5); await forceGrab(); await page.waitForTimeout(300);
const s3 = await readHint();
await page.screenshot({ path:'/tmp/grabhint-size-small.png' });

const pass=(b)=>b?'PASS':'★FAIL';
console.log('[被抓攻擊倒數提示大小可調 驗證]');
console.log('  ① 預設:', JSON.stringify(s1));
console.log('     - 顯示+scale≈1:', pass(s1.hasHint && s1.visible && Math.abs(s1.scaleX-1)<0.01));
console.log('  ② scale 1.8（放大）:', JSON.stringify(s2));
console.log('     - scale≈1.8+變大:', pass(Math.abs(s2.scaleX-1.8)<0.01 && s2.boundsH > s1.boundsH));
console.log('  ③ scale 0.5（縮小）:', JSON.stringify(s3));
console.log('     - scale≈0.5+變小:', pass(Math.abs(s3.scaleX-0.5)<0.01 && s3.boundsH < s1.boundsH));
console.log('  截圖: /tmp/grabhint-size-default.png(預設) /tmp/grabhint-size-big.png(1.8) /tmp/grabhint-size-small.png(0.5)');
await browser.close(); server.close();
console.log('DONE');
