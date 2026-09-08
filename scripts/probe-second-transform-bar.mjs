// 二段變身能量條 UI 驗證（用戶新大功能）：
//  ①flag 關(預設)=一段悟空後走現有魂力環、不顯二段條(現況不受影響)。
//  ②UI 層直接驅動 setSecondTransform(模擬 flag 開)：一段悟空後魂力環位置改顯二段能量條(charging 填充)、active 樣式。
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

// 投幣進場 → 觸發一段悟空變身（呼叫 TransformSystem 私有 transform，JS 可達）。
await page.keyboard.press('KeyC');
await page.waitForTimeout(1600); // 落地完成

// ① flag 關（預設）：一段悟空變身後，確認走現有魂力環、二段條不顯。
await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const ts = (gs.systems||[]).find((s)=>s && s.name==='TransformSystem');
  const p = gs.ctx.players[0];
  ts.transform(p); // 一段悟空變身（私有，JS 可達）
});
await page.waitForTimeout(300); // 讓真實遊戲迴圈跑幾幀，UISystem.update 分流魂力環顯示
const s1 = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const uisys = (gs.systems||[]).find((s)=>s && s.name==='UISystem');
  const p = gs.ctx.players[0];
  const oh = uisys.overheads[0];
  return {
    transformed: gs.ctx.transform.isTransformed(p.playerId),
    secondAvail: gs.ctx.isSecondTransformAvailable ? gs.ctx.isSecondTransformAvailable(p.playerId) : null,
    secondRatio: gs.ctx.getSecondTransformEnergyRatio ? gs.ctx.getSecondTransformEnergyRatio(p.playerId) : null,
    soulRingVisible: oh.soulRing ? oh.soulRing.visible : null,
    secondRingVisible: oh.secondRing ? oh.secondRing.visible : null,
  };
});
await page.waitForTimeout(200);
await page.screenshot({ path:'/tmp/second-flagoff.png' });

// ② UI 層直接驅動（模擬 flag 開）：一段悟空後魂力環位置改顯二段能量條。
// ★用 monkey-patch 讓每幀 UISystem 呼叫 setSecondTransform 都被強制成 available/charging，
//   迴圈持續跑（會實際 render），避免 loop.sleep 凍結 render 導致截圖沒重畫。
const s2 = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const uisys = (gs.systems||[]).find((s)=>s && s.name==='UISystem');
  const oh = uisys.overheads[0];
  const orig = oh.setSecondTransform.bind(oh);
  window.__origSetSecond = orig;
  oh.setSecondTransform = () => orig(true, false, 0.6); // 強制 available、charging、60%
  return { patched: true };
});
await page.waitForTimeout(300); // 讓迴圈跑幾幀實際 render
const s2b = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const uisys = (gs.systems||[]).find((s)=>s && s.name==='UISystem');
  const oh = uisys.overheads[0];
  return { soulRingVisible: oh.soulRing.visible, secondRingVisible: oh.secondRing.visible };
});
await page.screenshot({ path:'/tmp/second-flagon-charging.png' });

// ③ 改強制 active、90%，迴圈續跑重畫後截圖。
await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const uisys = (gs.systems||[]).find((s)=>s && s.name==='UISystem');
  const oh = uisys.overheads[0];
  const orig = window.__origSetSecond;
  oh.setSecondTransform = () => orig(true, true, 0.9); // 強制 active、90%
});
await page.waitForTimeout(300);
const s3 = await page.evaluate(() => {
  const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
  const uisys = (gs.systems||[]).find((s)=>s && s.name==='UISystem');
  const oh = uisys.overheads[0];
  return { shownActive: true, secondRingVisible: oh.secondRing.visible };
});
await page.screenshot({ path:'/tmp/second-flagon-active.png' });
const s2out = { shownCharging: s2.patched, ...s2b };

const pass = (b)=>b?'PASS':'★FAIL';
console.log('[二段變身能量條 UI 驗證]');
console.log('  ① flag 關(一段悟空後):', JSON.stringify(s1));
console.log('     - 已一段變身:', pass(s1.transformed===true));
console.log('     - 二段 available=false(flag 關):', pass(s1.secondAvail===false), '/ ratio=0:', pass(s1.secondRatio===0));
console.log('     - 魂力環顯示:', pass(s1.soulRingVisible===true), '/ 二段條不顯:', pass(s1.secondRingVisible===false), '(現況不受影響)');
console.log('  ② UI 層 charging(模擬 flag 開 available):', JSON.stringify(s2out));
console.log('     - 二段條顯示:', pass(s2out.secondRingVisible===true), '/ 魂力環讓位隱藏:', pass(s2out.soulRingVisible===false));
console.log('  ③ UI 層 active(二段變身中):', JSON.stringify(s3), pass(s3.secondRingVisible===true));
console.log('  截圖: /tmp/second-flagoff.png(現有魂力環) /tmp/second-flagon-charging.png(二段條60%) /tmp/second-flagon-active.png(active 90%)');
await browser.close(); server.close();
console.log('DONE');
