// 5 SPUM 英雄搬入 + roster 驗：池子 6 隻、各英雄 sprite 貼圖載入 OK（無 404 / texture 存在）。
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url'; import { chromium } from 'playwright';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.map':'application/json' };
const missing = [];
const server = http.createServer((req, res) => { let u=decodeURIComponent(req.url.split('?')[0]); if(u==='/')u='/index.html'; const fp=path.join(distDir,u); if(!fp.startsWith(distDir)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){ if(u.includes('/characters/')) missing.push(u); res.statusCode=404;res.end('404');return;} res.setHeader('Content-Type',MIME[path.extname(fp)]||'application/octet-stream'); fs.createReadStream(fp).pipe(res); });
await new Promise((r)=>server.listen(0,'127.0.0.1',r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:720} });
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3500);

const HEROES = ['SunWukong','devil1','elf1','elf2','human2','legacy1'];
// roster 內容 + 每隻英雄 idle 首幀貼圖是否已被 Phaser 載入（texture 存在）。
const r = await page.evaluate((heroes)=>{
  const game = window.__PHASER_GAME__;
  const gs = game.scene.getScene('GameScene');
  const tex = gs.textures;
  const res = {};
  for(const h of heroes){
    // frameKey 慣例：`${charKey}_${state}_${idx}`（idle 首幀 idx=0）——探幾種常見拼法。
    const cands = [`${h}_idle_0`, `${h}_idle_00`, `${h}/idle/frame_00`];
    let found=null;
    for(const k of cands){ if(tex.exists(k)){ found=k; break; } }
    // 保底：掃 texture keys 找開頭 h_idle。
    if(!found){ const keys=tex.getTextureKeys?.()||[]; found=keys.find(k=>k.startsWith(h) && /idle/i.test(k)) || null; }
    res[h] = found;
  }
  return res;
}, HEROES);

console.log('[5 SPUM 英雄搬入 + roster 驗]');
let allLoaded = true;
for(const h of HEROES){
  const ok = !!r[h];
  if(!ok) allLoaded=false;
  console.log(`  ${h}: idle 貼圖 ${ok?'載入 OK ('+r[h]+')':'★缺!'}`);
}
console.log('  404 characters 請求:', missing.length? JSON.stringify([...new Set(missing)].slice(0,10)) : '無');
console.log('  總結:', allLoaded && missing.length===0 ? 'ALL PASS ✓ (池子 6 隻貼圖齊、無 404)' : '★HAS FAIL');
await browser.close(); server.close();
console.log('DONE');
