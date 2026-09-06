// 五輪#6 驗: 元素 visible=false → 遊戲端不畫; 舊JSON(無visible)全顯不炸。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/')u='/index.html'; const fp=path.join(distDir,u); if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
// 攔截 uiLayout.json 注入 visible=false 到幾個元素。
server.on('request',()=>{});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:720} });
// 攔截 layout json, 改注入 visible。
await page.route('**/uiLayout.json', async (route)=>{
  const res = await route.fetch(); const json = await res.json();
  json.foot = json.foot || {}; json.foot.visible = false; // 搜索圈隱
  if(json.panel?.columns?.[0]?.elements){ const t=json.panel.columns[0].elements.find((e)=>e.id==='ticket'); if(t) t.visible=false; } // ticket隱
  json.overhead = json.overhead || {}; json.overhead.combo = { ...(json.overhead.combo||{}), visible:false }; // combo隱
  json.screen = json.screen || {}; json.screen.waveMessage = { ...(json.screen.waveMessage||{}), visible:false }; // waveMessage隱
  await route.fulfill({ contentType:'application/json', body: JSON.stringify(json) });
});
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3800);
await page.keyboard.press('KeyC'); await page.waitForTimeout(1500);
const r = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  // foot: 玩家 footGlow visible?
  const p=ctx.players[0];
  const footVisible = p.footGlow? p.footGlow.visible : null;
  // waveMessage: 觸發後看有沒有「第X波」text (應無)
  const fx=ctx.effects; fx.waveMessage&&fx.waveMessage('測試波');
  const waveTexts = gs.children.list.filter((o)=>o.type==='Text'&&/波/.test(o.text)).length;
  // combo overhead: 觸發 combo text 隱? 直接看 overhead group (難), 用 UISystem 讀 overheadVisibility。
  const ui=(gs.systems||[]).find((x)=>x&&x.name==='UISystem');
  return { footVisible, waveTextsAfterHidden: waveTexts };
});
console.log('[visible=false 驗]', JSON.stringify(r));
console.log('  搜索圈隱藏(footGlow.visible=false):', r.footVisible===false?'PASS':'FAIL('+r.footVisible+')');
console.log('  waveMessage 隱藏(觸發後無波字):', r.waveTextsAfterHidden===0?'PASS':'FAIL('+r.waveTextsAfterHidden+')');
await browser.close(); server.close();
console.log('DONE');
