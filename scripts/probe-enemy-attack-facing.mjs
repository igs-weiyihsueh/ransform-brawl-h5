// 新#2 驗: 敵人出手時面向玩家(視覺 flipX 對應玩家側)——不背對。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const fp = path.join(distDir, u);
  if (!fp.startsWith(distDir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.statusCode=404; res.end('404'); return; }
  res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:720} });
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3800);
for (let k=0;k<4;k++){ await page.keyboard.press('KeyR'); await page.waitForTimeout(150); }
// 移動玩家繞行，多抓攻擊幀，檢查 flipX 是否對應玩家側(art朝右, flipX=true=朝左)。
const results=[];
for (let i=0;i<70;i++){
  await page.waitForTimeout(110);
  if(i%10===0){ await page.keyboard.press(i%20===0?'ArrowLeft':'ArrowRight'); }
  const s = await page.evaluate(()=>{
    const gs = window.__PHASER_GAME__.scene.getScene('GameScene');
    const player = gs.children.list.find((o)=>o.type==='Sprite'&&o.texture&&/Human|SunWukong/.test(o.texture.key||''));
    const enemies = gs.children.list.filter((o)=>o.type==='Sprite'&&o.texture&&/Enemy_/.test(o.texture.key||''));
    if(!player) return [];
    const out=[];
    for(const e of enemies){
      const anim = e.anims&&e.anims.currentAnim?e.anims.currentAnim.key:'';
      if(/attack/i.test(anim)){
        const playerLeft = player.x < e.x;
        // art 朝右; flipX=true→朝左. 面向玩家: 玩家左→應 flipX true; 玩家右→應 flipX false.
        const facesPlayer = playerLeft ? e.flipX===true : e.flipX===false;
        out.push({ playerLeft, flipX:e.flipX, facesPlayer, dx:Math.round(player.x-e.x) });
      }
    }
    return out;
  });
  results.push(...s);
  if(results.length>=8) break;
}
const total=results.length;
const facing=results.filter((r)=>r.facesPlayer).length;
console.log('[新#2 驗] 攻擊幀', total, '中面向玩家', facing, '筆');
for(const r of results.slice(0,8)) console.log('  ', JSON.stringify(r));
await browser.close(); server.close();
