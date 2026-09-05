// #8 診斷(可控版): 直接用 ctx.spawner 在玩家右側生每種敵人, 遠處→idle、中距→move, 截圖+讀flipX。
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

// 清掉現有怪 + 用 spawner 生指定 type 在玩家右側指定距離。回傳 spawner 是否可達。
const ready = await page.evaluate(()=>{
  const gs=window.__PHASER_GAME__.scene.getScene('GameScene');
  const sys=(gs.systems||[]).find((x)=>x&&x.ctx&&x.ctx.spawner);
  window.__ctx = sys ? sys.ctx : null;
  return !!window.__ctx;
});
console.log('ctx.spawner 可達?', ready);

async function spawnAndShoot(type, distX, wantState, tag){
  // 生一隻在玩家右側 distX 處(遠→idle、中→move 追)。
  await page.evaluate(({t,dx})=>{
    const ctx=window.__ctx; const p=ctx.players[0]; const pos=p.getHitCenter();
    // 清場只留這隻: 把其他怪殺掉(呼 takeHit 大傷 or 直接標記)。簡單:生一隻新的即可, 其他不干擾右側判定。
    window.__probe = ctx.spawner.spawn(t, pos.x + dx, pos.y);
  }, {t:type, dx:distX});
  // 等狀態穩定。idle: 遠處敵人偵測不到玩家會 idle; move: 中距會追(play move)。
  let info=null;
  for(let i=0;i<60;i++){
    await page.waitForTimeout(80);
    info = await page.evaluate(()=>{
      const e=window.__probe; if(!e) return null;
      const spr=e.anim?e.anim.sprite:null; // Enemy 內部 anim
      const key = spr&&spr.anims&&spr.anims.currentAnim?spr.anims.currentAnim.key:'';
      const ctx=window.__ctx; const px=ctx.players[0].getHitCenter().x;
      return { anim:key, flipX: spr?!!spr.flipX:null, ex: spr?Math.round(spr.x):null, px:Math.round(px) };
    });
    if(info && new RegExp('__'+wantState+'$','i').test(info.anim)) break;
  }
  const fn=`probe-shot-t8-${tag}.png`;
  await page.screenshot({ path: path.join(__dirname,'..',fn) });
  console.log(`${tag}: anim=${info?info.anim:'?'} flipX=${info?info.flipX:'?'} ex=${info?info.ex:'?'} px=${info?info.px:'?'} → ${fn}`);
  // 收掉這隻(移出畫面)避免干擾下一輪。
  await page.evaluate(()=>{ if(window.__probe){ window.__probe.anim.sprite.x = -9999; } });
  await page.waitForTimeout(150);
}

// idle: 遠(偵測不到→idle)。move: 中距(追=move)。attack: 近距(進攻擊距離→揮)。
for(const t of ['Enemy_Rush','Enemy_Ranged','Enemy_Elite']){
  await spawnAndShoot(t, 900, 'idle', `${t}-idle`);
  await spawnAndShoot(t, 260, 'move', `${t}-move`);
  await spawnAndShoot(t, 120, 'attack', `${t}-attack`);
}
await browser.close(); server.close();
console.log('DONE');
