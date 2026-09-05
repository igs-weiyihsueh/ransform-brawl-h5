// 抓「敵人在玩家右側」的一張 move 截圖 + 一張 attack 截圖,交給視覺(異靈 subagent)肉眼判斷
// 到底 attack 美術朝向跟 move 一不一致。不做像素讀取(WebGL readback 不可靠)。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(1500);
for(let k=0;k<5;k++){ await page.keyboard.press('KeyR'); await page.waitForTimeout(150); }
// 找一隻在玩家右側、正在 attack 的敵人,截整場 + 標記牠。回傳牠的動畫/flipX/相對位置。
async function grab(kind){
  for(let i=0;i<250;i++){
    await page.waitForTimeout(50);
    const info = await page.evaluate((wantKind)=>{
      const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
      const p=gs.children.list.find((o)=>o.type==='Sprite'&&o.texture&&/Human|SunWukong/.test(o.texture.key||''));
      const px=p?p.x:0;
      const es=gs.children.list.filter((o)=>o.type==='Sprite'&&o.texture&&/Enemy_/.test(o.texture.key||''));
      // 要玩家右側的敵人(ex>px), 且動畫是 wantKind
      const hit=es.find((e)=>e.x>px+80 && new RegExp(wantKind,'i').test(e.anims&&e.anims.currentAnim?e.anims.currentAnim.key:''));
      if(!hit) return null;
      return { anim:hit.anims.currentAnim.key, flipX:!!hit.flipX, ex:Math.round(hit.x), ey:Math.round(hit.y), px:Math.round(px), py:Math.round(p.y) };
    }, kind);
    if(info) return info;
  }
  return null;
}
const mv = await grab('move');
console.log('MOVE 樣本(敵人在玩家右側):', JSON.stringify(mv));
if(mv) await page.screenshot({ path: path.join(__dirname,'..','probe-shot-facing-move.png') });
const at = await grab('attack');
console.log('ATTACK 樣本(敵人在玩家右側):', JSON.stringify(at));
if(at) await page.screenshot({ path: path.join(__dirname,'..','probe-shot-facing-attack.png') });
await browser.close(); server.close();
