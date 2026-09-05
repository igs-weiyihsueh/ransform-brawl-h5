// 推怪負重驗: 投幣進場→被多怪包圍→移動時 pushLoadMult<1(推越多越慢)。量玩家位移速度。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(1500); // 投幣進場
// 讀玩家 + GrabSystem ctx 算 computePushLoad 效果: 直接讀 player 位移 + 場上敵人數。
async function measure(){
  return page.evaluate(async ()=>{
    const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    const p=gs.children.list.find((o)=>o.type==='Sprite'&&o.texture&&/Human|SunWukong/.test(o.texture.key||''));
    const enemies=gs.children.list.filter((o)=>o.type==='Sprite'&&o.texture&&/Enemy_/.test(o.texture.key||''));
    return { x:p?p.x:0, y:p?p.y:0, enemyCount:enemies.length };
  });
}
// 情境A: 無怪, 往右移一段量位移。
let a0=await measure();
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(500); await page.keyboard.up('ArrowRight');
let a1=await measure();
const distNoEnemy=Math.hypot(a1.x-a0.x,a1.y-a0.y);
console.log('[負重驗] 無怪(', a0.enemyCount, ')移動0.5s位移=', Math.round(distNoEnemy));
// 情境B: 補一堆怪包圍, 再往左移量位移。
for(let k=0;k<8;k++){ await page.keyboard.press('KeyR'); await page.waitForTimeout(120); }
await page.waitForTimeout(1500); // 讓怪圍過來
let b0=await measure();
await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(500); await page.keyboard.up('ArrowLeft');
let b1=await measure();
const distManyEnemy=Math.hypot(b1.x-b0.x,b1.y-b0.y);
console.log('[負重驗] 多怪(', b1.enemyCount, ')移動0.5s位移=', Math.round(distManyEnemy));
console.log('[負重驗] 多怪比無怪慢?', distManyEnemy < distNoEnemy ? 'PASS 推越多越慢' : 'FAIL', `(${Math.round(distNoEnemy)}→${Math.round(distManyEnemy)})`);
await browser.close(); server.close();
