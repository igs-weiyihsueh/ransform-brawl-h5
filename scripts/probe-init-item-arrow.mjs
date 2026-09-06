// #9 乙驗證：初始道具進場不被秒撿(存活>1.5s)、箭頭跳過距離gate顯示、3s淡出、道具在吸取+撿取範圍外。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json'};
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);if(u==='/')u='/index.html';const fp=path.join(distDir,u);if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream');fs.createReadStream(fp).pipe(res);});
await new Promise((r)=>server.listen(0,'127.0.0.1',r)); const port=server.address().port;
const browser=await chromium.launch(); const page=await browser.newPage({viewport:{width:1280,height:720}});
page.on('pageerror',(e)=>console.log('  [pageerror]',String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3000);
// 直接驅動：呼叫 TransformSystem.spawnItem('initial') 在玩家旁（驗機制：免疫+gate跳過+位置）。
await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  if (!gs || !gs.ctx || !gs.ctx.players?.[0]) return;
  const p = gs.ctx.players[0];
  const ts = (gs.systems||[]).find((x)=>x && x.name==='TransformSystem');
  if (!ts) return;
  const op = p.getPosition();
  const vacR = p.getVacuumRadius?.() ?? 50;
  const offset = Math.max(180, Math.round(vacR + 80 + 60));
  ts.spawnItem('initial', p.playerId, { x: op.x, y: op.y - offset });
});

// 高頻輪詢初始道具存活 + 距離 + gate 狀態（玩家不動，觀察箭頭是否顯示滿 3s）。
let timeline = [];
const t0 = Date.now();
for (let i = 0; i < 60; i += 1) {
  await page.waitForTimeout(200);
  const s = await page.evaluate(() => {
    const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
    const ctx = gs.ctx; if (!ctx || !ctx.players?.[0]) return null;
    const PPU = 100;
    const p = ctx.players[0];
    const ts = (gs.systems||[]).find((x)=>x && x.name==='TransformSystem');
    const items = ts?.items ?? [];
    const initial = items.find((it)=>it.source==='initial');
    if (!initial) return { hasInitial: false, count: items.length };
    const op = p.getPosition(); const ip = initial.getPosition();
    const du = Math.hypot(ip.x-op.x, ip.y-op.y)/PPU;
    const vacR = (p.getVacuumRadius?.() ?? 50)/PPU;
    return { hasInitial: true, distU: +du.toFixed(2), distPx: Math.round(du*PPU), vacRadiusU: +vacR.toFixed(2), inVacuum: du < vacR, wouldGateHide: du < 1.5 };
  });
  if (s) timeline.push({ t: ((Date.now()-t0)/1000).toFixed(1), ...s });
  if (timeline.length > 3 && timeline.slice(-4).every((x)=>!x.hasInitial)) break;
}
const withInitial = timeline.filter((x)=>x.hasInitial);
console.log('[#9 乙驗證] 初始道具引導去撿');
if (withInitial.length === 0) { console.log('  ⚠️ 沒捕捉到初始道具（可能未觸發進場）'); }
else {
  const first = withInitial[0], last = withInitial[withInitial.length-1];
  const survivedSec = (+last.t) - (+first.t);
  console.log(`  初始道具首見 t=${first.t}s dist=${first.distPx}px(${first.distU}u) 真空半徑=${first.vacRadiusU}u`);
  console.log(`  在真空範圍內? ${first.inVacuum ? '★是(會被吸)' : '否(在吸取範圍外✓)'}`);
  console.log(`  距離 <1.5u 會被舊 gate 吃? ${first.wouldGateHide ? '是(但初始道具已跳過 gate✓)' : '否(>150px)'}`);
  console.log(`  初始道具存活時長 ≈ ${survivedSec.toFixed(1)}s (免疫 1.5s + 箭頭 3s showDuration 期間玩家不動不被撿)`);
  console.log(`  存活 >1.5s(不被秒撿)? ${survivedSec >= 1.5 ? 'PASS' : 'FAIL='+survivedSec}`);
}
await page.screenshot({ path: '/tmp/init-item-arrow.png' });
// 驗證③：玩家走近初始道具(<150px, 舊 gate 會吃)時，箭頭仍畫(arrowElapsed 有推進=沒被 gate continue)。
const gateCheck = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const p = gs.ctx.players[0];
  const ts = (gs.systems||[]).find((x)=>x && x.name==='TransformSystem');
  // 清掉現有道具 + 佇列，只留一個「近距(100px<150 gate)」初始道具，確保它是 guide target。
  for (const it of [...ts.items]) it.destroy?.();
  ts.items = [];
  if (ts.ownerQueues && typeof ts.ownerQueues.clear === 'function') ts.ownerQueues.clear();
  const op = p.getPosition();
  ts.spawnItem('initial', p.playerId, { x: op.x + 100, y: op.y }); // 100px < 150 gate
  return { ok: true };
});
await page.waitForTimeout(500);
const gate = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const ts = (gs.systems||[]).find((x)=>x && x.name==='TransformSystem');
  const items = ts.items ?? [];
  const near = items.find((it)=>it.source==='initial');
  if (!near) return { found: false };
  const ae = ts.arrowElapsed;
  // arrowElapsed 是 Map<id, sec>；near.id 有記錄且 >0 = 箭頭有畫(近距也沒被 gate 吃)。
  const elapsed = ae && typeof ae.get === 'function' ? ae.get(near.id) : undefined;
  const p = gs.ctx.players[0]; const op = p.getPosition(); const ip = near.getPosition();
  const distPx = Math.round(Math.hypot(ip.x-op.x, ip.y-op.y));
  return { found: true, distPx, elapsed: elapsed !== undefined ? +elapsed.toFixed(2) : null };
});
if (gate.found) {
  console.log(`  ③近距 gate 跳過: 初始道具 dist=${gate.distPx}px(<150), arrowElapsed=${gate.elapsed} → ${gate.elapsed !== null && gate.elapsed > 0 ? 'PASS(近距箭頭仍畫,沒被距離 gate 吃)' : 'FAIL(箭頭沒畫)'}`);
}
await browser.close(); server.close();
console.log('DONE');
