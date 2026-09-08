// 被抓「攻擊倒數提示」位置可調驗證：
//  ①觸發被抓 → 頭上冒黃字「按攻擊掙脫！+倒數」，預設位置 = 玩家中心 +(0,-90)。
//  ②套 editorStore override（layout.grabHint offset）→ 提示位置即時平移（GrabSystem 讀 resolve offset）。
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

// 投幣進場落地。
await page.keyboard.press('KeyC');
await page.waitForTimeout(1600);

// 強制被抓狀態（直接設 GrabSystem state，讓 updateGrabbed 渲染提示；純觸發顯示，不改抓人邏輯）。
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
await forceGrab();
await page.waitForTimeout(300); // 讓迴圈跑 updateGrabbed 建立/定位提示

// ① 讀提示現況（相對玩家中心的偏移）。
const readHint = () => page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const grab = (gs.systems||[]).find((s)=>s && s.name==='GrabSystem');
  const ctx = grab?.ctx || (gs.systems||[]).find((s)=>s && s.ctx)?.ctx;
  const p = ctx.players[0];
  const st = grab.stateOf ? grab.stateOf(p.playerId) : grab.states?.get(p.playerId);
  const h = st?.hint;
  const pc = p.getHitCenter();
  if (!h) return { hasHint: false };
  return {
    hasHint: true, visible: h.visible, text: h.text,
    dx: Math.round(h.x - pc.x), dy: Math.round(h.y - pc.y),
  };
});
const s1 = await readHint();
await page.screenshot({ path:'/tmp/grabhint-default.png' });

// ② 套 override：往右下平移 (offsetX +60, offsetY +40) → 期望 dx≈60, dy≈-50（-90+40）。
await page.evaluate(() => {
  const cur = JSON.parse(window.localStorage.getItem('transformbrawl:uiLayout') || '{}');
  cur.grabHint = { grabHintOffsetX: 60, grabHintOffsetY: 40 };
  window.localStorage.setItem('transformbrawl:uiLayout', JSON.stringify(cur));
});
await forceGrab();
await page.waitForTimeout(300); // GrabSystem 每幀讀 override → 提示平移
const s2 = await readHint();
await page.screenshot({ path:'/tmp/grabhint-moved.png' });

const pass=(b)=>b?'PASS':'★FAIL';
console.log('[被抓攻擊倒數提示位置可調 驗證]');
console.log('  ① 預設:', JSON.stringify(s1));
console.log('     - 提示顯示+文字含掙脫:', pass(s1.hasHint && s1.visible && /掙脫/.test(s1.text||'')));
console.log('     - 預設偏移 dx≈0,dy≈-90:', pass(Math.abs(s1.dx)<=2 && Math.abs(s1.dy+90)<=2));
console.log('  ② 套 override(+60,+40):', JSON.stringify(s2));
console.log('     - 提示平移 dx≈60,dy≈-50:', pass(Math.abs(s2.dx-60)<=2 && Math.abs(s2.dy+50)<=2));
console.log('  截圖: /tmp/grabhint-default.png(預設頭頂) /tmp/grabhint-moved.png(平移後)');
await browser.close(); server.close();
console.log('DONE');
