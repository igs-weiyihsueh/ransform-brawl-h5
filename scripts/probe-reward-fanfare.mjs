// #3 驗: 獎勵報獎演出 — 「恭喜獲獎」banner + 飛光 + 到達點亮 JP 燈。
// 直接呼 effects.rewardFanfare(觸發 onReward=jp.lightNextReward), 觀察 banner 文字出現 + JP 燈數增加。
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
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3800);
await page.keyboard.press('KeyC'); await page.waitForTimeout(800);
// 取 ctx。記錄 JP 三組燈總數 before。
const ready = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const sys=(gs.systems||[]).find((x)=>x&&x.ctx&&x.ctx.effects&&x.ctx.jp&&x.ctx.wave);
  window.__ctx=sys?sys.ctx:null; return !!window.__ctx;
});
const before = await page.evaluate(()=>{ const j=window.__ctx.jp; return j.getLights('red')+j.getLights('blue')+j.getLights('purple'); });
console.log('ctx 可達?', ready, '| JP 燈總數 before =', before);
// 觸發報獎演出(等同進 Reward 節點的 onReward)。
await page.evaluate(()=>{
  const ctx=window.__ctx;
  ctx.effects.rewardFanfare(640, 120, ()=> ctx.jp.lightNextReward());
});
// banner 出現期(浮現後)截圖 + 檢查文字。
await page.waitForTimeout(600);
const bannerSeen = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  let found=false; const walk=(l)=>l.forEach((o)=>{ if(o.type==='Text'&&/恭喜獲獎/.test(o.text||'')) found=true; if(o.list) walk(o.list); }); walk(gs.children.list); return found;
});
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-reward.png') });
// 等演出跑完(banner 3s + 退出 + 飛光 0.7s ≈ 4.5s)後看 JP 燈是否 +1。
await page.waitForTimeout(4200);
const after = await page.evaluate(()=>{ const j=window.__ctx.jp; return j.getLights('red')+j.getLights('blue')+j.getLights('purple'); });
console.log('[#3 驗] 恭喜獲獎 banner 出現=', bannerSeen, ' | JP 燈總數 after =', after, ' (before', before, ')');
console.log('  banner:', bannerSeen?'PASS':'FAIL', '| 飛光到達點亮 JP 燈(+1):', after===before+1?'PASS':`注意 (${before}→${after})`);
await browser.close(); server.close();
console.log('DONE');
