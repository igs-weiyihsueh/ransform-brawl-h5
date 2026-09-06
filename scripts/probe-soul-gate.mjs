// #1 驗: 變身前不顯魂力環、變身後才顯。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(1200); // 進場(未變身)
const ready = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  window.__ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx; return !!window.__ctx;
});
// 找魂力環底圖(ui-ring) + soulRing graphics 的 visible。魂力環在 overhead 容器內。
function ringState(){ return page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  let ringImgVisible=null, hasRingImg=false;
  const walk=(l)=>l.forEach((o)=>{ if(o.texture&&o.texture.key==='ui-ring'){ hasRingImg=true; ringImgVisible=o.visible; } if(o.list) walk(o.list); });
  walk(gs.children.list);
  const t=window.__ctx.transform;
  return { transformed: t.isTransformed(0), hasRingImg, ringImgVisible };
});}
const before = await ringState();
console.log('[變身前]', JSON.stringify(before), '→ 魂力環隱藏?', before.hasRingImg && before.ringImgVisible===false ? 'PASS(未變身不顯)' : (before.transformed?'注意:已變身':'FAIL 仍顯示'));
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-soul-before.png') });
// 強制變身(直接改 transform 狀態)。
await page.evaluate(()=>{
  const t=window.__ctx.transform;
  // 找變身 API：多半 startTransform/setTransformed;沒有就直接改 stateOf。
  if(typeof t.forceTransform==='function') t.forceTransform(0);
  else { const s=t.states&&t.states.get(0); if(s){ s.transformed=true; s.soul=1; } else if(t.states){ t.states.set(0,{transformed:true,soul:1}); } }
});
await page.waitForTimeout(400);
const after = await ringState();
console.log('[變身後]', JSON.stringify(after), '→ 魂力環顯示?', after.transformed && after.ringImgVisible===true ? 'PASS(變身後才顯)' : `注意 (transformed=${after.transformed} ringVisible=${after.ringImgVisible})`);
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-soul-after.png') });
await browser.close(); server.close();
console.log('DONE');
