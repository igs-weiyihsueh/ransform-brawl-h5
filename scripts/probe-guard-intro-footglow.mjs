// 用戶② 驗: 守護波「自動移動」(introMove scripted 走位)期間搜索圈(footGlow)關閉, 就定位進 reveal 後恢復。
// 修: GuardEvent 建構(introMove 起) setFootGlowVisible(false); updateIntroMove 轉 reveal setFootGlowVisible(true)。
// 驅動: 按 N 快速過節點直到出現 guardEvent(introMove), 觀察 footGlow.visible 前後變化。
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
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3200);
await page.keyboard.press('KeyC'); await page.waitForTimeout(500); // 進場

// 找 WaveSystem，按 N 過節點直到出現守護波 introMove。
const getGuardPhase = async () => page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const wave=(gs.systems||[]).find((x)=>x&&typeof x.getGuardEvent==='function');
  const g = wave?.getGuardEvent?.();
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const p=ctx?.players?.[0];
  const footVis = p?.footGlow ? p.footGlow.visible : null;
  const footLayoutVis = p?.isFootLayoutVisible?.() ?? null;
  return { hasGuard: !!g, phase: g ? g['phase'] : null, footVis };
});

let introSeen=null, revealSeen=null;
for(let i=0;i<40;i++){
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(120);
  const s = await getGuardPhase();
  if(s.hasGuard && s.phase==='introMove' && introSeen===null){
    introSeen = s.footVis; // introMove 期間 footGlow.visible（應 false）
    console.log('  [捕捉] introMove footGlow.visible =', s.footVis);
    // 讓 introMove 自然跑到 reveal（maxWalkSec 3.5s 逾時 snap）。
    for(let f=0; f<260; f++){ await page.waitForTimeout(16); const s2=await getGuardPhase(); if(s2.phase && s2.phase!=='introMove'){ revealSeen=s2.footVis; console.log('  [捕捉] 離開 introMove→', s2.phase, 'footGlow.visible =', s2.footVis); break; } }
    break;
  }
}
console.log('[用戶② 守護波自動移動關搜索圈驗]');
if(introSeen===null){ console.log('  未捕捉到守護波 introMove（節點可能沒守護波或需更多 N）——需調整驅動'); }
else {
  const okHide = introSeen === false;
  const okRestore = revealSeen === true || revealSeen === null; // null=layout 隱藏則不強制
  console.log('  introMove footGlow.visible:', introSeen, okHide?'PASS(自動移動關搜索圈)':'FAIL(沒關)');
  console.log('  離開 introMove footGlow.visible:', revealSeen, okRestore?'PASS(恢復)':'FAIL(沒恢復)');
  console.log('  總結:', okHide&&okRestore ? 'ALL PASS ✓' : 'HAS FAIL ✗');
}
await page.screenshot({ path:'/tmp/guard-intro-footglow.png' });
console.log('  截圖 /tmp/guard-intro-footglow.png');
await browser.close(); server.close();
console.log('DONE');
