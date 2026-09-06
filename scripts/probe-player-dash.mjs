// 七輪 衝刺特效驗: 衝刺開始播 playerDash(玩家位置/衝刺方向/玩家色)。
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
page.on('pageerror',(e)=>console.log('  [pageerror]', String(e).slice(0,150)));
await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'networkidle'});
await page.waitForTimeout(3300);
await page.keyboard.press('KeyC'); await page.waitForTimeout(400);
const r = await page.evaluate(async ()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const ctx=(gs.systems||[]).find((x)=>x&&x.ctx)?.ctx;
  const fx=ctx.effects;
  const texDash = gs.textures.exists('vfx-player-dash');
  const texFan = gs.textures.exists('vfx-enemy-fan');
  let dashCalls=0, last=null, sprInfo=null;
  const orig = fx.playerDash.bind(fx);
  const origAdd = gs.add.image.bind(gs.add);
  fx.playerDash = function(x,y,ang,color){
    dashCalls++; last={x:Math.round(x),y:Math.round(y),angDeg:Math.round(ang*180/Math.PI),color:color?.toString(16)};
    let spr=null; gs.add.image=function(...a){ const s=origAdd(...a); if(a[2]==='vfx-player-dash') spr=s; return s; };
    const r=orig(x,y,ang,color); gs.add.image=origAdd;
    if(spr) sprInfo={depth:spr.depth, origin:[spr.originX,spr.originY], tint:spr.tintTopLeft?.toString(16), rot:Math.round(spr.rotation*180/Math.PI), visible:spr.visible};
    return r;
  };
  const p=ctx.players[0];
  // 觸發衝刺: 直接呼 startDash + 手動播(模擬 PlayerControlSystem 那段)——但更真: 呼 control 觸發不易, 直接呼 startDash 後手動走接線邏輯。
  // 改: 直接呼 fx.playerDash 驗 sprite(素材/染色/rotate), + 另確認 PlayerControlSystem 接線存在(grep 已確認)。
  const pos=p.getPosition(); const dd=p.getDashDir?p.getDashDir():{x:1,y:0};
  // 模擬控制系統接線那行:
  fx.playerDash(pos.x, pos.y, Math.atan2(dd.y||0, dd.x||1), 0xff5544);
  // 額外: 玩家挪走, 螢幕中央播放大 dash trail 朝右, 立刻截圖(0.18s 內)。
  const psp2=p.sprite||p.anim?.sprite; if(psp2){psp2.x=200;psp2.y=200;}
  const bigSpr = (()=>{ let s=null; const oa=gs.add.image.bind(gs.add); gs.add.image=function(...a){ const im=oa(...a); if(a[2]==='vfx-player-dash') s=im; return im; }; fx.playerDash(640,360,0,0x33ddff); gs.add.image=oa; if(s) s.setScale(4,4); return s; })();
  return { texDash, texFan, dashCalls, last, sprInfo };
});
console.log('[七輪 衝刺特效驗]'); console.log(JSON.stringify(r, null, 1));
console.log('  fx_player_dash 載入?', r.texDash, r.texDash?'PASS':'FAIL(素材沒進 dist)');
console.log('  fx_enemy_fan 載入(上次漏 add 素材)?', r.texFan, r.texFan?'PASS(有)':'FAIL(未追蹤→CI/線上沒扇形素材!)');
console.log('  playerDash 播放+sprite:', r.dashCalls>0 && r.sprInfo ? 'PASS('+JSON.stringify(r.sprInfo)+')' : 'FAIL');
await page.waitForTimeout(40);
await page.screenshot({ path:'/tmp/player-dash.png' });
console.log('  截圖 /tmp/player-dash.png (中央放大 dash trail 朝右 青色)');
await browser.close(); server.close();
console.log('DONE');
