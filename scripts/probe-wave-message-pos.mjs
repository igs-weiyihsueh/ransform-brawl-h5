// #5 驗: 波次訊息顯在 layout.screen.waveMessage 位置(x640/y180/w640/h90 center → 中心~960,225)。
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
await page.waitForTimeout(3800); // 開場第一波宣告會出現
const ready = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  window.__ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx; return !!window.__ctx;
});
// 直接觸發波次訊息(避免等波序)。
await page.evaluate(()=>{ window.__ctx.effects.waveMessage('第 1 波'); });
await page.waitForTimeout(300);
const info = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  // 讀 layout.screen.waveMessage(從 cache)。
  const raw=gs.cache.json.get('ui-layout');
  const el = raw&&raw.screen?raw.screen.waveMessage:null;
  // 找波次訊息文字物件。
  let txt=null;
  gs.children.list.forEach((o)=>{ if(o.type==='Text'&&/波/.test(o.text||'')){ txt={x:Math.round(o.x),y:Math.round(o.y),originX:o.originX,text:o.text}; } });
  return { layoutEl: el, txt };
});
console.log('[#5 驗] layout.screen.waveMessage=', JSON.stringify(info.layoutEl));
console.log('  波次訊息文字物件=', JSON.stringify(info.txt));
// center align: 文字 x 應 = el.x + el.width/2 = 640+320=960; y = el.y+el.height/2 = 180+45=225。
const el=info.layoutEl, t=info.txt;
const okX = el && t && Math.abs(t.x - (el.x+el.width/2)) < 3;
const okY = el && t && Math.abs(t.y - (el.y+el.height/2)) < 3;
console.log('  文字位置對齊 layout(center)?', okX&&okY ? `PASS (x=${t.x}≈${el.x+el.width/2}, y=${t.y}≈${el.y+el.height/2})` : `注意 ${JSON.stringify({t,expX:el?el.x+el.width/2:'?',expY:el?el.y+el.height/2:'?'})}`);
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-wavemsg.png') });
await browser.close(); server.close();
console.log('DONE');
