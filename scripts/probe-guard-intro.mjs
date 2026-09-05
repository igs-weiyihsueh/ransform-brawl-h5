// #4 驗: 守護波開場序列 — 鎖操作+導引走位+限時事件大字+雕像顯現+聚焦壓暗。
// 直接把 WaveSystem 跳到一個只有 Guard Event 節點的關卡 → 觸發 GuardEvent 開場。
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
await page.keyboard.press('KeyC'); await page.waitForTimeout(1500); // 進場
const ready = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const sys=(gs.systems||[]).find((x)=>x&&x.ctx&&x.ctx.wave&&x.ctx.effects);
  window.__ctx=sys?sys.ctx:null;
  // 找 WaveSystem 實例。
  window.__wave=(gs.systems||[]).find((x)=>x&&x.name==='WaveSystem');
  return !!window.__ctx && !!window.__wave;
});
console.log('ctx+wave 可達?', ready);
// 記玩家開場位置。
const p0 = await page.evaluate(()=>{ const p=window.__ctx.players[0]; const q=p.getPosition(); return {x:Math.round(q.x),y:Math.round(q.y)}; });
// 把 wave 跳到只有 Guard Event 的關卡。
await page.evaluate(()=>{
  const w=window.__wave;
  w.levels=[{ id:'T', name:'T', nodes:[{ nodeType:'Event', eventPresetName:'Guard60' }] }];
  w.levelIndex=0;
  w.enterNode(0); // 進 Event 節點
});
// 進 Event 節點後, WaveSystem.update 會建 GuardEvent → 開場。等幾幀讓 update 觸發。
await page.waitForTimeout(400);
// 觀察: scriptedControl 鎖定 + 限時事件大字 + 玩家開始朝中央移動。
const early = await page.evaluate(()=>{
  const ctx=window.__ctx; const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  let bigText=false; const walk=(l)=>l.forEach((o)=>{ if(o.type==='Text'&&/限時事件/.test(o.text||'')) bigText=true; if(o.list) walk(o.list); }); walk(gs.children.list);
  const p=ctx.players[0].getPosition();
  return { scriptedControl: ctx.scriptedControl, bigText, px:Math.round(p.x), py:Math.round(p.y) };
});
console.log('[開場早期] 鎖操作 scriptedControl=', early.scriptedControl, ' 限時事件大字=', early.bigText, ' 玩家位置=',early.px,early.py,'(開場',p0.x,p0.y,')');
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-guard-intro.png') });
// 抓聚焦壓暗那一刻: 走位到位(~2s)後 reveal(0.45)→focus(1.6)。輪詢等 scriptedControl 仍 true 但雕像已顯 = focus 期, 截圖。
let focusShot=false;
for(let i=0;i<60;i++){ // 最多 6s
  await page.waitForTimeout(100);
  const s = await page.evaluate(()=>{
    const ctx=window.__ctx; const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
    let statueVisible=false, dimOverlay=false;
    gs.children.list.forEach((o)=>{ if(o.type==='Container'&&o.visible&&o.list){ o.list.forEach((c)=>{ if(c.texture&&/statue/.test(c.texture.key||'')) statueVisible=true; }); } });
    // 全螢幕壓暗遮罩: 一個很大的 Graphics(覆蓋全螢幕)。
    gs.children.list.forEach((o)=>{ if((o.type==='Graphics'||o.type==='Image'||o.type==='Rectangle')&&o.depth>=955) dimOverlay=true; });
    return { sc: ctx.scriptedControl, statueVisible, dimOverlay };
  });
  // 聚焦期 = 雕像已顯 + 壓暗遮罩在場。
  if(s.statueVisible && s.dimOverlay && !focusShot){
    await page.waitForTimeout(700); // 等壓暗淡入完成(350ms)+穩定, 抓 alpha≈full 的一刻
    // 診斷: 印出高 depth graphics 的實際 alpha/depth/visible/size。
    const diag = await page.evaluate(()=>{
      const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
      const out=[];
      gs.children.list.forEach((o)=>{ if((o.type==='Graphics'||o.type==='Image')&&o.depth>=955) out.push({t:o.type,depth:o.depth,alpha:Math.round((o.alpha??1)*100)/100,visible:o.visible,sf:o.scrollFactorX}); });
      // 相機資訊。
      const cam=gs.cameras&&gs.cameras.main;
      return { overlays: out, camZoom: cam?cam.zoom:null, camW: cam?cam.width:null, camH: cam?cam.height:null };
    });
    console.log('  [診斷] 高depth物件=', JSON.stringify(diag));
    await page.screenshot({ path: path.join(__dirname,'..','probe-shot-guard-focus.png') });
    focusShot=true;
    break;
  }
}
console.log('[聚焦] 有抓到壓暗+雕像那刻截圖=', focusShot);
// 等走位+reveal+focus 跑完(~走位到位+0.45+聚焦1.6+緩衝 ≈ 5s)。
await page.waitForTimeout(5000);
const late = await page.evaluate(()=>{
  const ctx=window.__ctx; const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  // 雕像顯現?(statue texture 可見)
  let statueVisible=false;
  gs.children.list.forEach((o)=>{ if(o.type==='Container'&&o.visible&&o.list){ o.list.forEach((c)=>{ if(c.texture&&/statue/.test(c.texture.key||'')) statueVisible=true; }); } });
  return { scriptedControl: ctx.scriptedControl, statueVisible };
});
console.log('[開場後] 聚焦結束解鎖 scriptedControl=', late.scriptedControl, '(應 false) 雕像顯現=', late.statueVisible);
await page.screenshot({ path: path.join(__dirname,'..','probe-shot-guard-focus.png') });
console.log('  結果: 鎖操作+限時大字+走位=', early.scriptedControl&&early.bigText?'PASS':'注意', ' | 開場後解鎖=', late.scriptedControl===false?'PASS':'注意');
await browser.close(); server.close();
console.log('DONE');
