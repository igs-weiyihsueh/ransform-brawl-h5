// 敵人背對攻擊 回歸診斷 — 建立「已知正確」基準:量 move 朝右/朝左 flipX,再比 attack 出手 flipX。
// 關鍵:不再用 facing sign 自證,直接量 sprite.flipX + 敵人相對玩家左右 + 動畫 key。
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
for(let k=0;k<4;k++){ await page.keyboard.press('KeyR'); await page.waitForTimeout(150); }

// 取樣:每幀讀所有敵人 {anim, flipX, ex, sideVsPlayer(敵人在玩家左=L/右=R), facing(內部)}。
function sample(){ return page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const p=gs.children.list.find((o)=>o.type==='Sprite'&&o.texture&&/Human|SunWukong/.test(o.texture.key||''));
  const px=p?p.x:0;
  const es=gs.children.list.filter((o)=>o.type==='Sprite'&&o.texture&&/Enemy_/.test(o.texture.key||''));
  return es.map((e)=>({
    anim: e.anims&&e.anims.currentAnim?e.anims.currentAnim.key:'',
    flipX: !!e.flipX,
    ex: Math.round(e.x),
    px: Math.round(px),
    // 敵人相對玩家:敵人在玩家右邊(ex>px)→敵人要朝左(往玩家)才對;敵人在玩家左(ex<px)→敵人朝右才對。
    enemyRightOfPlayer: e.x > px,
  }));
});}

// 收集 move 樣本 + attack 樣本(分左右)。
const moveR=[], moveL=[], atkR=[], atkL=[]; // R=敵人在玩家右側, L=左側
for(let i=0;i<200;i++){
  await page.waitForTimeout(60);
  const arr = await sample();
  for(const s of arr){
    if(/move/i.test(s.anim)){ (s.enemyRightOfPlayer?moveR:moveL).push(s.flipX); }
    if(/attack/i.test(s.anim)){ (s.enemyRightOfPlayer?atkR:atkL).push(s.flipX); }
  }
  if(atkR.length>15 && atkL.length>15 && moveR.length>15 && moveL.length>15) break;
}
const pct=(a)=>a.length?Math.round(a.filter(Boolean).length/a.length*100):null; // %flipX=true
console.log('=== 已知正確基準:MOVE(走路面向移動方向=面向玩家) ===');
console.log('敵人在玩家右側 move: n=',moveR.length,' flipX=true 佔',pct(moveR),'%  → 這是「朝左(往玩家)」的正確 flipX');
console.log('敵人在玩家左側 move: n=',moveL.length,' flipX=true 佔',pct(moveL),'%  → 這是「朝右(往玩家)」的正確 flipX');
console.log('=== 對照:ATTACK 出手 ===');
console.log('敵人在玩家右側 attack: n=',atkR.length,' flipX=true 佔',pct(atkR),'%');
console.log('敵人在玩家左側 attack: n=',atkL.length,' flipX=true 佔',pct(atkL),'%');
console.log('=== 判定 ===');
console.log('右側:attack flipX 與 move 一致?', pct(atkR)!==null&&pct(moveR)!==null ? (Math.abs(pct(atkR)-pct(moveR))<50?'一致=面向':'相反=背對!') : 'n/a');
console.log('左側:attack flipX 與 move 一致?', pct(atkL)!==null&&pct(moveL)!==null ? (Math.abs(pct(atkL)-pct(moveL))<50?'一致=面向':'相反=背對!') : 'n/a');
await browser.close(); server.close();
